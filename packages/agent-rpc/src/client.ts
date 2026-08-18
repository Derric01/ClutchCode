import type { Readable, Writable } from "node:stream";
import { encodeFrame, FrameDecoder } from "./framing.js";
import { isResponse } from "./protocol.js";

export interface AgentRpcClient {
  /** Sends a request, resolves with `result` or rejects with the server's error message. */
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Subscribes to server-initiated notifications (`clutchcode/event`); returns an unsubscribe function. */
  onNotification(handler: (method: string, params: unknown) => void): () => void;
  close(): void;
}

/**
 * The client half (§18.5): "the extension is a thin TypeScript client" of
 * this. Takes any Writable/Readable pair — a spawned `clutchcode serve`
 * child process's stdin/stdout in the VS Code extension, or an in-memory
 * `PassThrough` pair in tests — so it's exercised the same way in both.
 */
export function createAgentRpcClient(stdin: Writable, stdout: Readable): AgentRpcClient {
  let nextId = 1;
  const pending = new Map<string | number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  const notificationHandlers = new Set<(method: string, params: unknown) => void>();

  const decoder = new FrameDecoder((message) => {
    if (isResponse(message)) {
      const waiter = pending.get(message.id as string | number);
      if (!waiter) return; // a response to a request we didn't send (or already timed out) — ignored, not fatal
      pending.delete(message.id as string | number);
      if ("error" in message) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    const msg = message as { method?: unknown; params?: unknown };
    if (typeof msg.method === "string") {
      for (const handler of notificationHandlers) handler(msg.method, msg.params);
    }
  });

  const onData = (chunk: Buffer): void => decoder.push(chunk);
  stdout.on("data", onData);

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        stdin.write(encodeFrame({ jsonrpc: "2.0", id, method, params }));
      });
    },
    onNotification(handler) {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    },
    close() {
      stdout.off("data", onData);
      for (const { reject } of pending.values()) reject(new Error("client closed with a request still pending"));
      pending.clear();
    }
  };
}
