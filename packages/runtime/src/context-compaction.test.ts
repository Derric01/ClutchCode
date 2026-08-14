import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@clutchcode/providers";
import { compactHistory, estimateMessageTokens, estimateTokens } from "./context-compaction.js";

/** One assistant tool-call turn + its tool result, matching agent-loop.ts's push order. */
function turn(id: string, textLen = 0): NormalizedMessage[] {
  return [
    {
      role: "assistant",
      content: "x".repeat(textLen),
      toolCalls: [{ id, name: "read_file", argsJson: JSON.stringify({ path: `file-${id}.js` }) }]
    },
    { role: "tool", toolCallId: id, content: "y".repeat(2000) } // ~500 tokens each, to force compaction quickly
  ];
}

describe("estimateTokens", () => {
  it("is a ~4-chars-per-token proxy, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("estimateMessageTokens", () => {
  it("counts content plus tool-call name/args", () => {
    const m: NormalizedMessage = { role: "assistant", content: "hi", toolCalls: [{ id: "1", name: "read_file", argsJson: "{}" }] };
    expect(estimateMessageTokens(m)).toBe(estimateTokens("hi") + estimateTokens("read_file") + estimateTokens("{}"));
  });
});

describe("compactHistory", () => {
  const system: NormalizedMessage = { role: "system", content: "you are ClutchCode" };
  const task: NormalizedMessage = { role: "user", content: "fix the bug" };

  it("is a no-op (same array) when history already fits the budget", () => {
    const messages = [system, task, ...turn("c1")];
    const result = compactHistory(messages, 1_000_000);
    expect(result.compacted).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.messages).toBe(messages);
  });

  it("drops the oldest whole turns and inserts one notice, keeping pinned system+task", () => {
    const messages = [system, task, ...turn("c1"), ...turn("c2"), ...turn("c3"), ...turn("c4")];
    const result = compactHistory(messages, 700); // small enough to force dropping several ~500-token turns

    expect(result.compacted).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect(result.messages[0]).toEqual(system);
    expect(result.messages[1]).toEqual(task);
    expect(result.messages[2]!.role).toBe("user");
    expect(result.messages[2]!.content).toMatch(/context budget/);
    // The most recent turn always survives.
    expect(result.messages.at(-1)).toEqual(turn("c4")[1]);
  });

  it("never separates a kept assistant tool-call from its tool-result", () => {
    const messages = [system, task, ...turn("c1"), ...turn("c2"), ...turn("c3")];
    const result = compactHistory(messages, 600);

    for (let i = 0; i < result.messages.length; i++) {
      if (result.messages[i]!.role === "tool") {
        expect(result.messages[i - 1]!.role).toBe("assistant");
      }
    }
  });

  it("never drops the single most recent turn, even if it alone exceeds the budget", () => {
    const messages = [system, task, ...turn("only", 5000)];
    const result = compactHistory(messages, 10); // impossibly small budget
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("pins the system prompt alone when there's no separate task message yet", () => {
    const messages = [system, ...turn("c1"), ...turn("c2")];
    const result = compactHistory(messages, 100);
    expect(result.messages[0]).toEqual(system);
    expect(result.messages[1]!.content).toMatch(/context budget/);
  });

  it("handles an empty message list without throwing", () => {
    expect(compactHistory([], 1000)).toEqual({ messages: [], compacted: false, droppedCount: 0 });
  });
});
