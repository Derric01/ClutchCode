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
  /**
   * A stable identifier for the auto-stash, if strategy was "stash" — the
   * commit SHA of the stash entry (`git rev-parse stash@{0}` at push time),
   * not its positional `stash@{N}` name. A positional name captured once at
   * push time can silently point at the wrong entry by the time
   * `restoreStash` runs if anything else pushes another stash on this repo
   * in between (a plausible manual `git stash` by the user during a
   * long-running run) — the SHA is resolved back to whatever position it
   * currently occupies at restore time instead, so it always names the
   * same entry regardless of what else has happened to the stash stack.
   */
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
    // The stash's own commit SHA, not a positional `stash@{0}` name — see
    // the `stashRef` doc comment above for why positional names aren't
    // safe to reuse later.
    const sha = git(["rev-parse", "stash@{0}"], { cwd: repoPath }).trim();
    return { wasDirty: true, strategyUsed: "stash", stashRef: sha };
  }

  // temp-commit (opt-in, §13.4 case b): capture the dirty state (incl.
  // untracked) as a commit so the worktree can be based on it, then
  // `reset --soft` the user's branch back one commit so their working tree
  // is left exactly as it was (still uncommitted) — the temp commit SHA
  // remains a valid worktree base via the reflog/dangling-commit, without
  // permanently rewriting the user's branch history.
  //
  // `git add -A` (needed so the temp commit captures untracked files too)
  // stages *everything*, collapsing whatever staged/unstaged split the user
  // had before this ran (e.g. `git add`ed half a file's hunks, left the
  // rest — or an entirely untracked file — alone). `reset --soft HEAD~1`
  // only moves HEAD back; it does not touch the index, so without more the
  // index is left matching the *full* temp-commit content instead of the
  // user's original split. Captured as a tree object via `write-tree`
  // before touching anything, then restored verbatim via `read-tree` after
  // — `write-tree`/`read-tree` operate purely on the index (never the
  // working tree), so this exactly reproduces the original staged/unstaged
  // state, including a partially-staged (some hunks staged, some not) file,
  // not just the common fully-staged/fully-unstaged cases.
  const beforeIndexTree = git(["write-tree"], { cwd: repoPath }).trim();
  git(["add", "-A"], { cwd: repoPath });
  git(["commit", "--no-verify", "-m", "clutchcode: temporary commit of dirty state before run"], { cwd: repoPath });
  const sha = git(["rev-parse", "HEAD"], { cwd: repoPath }).trim();
  git(["reset", "--soft", "HEAD~1"], { cwd: repoPath });
  git(["read-tree", beforeIndexTree], { cwd: repoPath });
  return { wasDirty: true, strategyUsed: "temp-commit", tempCommitSha: sha };
}

/**
 * Resolve a stash's stable commit SHA (see `DirtyTreeResult.stashRef`) back
 * to whatever positional `stash@{N}` it currently occupies. Returns
 * `undefined` if the SHA no longer names any entry in the stash list (it
 * was already restored, or dropped, some other way).
 */
function findCurrentStashPosition(repoPath: string, sha: string): string | undefined {
  const list = git(["stash", "list", "--format=%H"], { cwd: repoPath, allowFailure: true });
  const lines = list
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const index = lines.indexOf(sha);
  return index === -1 ? undefined : `stash@{${index}}`;
}

/**
 * Undo a "stash" strategy after the run finishes (or is abandoned).
 * `stashRef` is the stable SHA captured by `handleDirtyTree`, not a
 * positional name — resolved back to its current stack position here so a
 * manual `git stash` elsewhere on this repo in between doesn't make this
 * pop the wrong entry. `--index` best-effort restores the original staged/
 * unstaged split (matches `write-tree`/`read-tree`'s exact restoration for
 * the temp-commit strategy above for simple cases; git's own stash
 * machinery doesn't guarantee hunk-level precision for a file that was
 * genuinely partially staged, which is a limit of `git stash --index`
 * itself, not something this wrapper can improve on).
 */
export function restoreStash(repoPath: string, stashRef: string): void {
  const position = findCurrentStashPosition(repoPath, stashRef);
  if (!position) {
    throw new Error(
      `clutchcode: auto-stash ${stashRef} is no longer in the stash list (already restored, or removed some other way) — nothing to restore`
    );
  }
  git(["stash", "pop", "--index", position], { cwd: repoPath });
}
