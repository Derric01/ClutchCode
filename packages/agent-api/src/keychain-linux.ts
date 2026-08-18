import fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Linux Tier 1 keychain (PROJECT_SPEC.md §5.1): the freedesktop Secret
 * Service via `secret-tool` (libsecret) — the same mechanism
 * `git-credential-libsecret`, Python's `keyring`, and Node's `keytar` use.
 * Verified against a real, running Secret Service — see
 * `keychain-linux.test.ts`, which spins up a throwaway D-Bus session bus +
 * `gnome-keyring-daemon` rooted at a fresh temp `$HOME` (the standard
 * headless-testing trick for libsecret) and skips itself if `secret-tool`
 * genuinely isn't on PATH, rather than faking success — same convention as
 * `tier1-linux.test.ts`'s bwrap gate.
 *
 * In normal desktop use we never manage the D-Bus session or keyring
 * lifecycle ourselves: `secret-tool` picks up the user's already-running
 * session bus (`$DBUS_SESSION_BUS_ADDRESS`) and already-unlocked login
 * keyring transparently. Only the test harness fabricates a session,
 * because CI/dev containers don't have a desktop session running.
 *
 * Every call here is best-effort and silent on failure by design: a locked
 * keyring, no Secret Service running, a headless server with no session
 * bus, or `secret-tool` missing must all just look like "not available" to
 * the caller (§5.1's precedence chain falls through to the next tier) —
 * never a hard error, and never a hang (a 3s timeout backstops the case
 * where D-Bus tries to autolaunch and stalls instead of failing fast).
 */

const SERVICE = "clutchcode";
const TIMEOUT_MS = 3000;

export function detectSecretToolOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const pathDirs = (env.PATH ?? "").split(":").filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(`${dir}/secret-tool`));
}

export function secretToolGet(account: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const out = execFileSync("secret-tool", ["lookup", "service", SERVICE, "account", account], {
      encoding: "utf8",
      env,
      timeout: TIMEOUT_MS,
      // "not found"/"no session bus" is an expected, routine outcome on
      // every run without a stored key or without a desktop session — its
      // stderr text must never leak into the agent's own logs/terminal.
      stdio: ["ignore", "pipe", "ignore"]
    });
    const value = out.replace(/\n$/, "");
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function secretToolSet(account: string, value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    execFileSync("secret-tool", ["store", "--label", `ClutchCode: ${account}`, "service", SERVICE, "account", account], {
      input: value,
      encoding: "utf8",
      env,
      timeout: TIMEOUT_MS,
      stdio: ["pipe", "pipe", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

export function secretToolClear(account: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    execFileSync("secret-tool", ["clear", "service", SERVICE, "account", account], {
      encoding: "utf8",
      env,
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}
