import { describe, expect, it } from "vitest";
import { buildEditFormatGuidance, buildInitialMessages, buildSystemPrompt } from "./message-builder.js";

describe("buildEditFormatGuidance (§4.4 decision tree → prose)", () => {
  it("grammar-enforced search/replace for a high-accuracy model with constrained decode", () => {
    const guidance = buildEditFormatGuidance({ diffApplicationAccuracy: 0.9, constrainedDecodeAvailable: true, effectiveContext: 8000 });
    expect(guidance).toMatch(/edit_file \(SEARCH\/REPLACE\) \(grammar-enforced\)/);
  });

  it("plain search/replace above the 0.75 threshold without constrained decode", () => {
    const guidance = buildEditFormatGuidance({ diffApplicationAccuracy: 0.8, constrainedDecodeAvailable: false, effectiveContext: 8000 });
    expect(guidance).toMatch(/edit_file \(SEARCH\/REPLACE\)/);
    expect(guidance).not.toMatch(/grammar-enforced/);
  });

  it("mid accuracy: search/replace with tighter reminders, whole-file allowed under the LOC cap", () => {
    const guidance = buildEditFormatGuidance({ diffApplicationAccuracy: 0.6, constrainedDecodeAvailable: false, effectiveContext: 8000 });
    expect(guidance).toMatch(/moderate/);
    expect(guidance).toMatch(/~400 lines/);
  });

  it("low accuracy: prefers write_file whole-file rewrites", () => {
    const guidance = buildEditFormatGuidance({ diffApplicationAccuracy: 0.2, constrainedDecodeAvailable: false, effectiveContext: 8000 });
    expect(guidance).toMatch(/write_file \(whole-file rewrite\)/);
    expect(guidance).toMatch(/low/);
  });

  it("the unprobed default (0.75, no constrained decode) matches the pre-wiring default prompt line", () => {
    const guidance = buildEditFormatGuidance({ diffApplicationAccuracy: 0.75, constrainedDecodeAvailable: false, effectiveContext: 32_000 });
    expect(guidance).toBe("Use edit_file (SEARCH/REPLACE) for existing files; write_file is fine for new files.");
  });
});

describe("buildSystemPrompt", () => {
  it("without a profile, falls back to the original static edit-format line", () => {
    expect(buildSystemPrompt()).toContain("Prefer edit_file (SEARCH/REPLACE) over rewriting whole files.");
  });

  it("with a profile, embeds the computed guidance instead", () => {
    const prompt = buildSystemPrompt({ diffApplicationAccuracy: 0.2, constrainedDecodeAvailable: false, effectiveContext: 8000 });
    expect(prompt).toContain("write_file (whole-file rewrite)");
    expect(prompt).not.toContain("Prefer edit_file (SEARCH/REPLACE) over rewriting whole files.");
  });
});

describe("buildInitialMessages", () => {
  it("produces [system, user-task], threading the edit-format profile into the system prompt", () => {
    const messages = buildInitialMessages("fix the bug", { diffApplicationAccuracy: 0.9, constrainedDecodeAvailable: true, effectiveContext: 8000 });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toMatch(/grammar-enforced/);
    expect(messages[1]).toEqual({ role: "user", content: "fix the bug" });
  });
});
