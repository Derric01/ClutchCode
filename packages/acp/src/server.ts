import type { Readable, Writable } from "node:stream";
import { Readable as NodeReadable, Writable as NodeWritable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { buildAcpApp, type AcpAgentMethodsOptions } from "./agent-methods.js";

export interface AcpServerHandle {
  close(): void;
}

/**
 * The server half of ClutchCode's Agent Client Protocol binding
 * (PROJECT_SPEC.md §18.1/§20/§26). Mirrors `@clutchcode/agent-rpc`'s
 * `serveAgentRpc` shape deliberately — same "attach to real
 * `process.stdin`/`process.stdout` in prod, a real in-memory duplex pair in
 * tests" pattern — but speaks ACP's actual newline-delimited-JSON wire
 * format (`ndJsonStream`) over WHATWG streams instead of the LSP-style
 * `Content-Length`-framed stdio `agent-rpc` uses; the two protocols are
 * distinct on the wire even though both bind the same `@clutchcode/agent-api`
 * underneath.
 *
 * `Readable.toWeb`/`Writable.toWeb` (stable since Node 18.17, and this
 * workspace's `engines` floor is already `>=20`) do the Node-stream →
 * WHATWG-stream conversion `ndJsonStream` expects.
 */
export function serveAcp(opts: AcpAgentMethodsOptions, stdin: Readable, stdout: Writable): AcpServerHandle {
  const app = buildAcpApp(opts);

  const readable = NodeReadable.toWeb(stdin) as unknown as ReadableStream<Uint8Array>;
  const writable = NodeWritable.toWeb(stdout) as unknown as WritableStream<Uint8Array>;
  const stream = ndJsonStream(writable, readable);

  const connection = app.connect(stream);

  return {
    close() {
      connection.close();
    }
  };
}
