import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@clutchcode/providers";
import { compactHistory } from "./context-compaction.js";

function msg(role: NormalizedMessage["role"], content: string, toolCalls?: NormalizedMessage["toolCalls"]): NormalizedMessage {
  return { role, content, toolCalls };
}

describe("compactHistory (§4.5)", () => {
  it("does nothing when under budget", () => {
    const messages = [msg("system", "sys"), msg("user", "task"), msg("assistant", "ok")];
    const result = compactHistory(messages, 10_000);
    expect(result.compactedCount).toBe(0);
    expect(result.messages).toBe(messages); // unchanged reference
  });

  it("does nothing when there aren't more than keepRecent non-system messages, even over budget", () => {
    const messages = [msg("system", "sys"), msg("user", "x".repeat(1000))];
    const result = compactHistory(messages, 10, 6);
    expect(result.compactedCount).toBe(0);
  });

  it("compacts older messages into a summary once over budget, keeping the system message and recent tail", () => {
    const messages: NormalizedMessage[] = [msg("system", "sys")];
    for (let i = 0; i < 20; i++) {
      messages.push(msg("assistant", "x".repeat(50), [{ id: `c${i}`, name: "read_file", argsJson: "{}" }]));
      messages.push(msg("tool", JSON.stringify({ ok: true, data: {} })));
    }
    // ~20 * 2 * ~55 chars ≈ 2200 chars of history; budget it down hard.
    const result = compactHistory(messages, 200, 6);

    expect(result.compactedCount).toBeGreaterThan(0);
    expect(result.messages[0]).toBe(messages[0]); // system untouched
    expect(result.messages[1]!.content).toContain("compacted");
    // The last 6 original messages survive verbatim at the tail.
    const tail = result.messages.slice(-6);
    expect(tail).toEqual(messages.slice(-6));
  });

  it("keeps the summary message's role as 'user' so every provider adapter accepts it", () => {
    const messages: NormalizedMessage[] = [msg("system", "sys")];
    for (let i = 0; i < 10; i++) messages.push(msg("user", "x".repeat(100)));
    const result = compactHistory(messages, 50, 2);
    expect(result.messages[1]!.role).toBe("user");
  });
});
