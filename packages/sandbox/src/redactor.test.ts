import { describe, expect, it } from "vitest";
import { Redactor } from "./redactor.js";

describe("Redactor", () => {
  it("redacts a known registered secret by exact match", () => {
    const r = new Redactor();
    r.registerSecret("super-secret-canary-value-123");
    const { text, redactedCount } = r.scrub("the key is super-secret-canary-value-123 in the log");
    expect(text).not.toContain("super-secret-canary-value-123");
    expect(text).toContain("«REDACTED:known-secret»");
    expect(redactedCount).toBe(1);
  });

  it("redacts provider-prefixed keys even when not pre-registered", () => {
    const r = new Redactor();
    const samples = [
      "sk-abcdefghijklmnopqrstuvwx",
      "sk-ant-abcdefghijklmnopqrstuvwx",
      "ghp_abcdefghijklmnopqrstuvwxyz01",
      "AKIAABCDEFGHIJKLMNOP",
      "xai-abcdefghijklmnopqrstuvwxyz",
      "AIzaSyAbcdefghijklmnopqrstuvwxyz01234"
    ];
    for (const s of samples) {
      const { text } = r.scrub(`env dump: TOKEN=${s}`);
      expect(text, `expected ${s} to be redacted`).not.toContain(s);
      expect(text).toMatch(/«REDACTED:/);
    }
  });

  it("does not redact ordinary low-entropy words", () => {
    const r = new Redactor();
    const { text, redactedCount } = r.scrub(
      "this is a perfectly ordinary sentence about the coding agent runtime and its worktree isolation mechanism"
    );
    expect(text).toBe(
      "this is a perfectly ordinary sentence about the coding agent runtime and its worktree isolation mechanism"
    );
    expect(redactedCount).toBe(0);
  });

  it("canary: the same secret is redacted across repeated scrubs (simulated boundary crossings)", () => {
    const r = new Redactor();
    const canary = "canary-secret-value-do-not-leak-9f8e7d6c";
    r.registerSecret(canary);

    const boundaries = [
      `prompt assembly context: ${canary}`,
      `tool output: env dump shows ${canary}`,
      `transcript event: {"data":"${canary}"}`,
      `crash report: uncaught error near ${canary}`
    ];

    for (const boundaryText of boundaries) {
      const { text } = r.scrub(boundaryText);
      expect(text, `canary leaked at boundary: ${boundaryText}`).not.toContain(canary);
    }
  });
});
