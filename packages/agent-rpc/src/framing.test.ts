import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder } from "./framing.js";

describe("encodeFrame / FrameDecoder round trip", () => {
  it("encodes and decodes a single message", () => {
    const received: unknown[] = [];
    const decoder = new FrameDecoder((m) => received.push(m));
    decoder.push(encodeFrame({ hello: "world" }));
    expect(received).toEqual([{ hello: "world" }]);
  });

  it("decodes a message split across multiple pushes, at an arbitrary byte offset", () => {
    const received: unknown[] = [];
    const decoder = new FrameDecoder((m) => received.push(m));
    const frame = encodeFrame({ a: 1, b: "two", c: [1, 2, 3] });

    // Split mid-header, mid-body — real pipes don't respect message boundaries.
    const cut1 = 5;
    const cut2 = frame.length - 4;
    decoder.push(frame.subarray(0, cut1));
    decoder.push(frame.subarray(cut1, cut2));
    decoder.push(frame.subarray(cut2));

    expect(received).toEqual([{ a: 1, b: "two", c: [1, 2, 3] }]);
  });

  it("decodes multiple frames delivered in one push", () => {
    const received: unknown[] = [];
    const decoder = new FrameDecoder((m) => received.push(m));
    decoder.push(Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })]));
    expect(received).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("handles unicode content correctly (byte length, not string length, in Content-Length)", () => {
    const received: unknown[] = [];
    const decoder = new FrameDecoder((m) => received.push(m));
    const message = { text: "日本語のテスト — emoji: 🎉" };
    decoder.push(encodeFrame(message));
    expect(received).toEqual([message]);
  });

  it("throws on a malformed header instead of hanging forever", () => {
    const decoder = new FrameDecoder(() => {});
    expect(() => decoder.push(Buffer.from("Not-A-Real-Header\r\n\r\n{}"))).toThrow(/Content-Length/);
  });
});
