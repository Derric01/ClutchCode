import { fileStoreClear, fileStoreGet, fileStoreSet, type FileStoreOptions } from "./credential-file-store.js";
import { detectKeychainBackend, keychainClear, keychainGet, keychainSet, type KeychainBackend } from "./keychain.js";

/**
 * Credential lookup (PROJECT_SPEC.md §5.1). Precedence in the full spec is
 * (1) OS keychain, (2) encrypted file store, (3) environment variables.
 * All three tiers are implemented:
 *
 * - Tier 1 (OS keychain): Linux via the freedesktop Secret Service
 *   (`secret-tool`/libsecret), verified against a real running keyring
 *   (`keychain-linux.test.ts`); macOS via the `security` CLI and Windows
 *   via DPAPI-backed PowerShell, both written against documented, stable
 *   OS interfaces but not runtime-verified — no macOS/Windows host exists
 *   in this environment (see `keychain-macos.ts`/`keychain-windows.ts`
 *   for the exact, disclosed scope of that gap).
 * - Tier 2 (`~/.config/clutchcode/credentials.age`, encrypted file
 *   store): used only when tier 1 reports no keychain backend at all
 *   (headless Linux, some Profile-D servers) — see
 *   `credential-file-store.ts` for the encryption design and its own
 *   disclosed scoping decisions. Uniformly real everywhere (Node's
 *   built-in `crypto`, no OS-specific binary), so unlike tier 1 it needs
 *   no platform-verification caveat.
 * - Tier 3 (env vars) is always available and never silently overridden:
 *   `loadCredentialsFromEnv` is exported standalone for callers (tests,
 *   `--yes`/CI flows) that want the escape hatch without touching the OS
 *   keychain or file store at all.
 */

export interface Credentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

/** The account identifiers used inside the OS keychain / file store — only actual secrets get one; `openaiBaseUrl` isn't a secret and is never stored in either. */
const CREDENTIAL_ACCOUNTS = {
  anthropicApiKey: "anthropic-api-key",
  openaiApiKey: "openai-api-key"
} as const satisfies Record<"anthropicApiKey" | "openaiApiKey", string>;

export type CredentialKind = keyof typeof CREDENTIAL_ACCOUNTS;

export type CredentialStorageBackend = KeychainBackend | "file-store";

/** Tier 3 only — the documented escape hatch, always available, no OS bindings required to build/test. */
export function loadCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL
  };
}

function readCredential(kind: CredentialKind, backend: KeychainBackend, env: NodeJS.ProcessEnv, fileStore?: FileStoreOptions): string | undefined {
  const account = CREDENTIAL_ACCOUNTS[kind];
  if (backend !== "none") return keychainGet(backend, account, env);
  return fileStoreGet(account, fileStore);
}

/**
 * The full §5.1 precedence chain a real run should use: OS keychain first;
 * when no keychain backend exists at all, the encrypted file store;
 * environment variables as the final fallback. Both storage tiers are
 * best-effort and silent on failure by construction — a locked keyring,
 * a missing backend, a wrong file-store passphrase, or a headless server
 * all just fall through to the next tier, never a hard error.
 */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env, fileStore?: FileStoreOptions): Credentials {
  const fromEnv = loadCredentialsFromEnv(env);
  const { backend } = detectKeychainBackend(process.platform, env);
  return {
    anthropicApiKey: readCredential("anthropicApiKey", backend, env, fileStore) ?? fromEnv.anthropicApiKey,
    openaiApiKey: readCredential("openaiApiKey", backend, env, fileStore) ?? fromEnv.openaiApiKey,
    openaiBaseUrl: fromEnv.openaiBaseUrl
  };
}

export interface CredentialWriteResult {
  backend: CredentialStorageBackend;
  ok: boolean;
}

/** Writes a credential: the OS keychain if one exists on this platform, otherwise the encrypted file store (§5.1 tiers 1/2). Never silently drops it to nowhere. */
export function saveCredential(kind: CredentialKind, value: string, env: NodeJS.ProcessEnv = process.env, fileStore?: FileStoreOptions): CredentialWriteResult {
  const account = CREDENTIAL_ACCOUNTS[kind];
  const { backend } = detectKeychainBackend(process.platform, env);
  if (backend !== "none") return { backend, ok: keychainSet(backend, account, value, env) };
  return { backend: "file-store", ok: fileStoreSet(account, value, fileStore) };
}

/** Removes a credential from whichever tier (keychain or file store) would have served it. */
export function clearCredential(kind: CredentialKind, env: NodeJS.ProcessEnv = process.env, fileStore?: FileStoreOptions): CredentialWriteResult {
  const account = CREDENTIAL_ACCOUNTS[kind];
  const { backend } = detectKeychainBackend(process.platform, env);
  if (backend !== "none") return { backend, ok: keychainClear(backend, account, env) };
  return { backend: "file-store", ok: fileStoreClear(account, fileStore) };
}
