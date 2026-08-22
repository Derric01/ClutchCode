import fs from "node:fs";
import path from "node:path";
import { git } from "./git-exec.js";
import { handleDirtyTree, restoreStash, type DirtyTreeResult, type DirtyTreeStrategy } from "./dirty-tree.js";
import { assertSafeRunId } from "./run-id.js";

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
  assertSafeRunId(opts.runId);

  const dirtyResult = handleDirtyTree(opts.repoPath, opts.dirtyTreeStrategy ?? "stash");

  try {
    const base =
      dirtyResult.strategyUsed === "temp-commit" && dirtyResult.tempCommitSha
        ? dirtyResult.tempCommitSha
        : git(["rev-parse", "HEAD"], { cwd: opts.repoPath }).trim();

    const shortId = opts.runId.slice(0, 8);
    const branch = `clutchcode/run-${shortId}-${slugify(opts.slug)}`;
    const wtRoot = path.join(opts.stateDir, "wt");
    const worktreePath = path.join(wtRoot, opts.runId);
    // Defense in depth beyond the regex above, in case a future change to
    // stateDir/runId handling (or a platform-specific path quirk) reopens a
    // traversal some other way — this is the actual invariant that matters,
    // checked directly rather than only inferred from input validation.
    if (path.relative(wtRoot, worktreePath).startsWith("..")) {
      throw new Error(`refusing to create a worktree outside ${wtRoot} (resolved to ${worktreePath})`);
    }
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Best-effort: empty (not thrown) on detached HEAD — a PR base is then left to the caller.
    const baseBranch = git(["symbolic-ref", "--short", "HEAD"], { cwd: opts.repoPath, allowFailure: true }).trim() || undefined;

    git(["worktree", "add", worktreePath, "-b", branch, base], { cwd: opts.repoPath });

    return { runId: opts.runId, branch, baseCommit: base, worktreePath, repoPath: opts.repoPath, dirtyTreeResult: dirtyResult, baseBranch };
  } catch (e) {
    // `handleDirtyTree` already had a real, user-visible side effect above
    // (stashed or temp-committed the working tree) before anything past it
    // could fail — a branch-name collision, a disk error, anything from
    // `git worktree add` onward. Without this, that side effect was simply
    // orphaned: the `RunWorktree` that would have carried
    // `dirtyResult.stashRef` back to a caller never gets constructed, so
    // nothing downstream even knows a stash exists to recover. Best effort:
    // undo it automatically so the repo is back exactly how the caller
    // found it; if that itself fails, say so explicitly with enough detail
    // (the stash's own identity) to recover by hand instead of silently
    // discarding it.
    const original = e instanceof Error ? e.message : String(e);
    throw new Error(`createRunWorktree failed: ${original}${describeDirtyTreeRecovery(opts.repoPath, dirtyResult)}`);
  }
}

/**
 * Best-effort recovery narration for `createRunWorktree`'s catch above.
 * "stash" is the only strategy that actually needs undoing here —
 * "temp-commit" already leaves the working tree exactly as it was found
 * (that's the whole point of its own `reset --soft` + index restore), so
 * there is nothing to recover for it beyond the dangling commit itself.
 */
function describeDirtyTreeRecovery(repoPath: string, dirtyResult: DirtyTreeResult): string {
  if (dirtyResult.strategyUsed === "temp-commit" && dirtyResult.tempCommitSha) {
    return ` (your working tree itself was left unchanged — the dirty state is also captured in dangling commit ${dirtyResult.tempCommitSha} if you need it)`;
  }
  if (dirtyResult.strategyUsed !== "stash" || !dirtyResult.stashRef) return "";
  try {
    restoreStash(repoPath, dirtyResult.stashRef);
    return " (the auto-stash was restored automatically — your working tree is unchanged)";
  } catch (restoreErr) {
    const msg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
    return ` (your changes are still stashed and auto-restore failed: ${msg} — recover manually with \`git stash list\` / \`git stash pop\` in ${repoPath}, looking for commit ${dirtyResult.stashRef})`;
  }
}

/** `agent diff`: worktree vs base (§13.2). */
export function diffAgainstBase(run: RunWorktree, pathScope?: string): string {
  const args = pathScope ? ["diff", run.baseCommit, "--", pathScope] : ["diff", run.baseCommit];
  return git(args, { cwd: run.worktreePath });
}

export function diffStat(run: RunWorktree): string {
  return git(["diff", "--stat", run.baseCommit], { cwd: run.worktreePath });
}

export interface FileDiff {
  path: string;
  /** Only set for a rename/copy (git status R/C) — the path it was diffed against. */
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** Full file content at `run.baseCommit`; undefined for `added` and for `binary` files. */
  before?: string;
  /** Full file content in the worktree right now; undefined for `deleted` and for `binary` files. */
  after?: string;
  /** True for a file git itself can't diff as text (binary content, or an LFS pointer's real payload) — `before`/`after` are omitted rather than handed to a caller as mojibake. */
  binary: boolean;
}

/**
 * Per-file before/after content (§18.5's native two-sided diff view needs
 * this — `diffAgainstBase`'s unified-diff text alone can't drive
 * `vscode.diff`, which wants two whole documents). Deliberately a separate
 * function rather than a `diffAgainstBase` option: the unified-diff path
 * stays a single cheap `git diff` call for callers (the CLI, `agent pr`'s
 * body) that only ever wanted text; this one does one extra `git diff
 * --numstat` (for binary detection) plus one `git show`/file read per
 * changed file, real I/O a caller shouldn't pay for by default.
 */
export function diffFilesAgainstBase(run: RunWorktree, pathScope?: string): FileDiff[] {
  // §13.1: `git diff <commit>` (no `--cached`) never reports an untracked
  // path at all, no matter what it's diffed against — a brand-new file the
  // model just wrote would silently vanish from this list unless it's
  // tracked first. `checkpoint()` already stages everything the same way
  // per step; doing it here too is consistent, not a new side effect, and
  // never commits or touches file content.
  git(["add", "-A"], { cwd: run.worktreePath });

  // `-M` (rename detection) isn't universally on by default for `git diff`
  // across git versions/configs — requested explicitly so a rename is
  // reported as one `FileDiff` with `oldPath` set, not an unrelated
  // delete+add pair.
  const nameStatusArgs = pathScope ? ["diff", "--name-status", "-M", run.baseCommit, "--", pathScope] : ["diff", "--name-status", "-M", run.baseCommit];
  const nameStatusOut = git(nameStatusArgs, { cwd: run.worktreePath, allowFailure: true }).trim();
  if (!nameStatusOut) return [];

  return nameStatusOut.split("\n").map((line): FileDiff => {
    const fields = line.split("\t");
    const statusChar = fields[0]!;

    let status: FileDiff["status"];
    let filePath: string;
    let oldPath: string | undefined;
    if (statusChar.startsWith("R") || statusChar.startsWith("C")) {
      status = "renamed";
      oldPath = fields[1]!;
      filePath = fields[2]!;
    } else if (statusChar === "A") {
      status = "added";
      filePath = fields[1]!;
    } else if (statusChar === "D") {
      status = "deleted";
      filePath = fields[1]!;
    } else {
      status = "modified";
      filePath = fields[1]!;
    }

    const binary = isBinaryDiff(run, oldPath ?? filePath);
    const before = status !== "added" && !binary ? git(["show", `${run.baseCommit}:${oldPath ?? filePath}`], { cwd: run.worktreePath, allowFailure: true }) : undefined;
    const after = status !== "deleted" && !binary ? readWorktreeTextFile(run.worktreePath, filePath) : undefined;

    return { path: filePath, oldPath, status, before, after, binary };
  });
}

/**
 * "-\t-\t<path>" from `git diff --numstat` is git's own binary signal — the
 * same one its unified diff calls "Binary files differ" on, rather than a
 * heuristic re-guess here. Scoped to exactly one pathspec (never a bulk
 * query across every changed file): for a *rename*, `git diff --numstat -M`
 * doesn't print the two paths separately — it combines them into one
 * string, either `"old => new"` or, when they share a directory,
 * `"dir/{old => new}"`. Neither form matches `filePath`/`oldPath`
 * individually, so a bulk query's result can never be reliably matched
 * back to a renamed file; scoping the query to a single explicit pathspec
 * sidesteps the combining entirely (verified empirically — git only
 * combines rename paths when a diff covers more than the one path it's
 * asked about).
 */
function isBinaryDiff(run: RunWorktree, scopedPath: string): boolean {
  const out = git(["diff", "--numstat", "-M", run.baseCommit, "--", scopedPath], { cwd: run.worktreePath, allowFailure: true });
  return out.trim().startsWith("-\t-\t");
}

function readWorktreeTextFile(worktreePath: string, filePath: string): string | undefined {
  try {
    return fs.readFileSync(path.join(worktreePath, filePath), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * A checkpoint commit at each successful verify (§13.2), so rollback is
 * per-step. `--no-verify` bypasses the user's hooks for internal
 * checkpoints (§13.4: hooks run only on the final approved commit).
 * Returns null if there was nothing to checkpoint.
 */
export function checkpoint(run: RunWorktree, message: string): string | null {
  git(["add", "-A"], { cwd: run.worktreePath });
  // Deliberately no `allowFailure` here (unlike most read-only status
  // checks elsewhere in this file): `git status --porcelain` genuinely
  // exits 0 for a clean tree — an `allowFailure`-swallowed non-zero exit
  // here means a *real* git error (index lock, disk error, corruption),
  // not "nothing changed," and treating the two identically silently skips
  // a checkpoint that should have been created, right after `add -A` staged
  // real content.
  const status = git(["status", "--porcelain"], { cwd: run.worktreePath });
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

/**
 * Restore the run's auto-stash, if it has one, without letting a stash-pop
 * failure (most commonly a real merge conflict between the just-restored
 * stash and content the run itself produced) read as "the whole operation
 * failed." By the time this runs, `discardRun`/`approveRun`'s own
 * destructive work — removing the worktree, merging the branch — has
 * already genuinely completed; a `restoreStash` exception at this point
 * used to propagate straight out of both functions with no indication that
 * everything before it had actually succeeded. A failed `git stash pop`
 * itself never drops the stash (git's own documented behavior — "The stash
 * entry is kept in case you need it again"), so nothing is lost here either
 * way; this just makes that fact visible to the caller instead of masking
 * it as an unqualified exception.
 */
function restoreStashIfAny(run: RunWorktree): string | undefined {
  if (run.dirtyTreeResult.strategyUsed !== "stash" || !run.dirtyTreeResult.stashRef) return undefined;
  try {
    restoreStash(run.repoPath, run.dirtyTreeResult.stashRef);
    return undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `restoring the auto-stash failed after the operation itself completed: ${msg} — the stash was not lost, recover it manually with \`git stash list\` / \`git stash pop\` in ${run.repoPath} (possibly leaving conflict markers to resolve there)`;
  }
}

/** `agent reject`: discard the worktree and its branch entirely (§13.1). */
export function discardRun(run: RunWorktree): { stashRestoreWarning?: string } {
  git(["worktree", "remove", "--force", run.worktreePath], { cwd: run.repoPath, allowFailure: true });
  git(["branch", "-D", run.branch], { cwd: run.repoPath, allowFailure: true });
  return { stashRestoreWarning: restoreStashIfAny(run) };
}

export interface ApproveOptions {
  squash?: boolean;
  message?: string;
  /** Branch in `repoPath` to merge into; defaults to whatever is currently checked out. */
  targetBranch?: string;
}

/** `agent approve`: merge the run branch into the user's branch (§13.1/§13.5). Never runs without an explicit call. */
export function approveRun(run: RunWorktree, opts: ApproveOptions = {}): { mergedSha: string; stashRestoreWarning?: string } {
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
  const stashRestoreWarning = restoreStashIfAny(run);
  // Branch is retained until the run is deleted (§13.1), only the worktree checkout is removed.

  return { mergedSha, stashRestoreWarning };
}
