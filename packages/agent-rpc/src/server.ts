import type { Readable, Writable } from "node:stream";
import { createDispatcher } from "./dispatcher.js";
import { encodeFrame, FrameDecoder } from "./framing.js";
import { buildAgentRpcMethods, type AgentRpcMethodsOptions } from "./agent-methods.js";
import { notification } from "./protocol.js";

export interface AgentRpcServerHandle {
  close(): void;
}

/**
 * The server half of the Agent API's stdio JSON-RPC binding (§18.1/§18.5).
 * `apps/cli`'s `clutchcode serve` attaches this to real `process.stdin`/
 * `process.stdout`; tests attach it to in-memory `PassThrough` pairs
 * instead, so the whole request→Agent→response→notification round trip
 * (including a real `Agent.run()`) is verifiable without spawning a
 * process or needing an editor host.
 */
export function serveAgentRpc(opts: Omit<AgentRpcMethodsOptions, "onRuntimeEvent">, stdin: Readable, stdout: Writable): AgentRpcServerHandle {
  const send = (message: unknown): void => {
    stdout.write(encodeFrame(message));
  };

  const { handlers } = buildAgentRpcMethods({
    ...opts,
    onRuntimeEvent: (runId, event) => send(notification("clutchcode/event", { runId, event }))
  });

  const dispatch = createDispatcher(handlers);

  const decoder = new FrameDecoder((message) => {
    void dispatch(message).then((response) => {
      if (response) send(response);
    });
  });

  const onData = (chunk: Buffer): void => decoder.push(chunk);
  stdin.on("data", onData);

  return {
    close() {
      stdin.off("data", onData);
    }
  };
}
