import { detectSecretToolOnPath, secretToolClear, secretToolGet, secretToolSet } from "./keychain-linux.js";
import { detectSecurityCliOnPath, securityClear, securityGet, securitySet } from "./keychain-macos.js";
import { detectPowerShellOnPath, dpapiClear, dpapiGet, dpapiSet } from "./keychain-windows.js";

/**
 * OS keychain dispatcher (PROJECT_SPEC.md §5.1 tier 1): picks the right
 * per-platform backend and exposes one small get/set/clear surface over
 * it. `credentials.ts` is the only consumer that matters at runtime —
 * this module exists so that boundary is a single dispatch, not
 * `process.platform` checks scattered through the credential-loading path.
 */

export type KeychainBackend = "secret-service" | "macos-keychain" | "windows-dpapi" | "none";

export interface KeychainDetection {
  backend: KeychainBackend;
  reason: string;
}

export function detectKeychainBackend(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): KeychainDetection {
  if (platform === "linux") {
    return detectSecretToolOnPath(env)
      ? { backend: "secret-service", reason: "secret-tool (libsecret) found on PATH" }
      : {
          backend: "none",
          reason: "secret-tool not found — install libsecret-tools (Debian/Ubuntu), libsecret (Fedora/Arch), or equivalent for OS keychain support; falling back to environment variables"
        };
  }
  if (platform === "darwin") {
    return detectSecurityCliOnPath(env)
      ? { backend: "macos-keychain", reason: "security CLI found on PATH" }
      : { backend: "none", reason: "security CLI not found (unexpected on macOS); falling back to environment variables" };
  }
  if (platform === "win32") {
    return detectPowerShellOnPath(env)
      ? { backend: "windows-dpapi", reason: "PowerShell found on PATH (DPAPI-backed storage)" }
      : { backend: "none", reason: "PowerShell not found on PATH; falling back to environment variables" };
  }
  return { backend: "none", reason: `no OS keychain backend for platform "${platform}"; falling back to environment variables` };
}

export function keychainGet(backend: KeychainBackend, account: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  switch (backend) {
    case "secret-service":
      return secretToolGet(account, env);
    case "macos-keychain":
      return securityGet(account, env);
    case "windows-dpapi":
      return dpapiGet(account, env);
    case "none":
      return undefined;
  }
}

export function keychainSet(backend: KeychainBackend, account: string, value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  switch (backend) {
    case "secret-service":
      return secretToolSet(account, value, env);
    case "macos-keychain":
      return securitySet(account, value, env);
    case "windows-dpapi":
      return dpapiSet(account, value, env);
    case "none":
      return false;
  }
}

export function keychainClear(backend: KeychainBackend, account: string, env: NodeJS.ProcessEnv = process.env): boolean {
  switch (backend) {
    case "secret-service":
      return secretToolClear(account, env);
    case "macos-keychain":
      return securityClear(account, env);
    case "windows-dpapi":
      return dpapiClear(account, env);
    case "none":
      return false;
  }
}
