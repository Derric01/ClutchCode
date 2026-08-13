import { describe, expect, it } from "vitest";
import { parseSSE } from "./sse.js";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    }
  });
}

describe("parseSSE", () => {
  it("parses simple data-only events", async () => {
    const stream = streamFrom(["data: {\"a\":1}\n\n", "data: {\"a\":2}\n\n"]);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([
      { event: null, data: '{"a":1}' },
      { event: null, data: '{"a":2}' }
    ]);
  });

  it("parses events with an explicit event: field", async () => {
    const stream = streamFrom(['event: content_block_delta\ndata: {"x":true}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ event: "content_block_delta", data: '{"x":true}' }]);
  });

  it("handles an event split across multiple chunks", async () => {
    const stream = streamFrom(["data: {\"par", 'tial":true}\n', "\n"]);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ event: null, data: '{"partial":true}' }]);
  });

  it("joins multi-line data fields with newlines", async () => {
    const stream = streamFrom(["data: line1\ndata: line2\n\n"]);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ event: null, data: "line1\nline2" }]);
  });
});
