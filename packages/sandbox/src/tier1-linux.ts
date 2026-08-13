import { spawnSync } from "node:child_process";

/**
 * Sandbox Tier 1, Linux (PROJECT_SPEC.md §12.5, §12.6): bubblewrap-based
 * process confinement, layered on top of Tier 0 (policy engine + denylist +
 * redaction + destructive gate + network default-deny + env scrub, which
 * are always active regardless of this tier).
 *
 * This module builds bwrap's argv — a deny-by-default sandbox (fresh empty
 * root; only the workspace and the OS's own binaries/libraries are bound
 * in; network namespace unshared unless explicitly allowed) — and detects
 * whether `bwrap` is even installed.
 *
 * Honesty note (§12.7 spirit): argv construction is unit-tested against
 * bwrap's documented flags; *live* confinement has not been exercised
 * against a real `bwrap` binary in this codebase's test environment (none
 * was installed there). Validate on a real Linux box with bwrap before
 * relying on this as a sole security boundary — see packages/tools'
 * shell.ts for how it's wired in (opt-in via `ToolContext.sandboxTier`,
 * off by default, so existing behavior is unchanged unless explicitly enabled).
 */

export interface BwrapOptions {
  /** The only writable path (§12.3, §13: confined to the run's worktree). */
  workspaceRoot: string;
  /** Where the command actually starts — must be `workspaceRoot` or a subdirectory of it to be reachable; defaults to `workspaceRoot`. */
  chdir?: string;
  /** Default false — matches ADR-019 network default-deny. */
  allowNetwork?: boolean;
  /** Extra host paths to bind read-only beyond the OS-standard set (e.g. a toolchain installed outside /usr). */
  extraReadOnlyBinds?: string[];
}

const DEFAULT_READONLY_BINDS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/alternatives", "/etc/ssl", "/etc/resolv.conf"];

let cachedAvailability: boolean | undefined;

/** Cached after the first check; call `resetBwrapAvailabilityCache()` in tests that need to force a re-check. */
export function isBwrapAvailable(): boolean {
  if (cachedAvailability !== undefined) return cachedAvailability;
  try {
    const proc = spawnSync("bwrap", ["--version"], { encoding: "utf8" });
    cachedAvailability = !proc.error && proc.status === 0;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

export function resetBwrapAvailabilityCache(): void {
  cachedAvailability = undefined;
}

/**
 * Builds the argv for `bwrap <flags> -- sh -c <command>`. Deny-by-default:
 * every visible path is bound explicitly; nothing else from the host is
 * reachable. `--ro-bind-try` (not `--ro-bind`) is used for OS paths so a
 * distro missing one (e.g. no separate /lib64) doesn't hard-fail the sandbox.
 */
export function buildBwrapArgv(command: string, opts: BwrapOptions): string[] {
  const args: string[] = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-ipc",
    "--die-with-parent",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp"
  ];

  if (!opts.allowNetwork) args.push("--unshare-net");

  const readOnlyBinds = [...DEFAULT_READONLY_BINDS, ...(opts.extraReadOnlyBinds ?? [])];
  for (const p of readOnlyBinds) args.push("--ro-bind-try", p, p);

  // The worktree: the only writable path (never the user's main tree, §13.1).
  // Binding it makes every subdirectory reachable, so `chdir` may point at
  // a scoped subdirectory (§13.4 monorepo `--scope`) without a second bind.
  args.push("--bind", opts.workspaceRoot, opts.workspaceRoot);
  args.push("--chdir", opts.chdir ?? opts.workspaceRoot);

  args.push("--", "sh", "-c", command);
  return args;
}
