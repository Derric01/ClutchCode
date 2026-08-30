import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@clutchcode/providers";
import { estimateMessageTokens } from "./context-compaction.js";
import { pruneSupersededToolResults } from "./tool-result-pruning.js";

/** One assistant tool-call turn + its result, matching agent-loop.ts's push order. */
function turn(id: string, tool: string, args: unknown, output: string): NormalizedMessage[] {
  return [
    { role: "assistant", content: "", toolCalls: [{ id, name: tool, argsJson: JSON.stringify(args) }] },
    { role: "tool", toolCallId: id, content: output }
  ];
}

const system: NormalizedMessage = { role: "system", content: "you are ClutchCode" };
const task: NormalizedMessage = { role: "user", content: "fix the failing test" };

function totalTokens(messages: NormalizedMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

describe("pruneSupersededToolResults (§4.5)", () => {
  it("is a complete no-op — the very same array — while history fits the budget", () => {
    const messages = [system, task, ...turn("a", "shell", { command: "npm test" }, "x".repeat(4000)), ...turn("b", "shell", { command: "npm test" }, "y".repeat(4000))];
    const result = pruneSupersededToolResults(messages, 1_000_000);

    expect(result.pruned).toBe(false);
    expect(result.prunedCount).toBe(0);
    expect(result.reclaimedTokens).toBe(0);
    // Identity, not just equality: a run inside budget must be byte-identical
    // to one built without this stage at all.
    expect(result.messages).toBe(messages);
  });

  it("blanks an earlier result whose exact call was re-run later, and keeps the newest one intact", () => {
    const stale = "FAIL: 3 tests failed" + "x".repeat(4000);
    const fresh = "PASS: 3 tests passed" + "y".repeat(4000);
    const messages = [system, task, ...turn("a", "shell", { command: "npm test" }, stale), ...turn("b", "shell", { command: "npm test" }, fresh)];

    const result = pruneSupersededToolResults(messages, 500);

    expect(result.pruned).toBe(true);
    expect(result.prunedCount).toBe(1);
    // The stale pre-edit run is gone; the live post-edit run is untouched.
    expect(result.messages[3]!.content).not.toContain("FAIL");
    expect(result.messages[3]!.content).toMatch(/tool result pruned/);
    expect(result.messages[3]!.content).toContain("`shell`");
    expect(result.messages[5]!.content).toBe(fresh);
  });

  it("never removes a message, changes a role, or breaks a tool-call/result pairing", () => {
    const messages = [system, task, ...turn("a", "read_file", { path: "src/x.ts" }, "old".repeat(2000)), ...turn("b", "read_file", { path: "src/x.ts" }, "new".repeat(2000))];
    const result = pruneSupersededToolResults(messages, 100);

    expect(result.pruned).toBe(true);
    expect(result.messages).toHaveLength(messages.length);
    expect(result.messages.map((m) => m.role)).toEqual(messages.map((m) => m.role));
    expect(result.messages.map((m) => m.toolCallId)).toEqual(messages.map((m) => m.toolCallId));
    expect(result.messages.map((m) => m.toolCalls)).toEqual(messages.map((m) => m.toolCalls));
    // The input array itself is not mutated.
    expect(messages[3]!.content).toContain("old");
  });

  it("does not prune two calls to the same tool with different arguments — different questions, both still live", () => {
    const messages = [
      system,
      task,
      ...turn("a", "read_file", { path: "src/a.ts" }, "a".repeat(8000)),
      ...turn("b", "read_file", { path: "src/b.ts" }, "b".repeat(8000))
    ];
    const result = pruneSupersededToolResults(messages, 100);

    expect(result.pruned).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("does not prune the same arguments passed to a different tool", () => {
    const messages = [
      system,
      task,
      ...turn("a", "read_file", { path: "src/a.ts" }, "a".repeat(8000)),
      ...turn("b", "grep", { path: "src/a.ts" }, "b".repeat(8000))
    ];
    expect(pruneSupersededToolResults(messages, 100).pruned).toBe(false);
  });

  it("prunes oldest-first and stops the moment the budget is satisfied, rather than sweeping everything prunable", () => {
    const big = (marker: string) => marker + "z".repeat(4000);
    const messages = [
      system,
      task,
      ...turn("a", "shell", { command: "npm test" }, big("FIRST")),
      ...turn("b", "shell", { command: "npm test" }, big("SECOND")),
      ...turn("c", "shell", { command: "npm test" }, big("THIRD")),
      ...turn("d", "shell", { command: "npm test" }, big("FOURTH"))
    ];
    // One token over budget: three of the four results are prunable, but
    // clearing the oldest alone already satisfies it, so exactly one goes.
    // Derived from the real estimate rather than a guessed constant, so
    // the test states the rule instead of encoding today's arithmetic.
    const budget = totalTokens(messages) - 1;
    const result = pruneSupersededToolResults(messages, budget);

    expect(result.prunedCount).toBe(1);
    expect(result.messages[3]!.content).toMatch(/tool result pruned/); // FIRST, the oldest
    expect(result.messages[5]!.content).toContain("SECOND");
    expect(result.messages[7]!.content).toContain("THIRD");
    expect(result.messages[9]!.content).toContain("FOURTH");
    expect(totalTokens(result.messages)).toBeLessThanOrEqual(budget);
  });

  it("prunes as many as it takes when one is not enough, and reports the real reclaimed estimate", () => {
    const big = (marker: string) => marker + "z".repeat(4000);
    const messages = [
      system,
      task,
      ...turn("a", "shell", { command: "npm test" }, big("FIRST")),
      ...turn("b", "shell", { command: "npm test" }, big("SECOND")),
      ...turn("c", "shell", { command: "npm test" }, big("THIRD"))
    ];
    const before = totalTokens(messages);
    // Well under one result's worth, so no single prune can satisfy it.
    const result = pruneSupersededToolResults(messages, 500);

    expect(result.prunedCount).toBe(2); // both stale ones; the newest is never a candidate
    expect(result.messages[7]!.content).toContain("THIRD");
    expect(before - totalTokens(result.messages)).toBe(result.reclaimedTokens);
  });

  it("leaves a short superseded result alone — replacing it with the longer placeholder would cost tokens, not save them", () => {
    const messages = [
      system,
      task,
      ...turn("a", "shell", { command: "git status" }, "clean"),
      ...turn("b", "shell", { command: "git status" }, "clean"),
      // Something genuinely large, so the history really is over budget and
      // the short result's survival is a decision rather than an early exit.
      ...turn("c", "read_file", { path: "big.ts" }, "q".repeat(8000))
    ];
    const result = pruneSupersededToolResults(messages, 100);

    expect(result.pruned).toBe(false);
    expect(result.messages[3]!.content).toBe("clean");
  });

  it("ignores a tool result whose originating call is no longer in the transcript (a resumed, already-compacted history)", () => {
    // No assistant message carries call "gone" — exactly what a transcript
    // looks like after `compactHistory` dropped the turn that made the call.
    const orphan: NormalizedMessage = { role: "tool", toolCallId: "gone", content: "o".repeat(8000) };
    const messages = [system, task, orphan, ...turn("b", "shell", { command: "npm test" }, "n".repeat(8000))];

    const result = pruneSupersededToolResults(messages, 100);
    expect(result.pruned).toBe(false);
    expect(result.messages[2]!.content).toBe(orphan.content);
  });

  it("handles an empty history without throwing", () => {
    expect(pruneSupersededToolResults([], 10).pruned).toBe(false);
  });
});
