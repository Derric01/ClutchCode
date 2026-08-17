import { detectKeychainBackend, keychainClear, keychainGet, keychainSet, type KeychainBackend } from "./keychain.js";

/**
 * Credential lookup (PROJECT_SPEC.md §5.1). Precedence in the full spec is
 * (1) OS keychain, (2) encrypted file store, (3) environment variables.
 *
 * Tier 1 (OS keychain) is implemented: Linux via the freedesktop Secret
 * Service (`secret-tool`/libsecret), verified against a real running
 * keyring (`keychain-linux.test.ts`); macOS via the `security` CLI and
 * Windows via DPAPI-backed PowerShell, both written against documented,
 * stable OS interfaces but not runtime-verified — no macOS/Windows host
 * exists in this environment (see `keychain-macos.ts`/`keychain-windows.ts`
 * for the exact, disclosed scope of that gap).
 *
 * Tier 2 (`~/.config/clutchcode/credentials.age`, encrypted file store) is
 * a named, not-yet-implemented gap — a real key-derivation/encryption
 * design deserves its own pass rather than being folded in here. Its
 * absence just means the precedence chain currently falls through from
 * tier 1 straight to tier 3 (env vars) when no keychain entry exists.
 *
 * Tier 3 (env vars) is always available and never silently overridden:
 * `loadCredentialsFromEnv` is exported standalone for callers (tests,
 * `--yes`/CI flows) that want the escape hatch without touching the OS
 * keychain at all.
 */

export interface Credentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

/** The account identifiers used inside the OS keychain — only actual secrets get one; `openaiBaseUrl` isn't a secret and is never stored here. */
const KEYCHAIN_ACCOUNTS = {
  anthropicApiKey: "anthropic-api-key",
  openaiApiKey: "openai-api-key"
} as const satisfies Record<"anthropicApiKey" | "openaiApiKey", string>;

export type CredentialKind = keyof typeof KEYCHAIN_ACCOUNTS;

/** Tier 3 only — the documented escape hatch, always available, no OS bindings required to build/test. */
export function loadCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL
  };
}

/**
 * The full §5.1 precedence chain a real run should use: OS keychain first,
 * environment variables as the fallback (tier 2 not yet implemented — see
 * module doc comment). Keychain lookups are best-effort and silent on
 * failure by construction (see `keychain-linux.ts`'s doc comment) — a
 * locked keyring, missing backend, or headless server all just fall
 * through to env vars, never a hard error.
 */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const fromEnv = loadCredentialsFromEnv(env);
  const { backend } = detectKeychainBackend(process.platform, env);
  if (backend === "none") return fromEnv;
  return {
    anthropicApiKey: keychainGet(backend, KEYCHAIN_ACCOUNTS.anthropicApiKey, env) ?? fromEnv.anthropicApiKey,
    openaiApiKey: keychainGet(backend, KEYCHAIN_ACCOUNTS.openaiApiKey, env) ?? fromEnv.openaiApiKey,
    openaiBaseUrl: fromEnv.openaiBaseUrl
  };
}

export interface CredentialWriteResult {
  backend: KeychainBackend;
  ok: boolean;
}

/** Writes a credential into the OS keychain (§5.1 tier 1). `ok: false` with `backend: "none"` means no keychain backend is available on this platform — the caller should fall back to telling the user to set the env var instead. */
export function saveCredential(kind: CredentialKind, value: string, env: NodeJS.ProcessEnv = process.env): CredentialWriteResult {
  const { backend } = detectKeychainBackend(process.platform, env);
  if (backend === "none") return { backend, ok: false };
  return { backend, ok: keychainSet(backend, KEYCHAIN_ACCOUNTS[kind], value, env) };
}

/** Removes a credential from the OS keychain, if one is present. */
export function clearCredential(kind: CredentialKind, env: NodeJS.ProcessEnv = process.env): CredentialWriteResult {
  const { backend } = detectKeychainBackend(process.platform, env);
  if (backend === "none") return { backend, ok: false };
  return { backend, ok: keychainClear(backend, KEYCHAIN_ACCOUNTS[kind], env) };
}
