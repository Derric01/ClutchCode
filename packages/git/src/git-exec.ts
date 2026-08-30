import { execFileSync } from "node:child_process";

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly stderr: string,
    public readonly status: number | null
  ) {
    super(`git ${args.join(" ")} failed (${status}): ${stderr.trim()}`);
    this.name = "GitError";
  }
}

export interface GitExecOptions {
  cwd: string;
  allowFailure?: boolean;
}

/**
 * Thin, typed wrapper over `git` — every worktree/checkpoint/rollback operation goes through this.
 *
 * `stdio` is set explicitly, not left to `execFileSync`'s default: Node's own
 * documented quirk is that even though the default `stdio` is `'pipe'`,
 * stderr specifically still gets forwarded live to the *parent* process'
 * stderr unless `stdio` is passed as an explicit array — the same gotcha
 * already fixed for the keychain wrappers (see `keychain-linux.ts`). Every
 * `git()` call that expects to fail routinely (`allowFailure: true`, e.g.
 * probing for an optional `AGENTS.md`) was leaking a raw `fatal: ...` line to
 * the real CLI's console on every run of a repo lacking one — the literal
 * first thing a new user saw. Fixed by explicitly piping stderr (captured
 * into `err.stderr` for `GitError`'s message, same as before) instead of
 * leaving it on the implicit default that also echoes it live — verified
 * empirically that both behaviors hold: no console leak, and `err.stderr`
 * is still fully populated for every other (non-`allowFailure`) caller.
 */
export function git(args: string[], opts: GitExecOptions): string {
  try {
    return execFileSync("git", args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 50_000_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; status?: number | null; message?: string };
    if (opts.allowFailure) return "";
    const stderr = err.stderr ? err.stderr.toString() : (err.message ?? "unknown git error");
    throw new GitError(args, stderr, err.status ?? null);
  }
}

export function isGitRepo(dir: string): boolean {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8" });
    return out.trim() === "true";
  } catch {
    return false;
  }
}
