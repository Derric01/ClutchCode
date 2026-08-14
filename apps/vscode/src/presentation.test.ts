import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@clutchcode/agent-api";
import { formatRuntimeEventLine, formatStatusSummary } from "./presentation.js";

describe("formatRuntimeEventLine", () => {
  const cases: Array<[RuntimeEvent, RegExp]> = [
    [{ type: "state.transition", from: "ACTING", to: "EDITING" }, /ACTING.*EDITING/],
    [{ type: "model.request" }, /model request/],
    [{ type: "model.response", text: "ok", toolCalls: 2 }, /2 tool calls/],
    [{ type: "model.response", text: "ok", toolCalls: 1 }, /1 tool call\b/],
    [{ type: "tool.call", tool: "shell", args: '{"cmd":"ls"}' }, /shell.*cmd/],
    [{ type: "tool.result", tool: "shell", ok: true }, /✓ shell/],
    [{ type: "tool.result", tool: "shell", ok: false, errorCode: "timeout" }, /✗ shell \(timeout\)/],
    [{ type: "verify.stage", stage: "test", passed: true }, /✓ verify: test/],
    [{ type: "cheat.flag", rule: "deleted-assertion", file: "x.test.js" }, /cheat detection: deleted-assertion/],
    [{ type: "budget.hit", kinds: ["steps", "tokens"] }, /budget hit: steps, tokens/],
    [{ type: "loop.detected", warning: { kind: "repeated-call", count: 3, escalate: false } }, /loop detected: repeated-call/],
    [{ type: "context.compacted", droppedCount: 4 }, /4 message\(s\) dropped/],
    [{ type: "escalation", reason: "needs human" }, /escalated: needs human/],
    [{ type: "run.end", status: "DONE" }, /run ended: DONE/]
  ];

  for (const [event, pattern] of cases) {
    it(`formats ${event.type}`, () => {
      expect(formatRuntimeEventLine(event)).toMatch(pattern);
    });
  }
});

describe("formatStatusSummary", () => {
  it("summarizes each RunStatus a UI actually needs to react to", () => {
    expect(formatStatusSummary("DONE")).toMatch(/completed/);
    expect(formatStatusSummary("AWAITING_APPROVAL")).toMatch(/awaiting your review/);
    expect(formatStatusSummary("PAUSED", "budget exceeded: steps")).toBe("paused: budget exceeded: steps — resumable");
    expect(formatStatusSummary("ESCALATED", "loop detected")).toContain("loop detected");
    expect(formatStatusSummary("FAILED")).toMatch(/failed verification/);
    expect(formatStatusSummary("CANCELLED")).toBe("cancelled");
  });
});
