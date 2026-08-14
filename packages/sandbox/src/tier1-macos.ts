import fs from "node:fs";

/**
 * macOS Tier 1 (PROJECT_SPEC.md §12.5/§12.6): a Seatbelt (`sandbox-exec`)
 * profile written in SBPL, confining reads to the standard system dirs +
 * the run's workspace + a synthetic empty `$HOME`, and denying network
 * outright — the same shape as Linux's bwrap backend, expressed in
 * Seatbelt's own policy language rather than namespaces.
 *
 * **Honesty note, stated once and meant literally:** this profile is
 * authored against the documented SBPL grammar (`man sandbox-exec`,
 * `man sandbox.sb`) and the same well-known shape other sandboxed dev
 * tools use (deny-default, allow-list system paths, confine writes to a
 * workspace) — but it has not been run against a real `sandbox-exec` on
 * real macOS anywhere in this codebase's test suite, because no macOS
 * host exists in this environment. `tier1.test.ts` verifies the profile
 * is well-formed (balanced parens, the clauses it must contain) and
 * `detectSandboxExecOnPath` degrades cleanly to Tier 0 when the binary
 * isn't present; actual runtime confinement on macOS is unverified until
 * someone runs it there. Flagged, not silently claimed.
 */

const READONLY_SUBPATHS = ["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/private/var/db/dyld", "/dev"];

export interface SeatbeltSpawnOptions {
  workspaceRoot: string;
  cwd: string;
  command: string;
  /** Presented as `$HOME` — a fresh directory the profile grants read/write, never the real one (§12.1/§12.3). Created on disk by the caller before spawning (unlike bwrap's `--dir`, Seatbelt has no "create an empty dir for me" primitive). */
  homeDir: string;
}

function sbplString(path: string): string {
  // SBPL string literals: escape backslash and double-quote. Paths from
  // this codebase never contain either in practice, but a model-influenced
  // `cwd` argument is untrusted input crossing into a policy string, so
  // it's escaped for real, not assumed safe.
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildSeatbeltProfile(opts: SeatbeltSpawnOptions): string {
  const readSubpaths = [...READONLY_SUBPATHS, opts.homeDir]
    .map((p) => `    (subpath ${sbplString(p)})`)
    .join("\n");

  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-read*",
    readSubpaths,
    "    (subpath \"/private/tmp\")",
    ")",
    `(allow file-read* file-write* (subpath ${sbplString(opts.workspaceRoot)}))`,
    `(allow file-read* file-write* (subpath ${sbplString(opts.homeDir)}))`,
    `(allow file-write* (subpath "/private/tmp"))`,
    "(deny network*)"
  ].join("\n");
}

export function detectSandboxExecOnPath(): boolean {
  return fs.existsSync("/usr/bin/sandbox-exec");
}

export function buildSeatbeltSpawn(opts: SeatbeltSpawnOptions): { bin: string; args: string[] } {
  const profile = buildSeatbeltProfile(opts);
  return { bin: "sandbox-exec", args: ["-p", profile, "/bin/sh", "-c", opts.command] };
}
