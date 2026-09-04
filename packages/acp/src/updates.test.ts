import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@clutchcode/agent-api";
import { createSessionUpdateMapper } from "./updates.js";

/**
 * Pure-function coverage of the RuntimeEvent → ACP SessionUpdate mapping —
 * every branch of the union, run through the mapper directly, no I/O and no
 * real `Agent.run()` needed. The real, end-to-end version of this (a real
 * `Agent.run()` producing real events that flow through this same mapper
 * into real `session/update` notifications) is `agent-methods.test.ts`.
 */
describe("createSessionUpdateMapper (§18.1 ACP binding)", () => {
  it("maps model.response to a text agent_message_chunk with a fresh messageId per call", () => {
    const map = createSessionUpdateMapper();
    const [update] = map({ type: "model.response", text: "hello", toolCalls: 0 });
    expect(update).toMatchObject({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
    expect(typeof (update as { messageId: string }).messageId).toBe("string");
  });

  it("emits nothing for an empty model.response (no text to show)", () => {
    const map = createSessionUpdateMapper();
    expect(map({ type: "model.response", text: "", toolCalls: 0 })).toEqual([]);
  });

  it("emits nothing for model.request (implicit, not user-visible)", () => {
    const map = createSessionUpdateMapper();
    expect(map({ type: "model.request" })).toEqual([]);
  });

  it("pairs tool.call with a later tool.result via a FIFO toolCallId, mapping ok:false to status failed", () => {
    const map = createSessionUpdateMapper();
    const [call] = map({ type: "tool.call", tool: "shell", args: "npm test" });
    expect(call).toMatchObject({ sessionUpdate: "tool_call", title: "shell", kind: "execute", status: "in_progress" });
    const callId = (call as { toolCallId: string }).toolCallId;
    expect(typeof callId).toBe("string");

    const [result] = map({ type: "tool.result", tool: "shell", ok: false, errorCode: "exit-nonzero" });
    expect(result).toMatchObject({ sessionUpdate: "tool_call_update", toolCallId: callId, status: "failed" });
  });

  it("maps a successful tool.result to status completed with no error content", () => {
    const map = createSessionUpdateMapper();
    map({ type: "tool.call", tool: "read_file", args: "README.md" });
    const [result] = map({ type: "tool.result", tool: "read_file", ok: true });
    expect(result).toMatchObject({ sessionUpdate: "tool_call_update", status: "completed" });
    expect((result as { content?: unknown }).content).toBeUndefined();
  });

  it("maps every native tool name to a sensible ToolKind", () => {
    const map = createSessionUpdateMapper();
    const kinds = ["read_file", "write_file", "edit_file", "shell", "process", "search", "git", "unknown_tool"].map((tool) => {
      const [update] = map({ type: "tool.call", tool, args: "" });
      return (update as { kind: string }).kind;
    });
    expect(kinds).toEqual(["read", "edit", "edit", "execute", "execute", "search", "other", "other"]);
  });

  it("maps verify.stage directly to a completed/failed tool_call (no separate in_progress phase)", () => {
    const map = createSessionUpdateMapper();
    const [passed] = map({ type: "verify.stage", stage: "test", passed: true });
    expect(passed).toMatchObject({ sessionUpdate: "tool_call", title: "verify: test", kind: "execute", status: "completed" });

    const [failed] = map({ type: "verify.stage", stage: "lint", passed: false });
    expect(failed).toMatchObject({ sessionUpdate: "tool_call", title: "verify: lint", status: "failed" });
  });

  it("surfaces cheat.flag, budget.hit, and escalation as user-visible agent_message_chunk text", () => {
    const map = createSessionUpdateMapper();
    const [cheat] = map({ type: "cheat.flag", rule: "assertion-weakened", file: "src/x.ts" });
    expect(cheat).toMatchObject({ sessionUpdate: "agent_message_chunk" });
    expect((cheat as { content: { text: string } }).content.text).toContain("assertion-weakened");
    expect((cheat as { content: { text: string } }).content.text).toContain("src/x.ts");

    const [budget] = map({ type: "budget.hit", kinds: ["steps", "costUsd"] });
    expect((budget as { content: { text: string } }).content.text).toContain("steps, costUsd");

    const [escalation] = map({ type: "escalation", reason: "loop detected" });
    expect((escalation as { content: { text: string } }).content.text).toContain("loop detected");
  });

  it("surfaces state.transition, context.compacted, context.pruned, and loop.detected as agent_thought_chunk", () => {
    const map = createSessionUpdateMapper();
    const [transition] = map({ type: "state.transition", from: "ACTING", to: "VERIFYING" });
    expect(transition).toMatchObject({ sessionUpdate: "agent_thought_chunk" });
    expect((transition as { content: { text: string } }).content.text).toBe("ACTING → VERIFYING");

    const [compacted] = map({ type: "context.compacted", droppedCount: 3 });
    expect((compacted as { content: { text: string } }).content.text).toContain("3");

    const [pruned] = map({ type: "context.pruned", prunedCount: 2, reclaimedTokens: 500 });
    expect((pruned as { content: { text: string } }).content.text).toContain("2");
    expect((pruned as { content: { text: string } }).content.text).toContain("500");

    const [loop] = map({ type: "loop.detected", warning: { kind: "repeated-call", count: 4, escalate: true } });
    expect((loop as { content: { text: string } }).content.text).toContain("repeated call (4x)");
    expect((loop as { content: { text: string } }).content.text).toContain("escalating");
  });

  it("formats every LoopWarning kind without throwing", () => {
    const map = createSessionUpdateMapper();
    const warnings: Array<RuntimeEvent & { type: "loop.detected" }> = [
      { type: "loop.detected", warning: { kind: "oscillating-edit", file: "a.ts", escalate: false } },
      { type: "loop.detected", warning: { kind: "no-progress", escalate: false } },
      { type: "loop.detected", warning: { kind: "almost-done-stall", escalate: false } }
    ];
    for (const event of warnings) {
      const [update] = map(event);
      expect((update as { content: { text: string } }).content.text.length).toBeGreaterThan(0);
    }
  });

  it("maps run.end to a final agent_message_chunk naming the status", () => {
    const map = createSessionUpdateMapper();
    const [update] = map({ type: "run.end", status: "DONE" });
    expect((update as { content: { text: string } }).content.text).toContain("DONE");
  });

  it("keeps tool call ids scoped to one mapper instance (fresh per prompt turn)", () => {
    const first = createSessionUpdateMapper();
    const second = createSessionUpdateMapper();
    const [a] = first({ type: "tool.call", tool: "shell", args: "" });
    const [b] = second({ type: "tool.call", tool: "shell", args: "" });
    expect((a as { toolCallId: string }).toolCallId).not.toBe((b as { toolCallId: string }).toolCallId);
  });
});
