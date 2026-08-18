import fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * macOS Tier 1 keychain (PROJECT_SPEC.md §5.1): the `security` CLI against
 * the user's login keychain (`add-generic-password` / `find-generic-password`
 * / `delete-generic-password`) — the same surface `git-credential-osxkeychain`
 * and countless install scripts use. Written against the documented,
 * decades-stable `security(1)` command grammar but **not runtime-verified**
 * — no macOS host exists in this environment. Same honesty flag as
 * `tier1-macos.ts`'s Seatbelt profile: type-correct and spec-faithful, not
 * claimed to have actually run.
 *
 * Argv construction is split into pure `build*Args` functions — same
 * pattern as `tier1-macos.ts`'s `buildSeatbeltProfile`/`buildSeatbeltSpawn`
 * — so the exact command shape is directly assertable in tests without
 * mocking `child_process` or a real `security` binary.
 *
 * **Known, disclosed limitation:** `security add-generic-password -w
 * <value>` takes the secret as a command-line argument, which is briefly
 * visible to other processes on the same machine via `ps`/`/proc` during
 * the call (the same caveat that applies to any CLI-only integration with
 * Keychain Services — there's no documented way to pipe a password to
 * `security` over stdin). Linux's `secret-tool` avoids this by taking the
 * secret on stdin; macOS's official CLI does not offer that. Closing this
 * gap for real would mean a native Keychain Services binding
 * (Security.framework), which is the "optional Rust helper" §19/§20
 * already names as out-of-scope for now — flagged here rather than
 * glossed over.
 */

const SERVICE = "clutchcode";
const TIMEOUT_MS = 3000;

export interface KeychainInvocation {
  bin: string;
  args: string[];
}

export function detectSecurityCliOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const pathDirs = (env.PATH ?? "").split(":").filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(`${dir}/security`));
}

export function buildSecurityGetArgs(account: string): KeychainInvocation {
  return { bin: "security", args: ["find-generic-password", "-s", SERVICE, "-a", account, "-w"] };
}

export function buildSecuritySetArgs(account: string, value: string): KeychainInvocation {
  // -U: update in place if an entry for this service+account already
  // exists, instead of erroring "already exists".
  return { bin: "security", args: ["add-generic-password", "-s", SERVICE, "-a", account, "-w", value, "-U"] };
}

export function buildSecurityClearArgs(account: string): KeychainInvocation {
  return { bin: "security", args: ["delete-generic-password", "-s", SERVICE, "-a", account] };
}

// "not found"/no such keychain entry is a routine, expected outcome —
// its stderr text must never leak into the agent's own logs/terminal.
const SILENT_STDIO: ["ignore", "pipe", "ignore"] = ["ignore", "pipe", "ignore"];

export function securityGet(account: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const { bin, args } = buildSecurityGetArgs(account);
    const out = execFileSync(bin, args, { encoding: "utf8", env, timeout: TIMEOUT_MS, stdio: SILENT_STDIO });
    const value = out.replace(/\n$/, "");
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function securitySet(account: string, value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const { bin, args } = buildSecuritySetArgs(account, value);
    execFileSync(bin, args, { encoding: "utf8", env, timeout: TIMEOUT_MS, stdio: SILENT_STDIO });
    return true;
  } catch {
    return false;
  }
}

export function securityClear(account: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const { bin, args } = buildSecurityClearArgs(account);
    execFileSync(bin, args, { encoding: "utf8", env, timeout: TIMEOUT_MS, stdio: SILENT_STDIO });
    return true;
  } catch {
    return false;
  }
}
