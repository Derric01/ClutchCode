import { describe, expect, it } from "vitest";
import type { FileDiff, PrResult, RuntimeEvent } from "@clutchcode/agent-api";
import { formatDiffTabTitle, formatPrResult, formatRuntimeEventLine, formatStatusSummary } from "./presentation.js";

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
    [{ type: "context.pruned", prunedCount: 2, reclaimedTokens: 1800 }, /2 superseded, ~1800 tokens reclaimed/],
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

describe("formatDiffTabTitle (§18.5 native two-sided diff view)", () => {
  it("titles an added/modified/deleted file with just its status", () => {
    const added: FileDiff = { path: "new.txt", status: "added", after: "x", binary: false };
    expect(formatDiffTabTitle(added)).toBe("new.txt (added)");
    const modified: FileDiff = { path: "a.txt", status: "modified", before: "x", after: "y", binary: false };
    expect(formatDiffTabTitle(modified)).toBe("a.txt (modified)");
    const deleted: FileDiff = { path: "gone.txt", status: "deleted", before: "x", binary: false };
    expect(formatDiffTabTitle(deleted)).toBe("gone.txt (deleted)");
  });

  it("titles a rename as 'old → new (renamed)'", () => {
    const renamed: FileDiff = { path: "NEW.md", oldPath: "OLD.md", status: "renamed", before: "x", after: "x", binary: false };
    expect(formatDiffTabTitle(renamed)).toBe("OLD.md → NEW.md (renamed)");
  });
});

describe("formatPrResult (§13.5 mirrored into the extension)", () => {
  it("reports a gh-opened PR by its URL", () => {
    const result: PrResult = { branch: "b", remote: "origin", method: "gh", url: "https://github.com/x/y/pull/1" };
    expect(formatPrResult("run1", result)).toBe("run run1 — PR opened: https://github.com/x/y/pull/1");
  });

  it("reports a compare-url fallback with both the branch and the URL", () => {
    const result: PrResult = { branch: "b", remote: "origin", method: "compare-url", url: "https://github.com/x/y/compare/main...b" };
    expect(formatPrResult("run1", result)).toContain('branch "b" pushed to origin; open a PR: https://github.com/x/y/compare/main...b');
  });

  it("reports a manual outcome without inventing a URL that doesn't exist", () => {
    const result: PrResult = { branch: "b", remote: "origin", method: "manual" };
    const msg = formatPrResult("run1", result);
    expect(msg).toContain('branch "b" pushed to origin');
    expect(msg).not.toMatch(/https?:\/\//);
  });
});
