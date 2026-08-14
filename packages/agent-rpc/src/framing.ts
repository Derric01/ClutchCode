/**
 * LSP-style message framing (PROJECT_SPEC.md §18.1/§18.5: "JSON-RPC over
 * stdio (LSP/ACP-style)"): `Content-Length: <n>\r\n\r\n<n bytes of UTF-8
 * JSON>`. The same wire shape the Language Server Protocol and the
 * Agent-Client Protocol use, chosen for the same reason: it's
 * self-delimiting over a raw byte stream (a pipe has no message
 * boundaries of its own) and every editor's LSP client tooling already
 * knows how to read/write it.
 */

export function encodeFrame(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, json]);
}

/**
 * Incremental decoder: `push()` as many times as data arrives on the
 * stream, in whatever chunk sizes the OS/pipe happens to deliver — a
 * frame's header or body can legitimately straddle two `push()` calls,
 * and this buffers correctly across that instead of assuming one push is
 * one message.
 */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (message: unknown) => void) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return; // header not fully arrived yet

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        throw new Error(`malformed frame: missing Content-Length header (got ${JSON.stringify(header)})`);
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return; // body not fully arrived yet

      const body = this.buffer.subarray(bodyStart, bodyStart + length);
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.onMessage(JSON.parse(body.toString("utf8")));
    }
  }
}
