import { describe, expect, it } from "vitest";
import { buildInitialMessages, buildSystemPrompt } from "./message-builder.js";

describe("buildInitialMessages", () => {
  it("sends exactly system + user when there is no adaptation note (unchanged default shape)", () => {
    const messages = buildInitialMessages("fix the bug");
    expect(messages).toEqual([
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: "fix the bug" }
    ]);
  });

  it("inserts the adaptation note as its own system message, between the base prompt and the task", () => {
    const messages = buildInitialMessages("fix the bug", "Capability profile: ...");
    expect(messages).toEqual([
      { role: "system", content: buildSystemPrompt() },
      { role: "system", content: "Capability profile: ..." },
      { role: "user", content: "fix the bug" }
    ]);
  });
});
