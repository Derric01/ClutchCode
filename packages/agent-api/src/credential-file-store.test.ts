import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credentialFilePath, defaultCredentialConfigDir, fileStoreClear, fileStoreGet, fileStoreSet } from "./credential-file-store.js";

/**
 * §5.1 tier 2 — unlike the OS keychain (tier 1), this uses only Node's
 * built-in `crypto` and the real filesystem, so it's genuinely testable
 * everywhere this repo builds; no platform-verification caveat applies.
 */

describe("defaultCredentialConfigDir", () => {
  it("resolves under the user's home directory (§5.1's documented path)", () => {
    expect(defaultCredentialConfigDir()).toBe(path.join(os.homedir(), ".config", "clutchcode"));
  });
});

describe("fileStoreGet/Set/Clear — real AES-256-GCM encryption, real filesystem", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-credfile-test-"));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("get on a fresh config dir (nothing ever stored) returns undefined, not an error", () => {
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    expect(fileStoreSet("anthropic-api-key", "sk-ant-file-store-test", { configDir })).toBe(true);
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBe("sk-ant-file-store-test");
  });

  it("the credentials file on disk is never plaintext", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-must-not-appear-in-cleartext", { configDir });
    const raw = fs.readFileSync(credentialFilePath(configDir), "utf8");
    expect(raw).not.toContain("sk-ant-must-not-appear-in-cleartext");
  });

  it("multiple accounts are stored independently", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir });
    fileStoreSet("openai-api-key", "sk-openai-value", { configDir });
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBe("sk-ant-value");
    expect(fileStoreGet("openai-api-key", { configDir })).toBe("sk-openai-value");
  });

  it("refuses to write over a corrupted (undecryptable) store instead of silently overwriting it with just the one account being set — leaving every previously-stored credential unrecoverably gone (real bug caught in round 3 of security review)", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-original", { configDir });
    fileStoreSet("openai-api-key", "sk-openai-original", { configDir });
    // Simulate a partial/killed write leaving a corrupted envelope on disk
    // — machine.key untouched, so this specifically exercises "file
    // exists but can't be decrypted," not "wrong key."
    const filePath = credentialFilePath(configDir);
    const corruptedBytes = "not valid json at all";
    fs.writeFileSync(filePath, corruptedBytes, "utf8");

    const result = fileStoreSet("anthropic-api-key", "sk-ant-rotated-after-corruption", { configDir });
    expect(result).toBe(false);
    // The corrupted file is left exactly as it was — not silently
    // overwritten with a fresh, valid-looking, single-account envelope
    // that would erase any trace the openai-api-key entry ever existed.
    expect(fs.readFileSync(filePath, "utf8")).toBe(corruptedBytes);
  });

  it("fileStoreClear also refuses to write over a corrupted store", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-original", { configDir });
    const filePath = credentialFilePath(configDir);
    const corruptedBytes = "also not valid json";
    fs.writeFileSync(filePath, corruptedBytes, "utf8");

    expect(fileStoreClear("anthropic-api-key", { configDir })).toBe(false);
    expect(fs.readFileSync(filePath, "utf8")).toBe(corruptedBytes);
  });

  it("a second set for the same account overwrites the first", () => {
    fileStoreSet("anthropic-api-key", "first-value", { configDir });
    fileStoreSet("anthropic-api-key", "second-value", { configDir });
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBe("second-value");
  });

  it("clear removes one account without disturbing others", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir });
    fileStoreSet("openai-api-key", "sk-openai-value", { configDir });
    expect(fileStoreClear("anthropic-api-key", { configDir })).toBe(true);
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBeUndefined();
    expect(fileStoreGet("openai-api-key", { configDir })).toBe("sk-openai-value");
  });

  it("clear on an account that was never stored returns false, not an error", () => {
    expect(fileStoreClear("never-stored", { configDir })).toBe(false);
  });

  it("persists across separate calls — no in-memory-only state", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-persisted", { configDir });
    // A fresh call with only the configDir, simulating a new process reading the same on-disk state.
    expect(fileStoreGet("anthropic-api-key", { configDir: `${configDir}` })).toBe("sk-ant-persisted");
  });

  it("the machine key file is created with owner-only permissions", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir });
    const stat = fs.statSync(path.join(configDir, "machine.key"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("the credentials file is created with owner-only permissions", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir });
    const stat = fs.statSync(credentialFilePath(configDir));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("a passphrase actually participates in the derived key — wrong passphrase fails to decrypt", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir, passphrase: "correct horse battery staple" });
    expect(fileStoreGet("anthropic-api-key", { configDir, passphrase: "wrong passphrase" })).toBeUndefined();
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBeUndefined(); // no passphrase at all also fails
    expect(fileStoreGet("anthropic-api-key", { configDir, passphrase: "correct horse battery staple" })).toBe("sk-ant-value");
  });

  it("a tampered ciphertext fails closed instead of returning corrupted data", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir });
    const p = credentialFilePath(configDir);
    const envelope = JSON.parse(fs.readFileSync(p, "utf8")) as { ciphertext: string };
    envelope.ciphertext = envelope.ciphertext.slice(0, -2) + (envelope.ciphertext.endsWith("ff") ? "00" : "ff");
    fs.writeFileSync(p, JSON.stringify(envelope), "utf8");
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBeUndefined();
  });

  it("a corrupted (non-JSON) credentials file fails closed instead of throwing", () => {
    fileStoreSet("anthropic-api-key", "sk-ant-value", { configDir });
    fs.writeFileSync(credentialFilePath(configDir), "not valid json at all", "utf8");
    expect(() => fileStoreGet("anthropic-api-key", { configDir })).not.toThrow();
    expect(fileStoreGet("anthropic-api-key", { configDir })).toBeUndefined();
  });

  it("two different config dirs (two different machine keys) never see each other's values", () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-credfile-test-other-"));
    try {
      fileStoreSet("anthropic-api-key", "value-in-first-dir", { configDir });
      expect(fileStoreGet("anthropic-api-key", { configDir: otherDir })).toBeUndefined();
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
