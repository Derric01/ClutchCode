import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearCredential, loadCredentials, loadCredentialsFromEnv, saveCredential } from "./credentials.js";
import { detectSecretToolOnPath } from "./keychain-linux.js";
import { startThrowawaySecretService, type ThrowawaySecretService } from "./test-helpers.js";

/** A PATH with no `secret-tool` on it — `detectKeychainBackend` genuinely reports `"none"` for this, not just "unreachable", which is what actually exercises the tier 2 file-store fallback. */
const NO_KEYCHAIN_ENV = { ...process.env, PATH: "/definitely/not/a/real/dir" } as NodeJS.ProcessEnv;

describe("loadCredentialsFromEnv", () => {
  it("reads the documented escape-hatch env vars (§5.1)", () => {
    const creds = loadCredentialsFromEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://example.invalid/v1"
    } as NodeJS.ProcessEnv);

    expect(creds).toEqual({
      anthropicApiKey: "sk-ant-test",
      openaiApiKey: "sk-test",
      openaiBaseUrl: "https://example.invalid/v1"
    });
  });

  it("leaves fields undefined when unset", () => {
    const creds = loadCredentialsFromEnv({} as NodeJS.ProcessEnv);
    expect(creds.anthropicApiKey).toBeUndefined();
    expect(creds.openaiApiKey).toBeUndefined();
  });
});

describe("loadCredentials with no keychain backend reachable — falls through to env vars", () => {
  it("returns exactly what loadCredentialsFromEnv would, when the keychain has nothing stored", () => {
    const env = { ...process.env, ANTHROPIC_API_KEY: "sk-ant-env-fallback", OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined } as NodeJS.ProcessEnv;
    delete env.DBUS_SESSION_BUS_ADDRESS;
    delete env.DISPLAY;
    const creds = loadCredentials(env);
    expect(creds.anthropicApiKey).toBe("sk-ant-env-fallback");
  });
});

describe("saveCredential/clearCredential with no keychain backend reachable", () => {
  it("reports ok: false without throwing when the platform has no usable backend", () => {
    const env = { ...process.env };
    delete env.DBUS_SESSION_BUS_ADDRESS;
    delete env.DISPLAY;
    const result = saveCredential("anthropicApiKey", "sk-ant-x", env);
    // On this Linux container secret-tool IS on PATH, so the backend is
    // "secret-service" but unreachable (no session bus) — ok is false
    // either way, which is the contract callers actually rely on.
    expect(result.ok).toBe(false);
  });
});

/**
 * The real §5.1 precedence chain, proven end to end against a real,
 * throwaway Secret Service — not mocked. Confirms the three properties
 * that actually matter: a keychain-stored credential is preferred over an
 * env var for the *same* account, an account with nothing in the
 * keychain still falls through to its env var, and a credential written
 * via `saveCredential` is exactly what `loadCredentials` reads back.
 */
const hasSecretTool = detectSecretToolOnPath();
const maybeIt = hasSecretTool ? it : it.skip;

describe("loadCredentials/saveCredential/clearCredential — real Secret Service precedence", () => {
  let service: ThrowawaySecretService;

  beforeAll(() => {
    if (hasSecretTool) service = startThrowawaySecretService();
  });

  afterAll(() => {
    service?.close();
  });

  maybeIt("a keychain-stored credential takes precedence over the same-named env var", () => {
    const env = { ...service.env, ANTHROPIC_API_KEY: "sk-ant-should-be-shadowed", OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    const write = saveCredential("anthropicApiKey", "sk-ant-from-keychain", env);
    expect(write).toEqual({ backend: "secret-service", ok: true });

    const creds = loadCredentials(env);
    expect(creds.anthropicApiKey).toBe("sk-ant-from-keychain");
  });

  maybeIt("an account with nothing stored in the keychain falls through to its env var", () => {
    const env = { ...service.env, OPENAI_API_KEY: "sk-openai-env-only", ANTHROPIC_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    const creds = loadCredentials(env);
    expect(creds.openaiApiKey).toBe("sk-openai-env-only");
  });

  maybeIt("openaiBaseUrl always comes from env — it's not a secret and is never stored in the keychain", () => {
    const env = { ...service.env, OPENAI_BASE_URL: "https://example.invalid/v1" };
    expect(loadCredentials(env).openaiBaseUrl).toBe("https://example.invalid/v1");
  });

  maybeIt("clearCredential removes a keychain entry; loadCredentials then falls back to env", () => {
    const env = { ...service.env, ANTHROPIC_API_KEY: "sk-ant-fallback-after-clear", OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    saveCredential("anthropicApiKey", "sk-ant-temporary", env);
    expect(loadCredentials(env).anthropicApiKey).toBe("sk-ant-temporary");

    const cleared = clearCredential("anthropicApiKey", env);
    expect(cleared).toEqual({ backend: "secret-service", ok: true });
    expect(loadCredentials(env).anthropicApiKey).toBe("sk-ant-fallback-after-clear");
  });
});

/**
 * §5.1 tier 2 — the encrypted file store, exercised through the exact
 * same public entrypoints (`loadCredentials`/`saveCredential`/
 * `clearCredential`) a real run uses, with the keychain genuinely absent
 * (no `secret-tool` on PATH at all — the actual "headless server" case
 * tier 2 exists for, not just "keychain unreachable").
 */
describe("loadCredentials/saveCredential/clearCredential — tier 2 file store when no keychain exists at all", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-credfile-precedence-test-"));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("saveCredential falls back to the file store, not just failure, when no keychain exists", () => {
    const result = saveCredential("anthropicApiKey", "sk-ant-file-store", NO_KEYCHAIN_ENV, { configDir });
    expect(result).toEqual({ backend: "file-store", ok: true });
  });

  it("a file-store-stored credential takes precedence over the same-named env var", () => {
    const env = { ...NO_KEYCHAIN_ENV, ANTHROPIC_API_KEY: "sk-ant-should-be-shadowed", OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    saveCredential("anthropicApiKey", "sk-ant-from-file-store", env, { configDir });
    expect(loadCredentials(env, { configDir }).anthropicApiKey).toBe("sk-ant-from-file-store");
  });

  it("an account with nothing in the file store still falls through to its env var", () => {
    const env = { ...NO_KEYCHAIN_ENV, OPENAI_API_KEY: "sk-openai-env-only", ANTHROPIC_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    expect(loadCredentials(env, { configDir }).openaiApiKey).toBe("sk-openai-env-only");
  });

  it("clearCredential removes a file-store entry; loadCredentials then falls back to env", () => {
    const env = { ...NO_KEYCHAIN_ENV, ANTHROPIC_API_KEY: "sk-ant-fallback-after-clear", OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    saveCredential("anthropicApiKey", "sk-ant-temporary", env, { configDir });
    expect(loadCredentials(env, { configDir }).anthropicApiKey).toBe("sk-ant-temporary");

    const cleared = clearCredential("anthropicApiKey", env, { configDir });
    expect(cleared).toEqual({ backend: "file-store", ok: true });
    expect(loadCredentials(env, { configDir }).anthropicApiKey).toBe("sk-ant-fallback-after-clear");
  });

  it("with a keychain available, the file store is never consulted even if it has a value", () => {
    // Simulates a machine that migrated from headless (file store) to
    // having a keychain: an old file-store entry must not resurface once
    // a real keychain backend exists — tier 1 fully owns lookups then.
    saveCredential("anthropicApiKey", "sk-ant-stale-file-store-value", NO_KEYCHAIN_ENV, { configDir });
    const envWithKeychainAndFallbackEnvVar = { ...process.env, ANTHROPIC_API_KEY: "sk-ant-env-fallback", OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined };
    delete envWithKeychainAndFallbackEnvVar.DBUS_SESSION_BUS_ADDRESS;
    delete envWithKeychainAndFallbackEnvVar.DISPLAY;
    // secret-tool IS on PATH in this container, so backend is "secret-service" (just unreachable) — readCredential must not fall through to the file store in that case, only to env.
    expect(loadCredentials(envWithKeychainAndFallbackEnvVar, { configDir }).anthropicApiKey).toBe("sk-ant-env-fallback");
  });
});
