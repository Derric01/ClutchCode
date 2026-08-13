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

/** Thin, typed wrapper over `git` — every worktree/checkpoint/rollback operation goes through this. */
export function git(args: string[], opts: GitExecOptions): string {
  try {
    return execFileSync("git", args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 50_000_000 });
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
