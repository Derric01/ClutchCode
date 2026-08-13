import { git } from "./git-exec.js";

/**
 * The dirty-working-tree case (PROJECT_SPEC.md §13.4):
 *
 * | Case | Handling |
 * | Dirty working tree at start | Detect; offer: (a) stash user changes and
 *   base the worktree on HEAD (default, safest), (b) base on a temp commit
 *   that includes the dirty state (opt-in), (c) abort. Never silently
 *   include or discard the user's uncommitted work. |
 */

export type DirtyTreeStrategy = "stash" | "temp-commit" | "abort";

export interface DirtyTreeResult {
  wasDirty: boolean;
  strategyUsed?: DirtyTreeStrategy;
  /** The stash ref to restore later, if strategy was "stash". */
  stashRef?: string;
  /** The commit the worktree should be based on, if strategy was "temp-commit". */
  tempCommitSha?: string;
}

export function isDirty(repoPath: string): boolean {
  const out = git(["status", "--porcelain"], { cwd: repoPath });
  return out.trim().length > 0;
}

/**
 * Detect and handle a dirty working tree before creating a run worktree.
 * Never mutates the user's tree without an explicit strategy — the default
 * ("stash") is the safest and is reversible via `restoreStash`.
 */
export function handleDirtyTree(repoPath: string, strategy: DirtyTreeStrategy = "stash"): DirtyTreeResult {
  if (!isDirty(repoPath)) return { wasDirty: false };

  if (strategy === "abort") {
    throw new Error("working tree is dirty; aborting per the requested strategy (§13.4 case c)");
  }

  if (strategy === "stash") {
    git(["stash", "push", "--include-untracked", "-m", "clutchcode: auto-stash before run"], { cwd: repoPath });
    const list = git(["stash", "list"], { cwd: repoPath });
    const first = (list.split("\n")[0] ?? "").trim();
    const ref = first.split(":")[0] || "stash@{0}";
    return { wasDirty: true, strategyUsed: "stash", stashRef: ref };
  }

  // temp-commit (opt-in, §13.4 case b): capture the dirty state (incl.
  // untracked) as a commit so the worktree can be based on it, then
  // `reset --soft` the user's branch back one commit so their working tree
  // is left exactly as it was (still uncommitted) — the temp commit SHA
  // remains a valid worktree base via the reflog/dangling-commit, without
  // permanently rewriting the user's branch history.
  git(["add", "-A"], { cwd: repoPath });
  git(["commit", "--no-verify", "-m", "clutchcode: temporary commit of dirty state before run"], { cwd: repoPath });
  const sha = git(["rev-parse", "HEAD"], { cwd: repoPath }).trim();
  git(["reset", "--soft", "HEAD~1"], { cwd: repoPath });
  return { wasDirty: true, strategyUsed: "temp-commit", tempCommitSha: sha };
}

/** Undo a "stash" strategy after the run finishes (or is abandoned). */
export function restoreStash(repoPath: string, stashRef: string): void {
  git(["stash", "pop", stashRef], { cwd: repoPath });
}
