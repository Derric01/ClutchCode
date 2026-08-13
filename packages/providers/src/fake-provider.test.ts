import { describe, expect, it } from "vitest";
import { collect } from "./types.js";
import { FakeProvider, textTurn, toolCallTurn } from "./fake-provider.js";

describe("FakeProvider", () => {
  it("plays back scripted text turns in order", async () => {
    const provider = new FakeProvider([textTurn("first"), textTurn("second")]);

    const r1 = await collect(provider.chat({ model: "fake", messages: [] }));
    expect(r1.text).toBe("first");

    const r2 = await collect(provider.chat({ model: "fake", messages: [] }));
    expect(r2.text).toBe("second");

    expect(provider.requestLog).toHaveLength(2);
  });

  it("plays back a native tool-call turn", async () => {
    const provider = new FakeProvider([toolCallTurn("call_1", "read_file", '{"path":"a.ts"}')]);
    const r = await collect(provider.chat({ model: "fake", messages: [] }));
    expect(r.finishReason).toBe("tool_use");
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "read_file", argsJson: '{"path":"a.ts"}' }]);
  });

  it("injects a provider error", async () => {
    const provider = new FakeProvider([{ kind: "error", message: "rate limited", retryable: true }]);
    const deltas: unknown[] = [];
    for await (const d of provider.chat({ model: "fake", messages: [] })) deltas.push(d);
    expect(deltas).toEqual([{ type: "error", message: "rate limited", retryable: true }]);
  });

  it("injects malformed output for edit-format/tool-parse repair testing (§4.4/§4.8)", async () => {
    const provider = new FakeProvider([{ kind: "malformed", text: "<tool>garbage not closed" }]);
    const r = await collect(provider.chat({ model: "fake", messages: [] }));
    expect(r.text).toBe("<tool>garbage not closed");
    expect(r.toolCalls).toEqual([]);
  });

  it("throws a clear error when the runtime makes more calls than scripted", async () => {
    const provider = new FakeProvider([textTurn("only turn")]);
    await collect(provider.chat({ model: "fake", messages: [] }));
    await expect(collect(provider.chat({ model: "fake", messages: [] }))).rejects.toThrow(/script exhausted/);
  });

  it("respects an already-aborted signal", async () => {
    const provider = new FakeProvider([textTurn("should not be seen")]);
    const controller = new AbortController();
    controller.abort();
    const r = await collect(provider.chat({ model: "fake", messages: [], signal: controller.signal }));
    expect(r.finishReason).toBe("error");
  });
});
