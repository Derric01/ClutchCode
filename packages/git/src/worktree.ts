import fs from "node:fs";
import path from "node:path";
import { git } from "./git-exec.js";
import { handleDirtyTree, restoreStash, type DirtyTreeResult, type DirtyTreeStrategy } from "./dirty-tree.js";

/**
 * Git worktree isolation per run (PROJECT_SPEC.md §13.1).
 *
 * ```
 * On `agent run` in a git repo:
 *   base = current HEAD (record base_commit in RunState)
 *   branch = clutchcode/run-<short_run_id>-<slug>
 *   worktree = git worktree add <state_dir>/wt/<run_id> -b <branch> <base>
 *   ALL agent edits/commands happen inside <worktree>, never in the user's main tree.
 * ```
 */

export interface CreateRunOptions {
  /** The user's main repo (or any existing worktree of it). Read as a base, never written (§13.1). */
  repoPath: string;
  /** Where run worktrees live, e.g. `~/.local/state/clutchcode/runs`. */
  stateDir: string;
  runId: string;
  slug: string;
  dirtyTreeStrategy?: DirtyTreeStrategy;
}

export interface RunWorktree {
  runId: string;
  branch: string;
  baseCommit: string;
  worktreePath: string;
  repoPath: string;
  dirtyTreeResult: DirtyTreeResult;
  /** The branch checked out in `repoPath` when the run started, best-effort (§13.5 `agent pr`'s PR base) — undefined if `repoPath` was in detached-HEAD state. */
  baseBranch?: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "run"
  );
}

export function createRunWorktree(opts: CreateRunOptions): RunWorktree {
  const dirtyResult = handleDirtyTree(opts.repoPath, opts.dirtyTreeStrategy ?? "stash");
  const base =
    dirtyResult.strategyUsed === "temp-commit" && dirtyResult.tempCommitSha
      ? dirtyResult.tempCommitSha
      : git(["rev-parse", "HEAD"], { cwd: opts.repoPath }).trim();

  const shortId = opts.runId.slice(0, 8);
  const branch = `clutchcode/run-${shortId}-${slugify(opts.slug)}`;
  const worktreePath = path.join(opts.stateDir, "wt", opts.runId);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  // Best-effort: empty (not thrown) on detached HEAD — a PR base is then left to the caller.
  const baseBranch = git(["symbolic-ref", "--short", "HEAD"], { cwd: opts.repoPath, allowFailure: true }).trim() || undefined;

  git(["worktree", "add", worktreePath, "-b", branch, base], { cwd: opts.repoPath });

  return { runId: opts.runId, branch, baseCommit: base, worktreePath, repoPath: opts.repoPath, dirtyTreeResult: dirtyResult, baseBranch };
}

/** `agent diff`: worktree vs base (§13.2). */
export function diffAgainstBase(run: RunWorktree, pathScope?: string): string {
  const args = pathScope ? ["diff", run.baseCommit, "--", pathScope] : ["diff", run.baseCommit];
  return git(args, { cwd: run.worktreePath });
}

export function diffStat(run: RunWorktree): string {
  return git(["diff", "--stat", run.baseCommit], { cwd: run.worktreePath });
}

/**
 * A checkpoint commit at each successful verify (§13.2), so rollback is
 * per-step. `--no-verify` bypasses the user's hooks for internal
 * checkpoints (§13.4: hooks run only on the final approved commit).
 * Returns null if there was nothing to checkpoint.
 */
export function checkpoint(run: RunWorktree, message: string): string | null {
  git(["add", "-A"], { cwd: run.worktreePath });
  const status = git(["status", "--porcelain"], { cwd: run.worktreePath, allowFailure: true });
  if (!status.trim()) return null;
  git(["commit", "--no-verify", "-m", `checkpoint: ${message}`], { cwd: run.worktreePath });
  return git(["rev-parse", "HEAD"], { cwd: run.worktreePath }).trim();
}

export interface CheckpointRecord {
  sha: string;
  message: string;
}

export function listCheckpoints(run: RunWorktree): CheckpointRecord[] {
  const out = git(["log", `${run.baseCommit}..HEAD`, "--oneline", "--reverse"], {
    cwd: run.worktreePath,
    allowFailure: true
  });
  if (!out.trim()) return [];
  return out
    .trim()
    .split("\n")
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return spaceIdx === -1 ? { sha: line, message: "" } : { sha: line.slice(0, spaceIdx), message: line.slice(spaceIdx + 1) };
    });
}

/**
 * Rollback to an earlier checkpoint, including untracked files created
 * after it (§13.3). Because every checkpoint commit is preceded by
 * `git add -A`, any file created after the target checkpoint but before the
 * next one is untracked relative to it; `reset --hard` restores tracked
 * content and `clean -fd` removes those untracked leftovers —
 * `.gitignore`d build artifacts are left alone by design (`-d` without `-x`).
 */
export function rollbackTo(run: RunWorktree, sha: string): void {
  git(["reset", "--hard", sha], { cwd: run.worktreePath });
  git(["clean", "-fd"], { cwd: run.worktreePath });
}

/** `agent reject`: discard the worktree and its branch entirely (§13.1). */
export function discardRun(run: RunWorktree): void {
  git(["worktree", "remove", "--force", run.worktreePath], { cwd: run.repoPath, allowFailure: true });
  git(["branch", "-D", run.branch], { cwd: run.repoPath, allowFailure: true });
  if (run.dirtyTreeResult.strategyUsed === "stash" && run.dirtyTreeResult.stashRef) {
    restoreStash(run.repoPath, run.dirtyTreeResult.stashRef);
  }
}

export interface ApproveOptions {
  squash?: boolean;
  message?: string;
  /** Branch in `repoPath` to merge into; defaults to whatever is currently checked out. */
  targetBranch?: string;
}

/** `agent approve`: merge the run branch into the user's branch (§13.1/§13.5). Never runs without an explicit call. */
export function approveRun(run: RunWorktree, opts: ApproveOptions = {}): { mergedSha: string } {
  if (opts.targetBranch) {
    git(["checkout", opts.targetBranch], { cwd: run.repoPath });
  }

  if (opts.squash) {
    git(["merge", "--squash", run.branch], { cwd: run.repoPath });
    // A run that made no edits (e.g. a review-only task, §8.2) leaves
    // nothing staged after `--squash` — `git commit` would fail loudly on
    // "nothing to commit". Treat that as a legitimate no-op approval
    // instead of an error.
    const staged = git(["diff", "--cached", "--name-only"], { cwd: run.repoPath, allowFailure: true });
    if (staged.trim().length > 0) {
      // No `--no-verify` here (unlike `checkpoint()`): §13.4 "Commit hooks"
      // — the user's pre-commit hooks are bypassed for internal
      // checkpoints but MUST run on this, the final approved commit. If a
      // hook rejects it, `git()` throws and the approval fails loudly
      // rather than silently landing unverified content.
      git(["commit", "-m", opts.message ?? `clutchcode: squash merge ${run.branch}`], { cwd: run.repoPath });
    }
  } else {
    // `git merge` (unlike `git commit`) runs pre-merge-commit/commit-msg
    // hooks by default — already correct, no `--no-verify` here either.
    git(["merge", "--no-ff", run.branch, "-m", opts.message ?? `clutchcode: merge ${run.branch}`], { cwd: run.repoPath });
  }

  const mergedSha = git(["rev-parse", "HEAD"], { cwd: run.repoPath }).trim();

  git(["worktree", "remove", "--force", run.worktreePath], { cwd: run.repoPath, allowFailure: true });
  if (run.dirtyTreeResult.strategyUsed === "stash" && run.dirtyTreeResult.stashRef) {
    restoreStash(run.repoPath, run.dirtyTreeResult.stashRef);
  }
  // Branch is retained until the run is deleted (§13.1), only the worktree checkout is removed.

  return { mergedSha };
}
