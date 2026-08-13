import { describe, expect, it } from "vitest";
import { buildInitialMessages, buildSystemPrompt } from "./message-builder.js";

describe("buildSystemPrompt / buildInitialMessages (§10.1 AGENTS.md, §4.4 edit-format, §4.8 tool-protocol)", () => {
  it("returns the base prompt with no context", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("ClutchCode");
    expect(prompt).not.toContain("Project memory");
    expect(prompt).not.toContain("Tool-calling protocol");
    expect(prompt).not.toContain("Edit format guidance");
  });

  it("folds AGENTS.md prose into the system prompt when present", () => {
    const memory = "## Conventions\n- never touch generated/\n- domain term 'widget' means X";
    const prompt = buildSystemPrompt({ projectMemory: memory });
    expect(prompt).toContain("Project memory (AGENTS.md");
    expect(prompt).toContain("never touch generated/");
  });

  it("truncates an oversized AGENTS.md rather than blowing the prompt", () => {
    const huge = "x".repeat(10_000);
    const prompt = buildSystemPrompt({ projectMemory: huge });
    expect(prompt.length).toBeLessThan(10_000);
    expect(prompt).toContain("truncated");
  });

  it("includes tool-protocol instructions only when supplied (§4.8)", () => {
    const prompt = buildSystemPrompt({ toolProtocolInstructions: "Emit exactly one <tool> block." });
    expect(prompt).toContain("Tool-calling protocol");
    expect(prompt).toContain("Emit exactly one <tool> block.");
  });

  it("includes capability-driven edit-format guidance only when supplied (§4.4)", () => {
    const prompt = buildSystemPrompt({ editFormatGuidance: "prefer write_file for files under 400 lines" });
    expect(prompt).toContain("Edit format guidance");
    expect(prompt).toContain("prefer write_file for files under 400 lines");
  });

  it("buildInitialMessages puts all context in the system message, task in the user message", () => {
    const messages = buildInitialMessages("fix the bug", { projectMemory: "## Conventions\nuse tabs" });
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("use tabs");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toBe("fix the bug");
  });
});
