import path from "node:path";
import {
  git,
  checkpoint as gitCheckpoint,
  diffAgainstBase as gitDiffAgainstBase,
  diffFilesAgainstBase as gitDiffFilesAgainstBase,
  diffStat as gitDiffStat,
  listCheckpoints as gitListCheckpoints,
  rollbackTo as gitRollbackTo,
  approveRun as gitApproveRun,
  discardRun as gitDiscardRun,
  SnapshotBackup,
  type RunWorktree,
  type CheckpointRecord,
  type ApproveOptions,
  type FileDiff
} from "@clutchcode/git";

/**
 * The backend-agnostic execution-lifecycle boundary `AgentLoop` (and every
 * run-lifecycle caller in `@clutchcode/agent-api`) depends on instead of
 * `@clutchcode/git`'s worktree functions directly (PROJECT_SPEC.md §13.1,
 * §13.4; ADR-004, whose own migration note says "the non-git snapshot path
 * already generalizes" — this is that generalization).
 *
 * Two implementations exist, one per §13.4 "case":
 *
 * - `GitWorktreeRunBackend` — the existing, unchanged git-worktree path
 *   (§13.1): edits happen in an isolated worktree/branch off HEAD; nothing
 *   touches the user's real tree until `approve()` merges it in.
 * - `SnapshotRunBackend` — the "not a git repo at all" fallback (§13.4):
 *   there is no worktree to isolate into, so `workspaceRoot` *is* the
 *   user's real directory and every tool writes to it directly, in place.
 *   `SnapshotBackup` (`@clutchcode/git`) is the safety net — a pre-edit
 *   backup per touched file, taken via `beforeEdit()` *before* the first
 *   write to each path (not after, unlike the git backend's post-verify
 *   `checkpoint()` — there is no isolated copy to check a post-hoc diff
 *   against here, only the one real copy already being mutated).
 *
 * ## Why this shape, not a thinner one
 *
 * `AgentLoop` doesn't just read `run.worktreePath`/`run.baseCommit` as
 * plain data — it drives four *behaviors* (checkpoint, diff-for-cheat-
 * detection, diff-stat-for-loop-detection, approve) that mean genuinely
 * different things per backend (see each method's own doc comment below),
 * so a plain discriminated-union *data* type wouldn't be enough on its
 * own — the branching logic has to live *somewhere*, and living once here
 * (rather than re-derived at every call site in `agent-loop.ts`/`agent.ts`)
 * is the whole point of the interface.
 *
 * ## Persistence
 *
 * A `RunBackend` is a live object with methods, not serializable as-is —
 * `agent-api`'s `worktree-store.ts` persists `.toState()`'s plain data
 * instead and reconstructs a live backend from it via `reviveRunBackend()`
 * on the next CLI invocation/process (`agent diff`/`approve`/`reject` are
 * routinely separate process invocations from the `agent run` that created
 * the run).
 */
export interface RunBackend {
  readonly kind: "git-worktree" | "snapshot";
  readonly runId: string;
  /**
   * Where tools actually read/write this run's files (§11.1's "ctx =
   * sandboxed workspace handle", `ToolContext.workspaceRoot`). The isolated
   * worktree copy for `git-worktree`; the user's real directory, in place,
   * for `snapshot` — see the class doc comment above for why that's the
   * correct, spec-mandated (§13.4) trade-off, not an oversight.
   */
  readonly workspaceRoot: string;

  /**
   * Called once per path, immediately before its first `write_file`/
   * `edit_file` mutation this run (`AgentLoop.runToolCall`) — *not* at
   * checkpoint/verify time. A no-op for `git-worktree` (isolation already
   * comes from the worktree copy, so there's nothing to back up before an
   * edit lands). For `snapshot`, this **is** the safety net §13.4 means by
   * "the destructive-gate + backups carry more weight": it must run before
   * the mutation, or the pre-edit content is gone the moment
   * `fs.writeFileSync` returns.
   */
  beforeEdit(relPath: string): void;

  /**
   * A checkpoint at each successful verify (§13.2), so rollback is
   * per-step. For `git-worktree`, a real commit — returns its sha, or
   * `null` if nothing changed since the last one. For `snapshot`, there is
   * only ever one meaningful rollback point (§13.4 promises "restores
   * snapshots," not per-step granularity the way git's checkpoint commits
   * give — `SnapshotBackup`'s pre-edit backups are all taken at (or before)
   * first-edit time, not regenerated per verify pass) — this returns a
   * fixed id once *any* file has been snapshotted this run, so
   * `listCheckpoints()`/`rollbackTo()` still work through the same CLI/ACP/
   * RPC surface as the git backend, just with one entry instead of many.
   * This is a stated, deliberate scope limit versus git's real per-step
   * granularity — not a silently-lesser experience.
   */
  checkpoint(message: string): string | null;

  /** `agent diff`: unified-diff text, worktree/workspace vs base (§13.2/§13.4). */
  diffAgainstBase(pathScope?: string): string;

  /** Per-file before/after content (§18.5's native two-sided diff view). */
  diffFilesAgainstBase(pathScope?: string): FileDiff[];

  /** Feeds the §6.4 loop detector's progress tracking — "how much changed since last turn," not shown to a human. */
  diffStat(): string;

  listCheckpoints(): CheckpointRecord[];

  /** Resets to an earlier checkpoint, including untracked/newly-created files (§13.3). */
  rollbackTo(sha: string): void;

  /**
   * `agent approve` (§13.1/§13.5, §14.7's DONE-SUCCESS): for `git-worktree`,
   * merges the run branch into the user's branch — the edits become real
   * only now. For `snapshot`, the edits were **already** live on the user's
   * real files the moment each tool call landed (there was never an
   * isolated copy to merge from) — this is a near no-op that just confirms
   * "keep what's there," consistent with §13.4's `[C:Med]` acceptance of a
   * weaker isolation guarantee for the non-git case (ADR-004).
   */
  approve(opts?: ApproveOptions): { mergedSha?: string; stashRestoreWarning?: string };

  /**
   * `agent reject`: for `git-worktree`, discards the isolated worktree +
   * branch — the user's real tree was never touched, so there is nothing
   * to restore. For `snapshot`, this is **not** the mirror-image no-op it
   * might look like: the edits *are* on the user's real files (no
   * isolation existed), so discarding here must actively restore them via
   * `SnapshotBackup.rollback()` — the one case in this whole interface
   * where the two backends' implementations of "the same operation" do
   * meaningfully different amounts of real work, not just different
   * plumbing under an identical no-op.
   */
  discard(): { stashRestoreWarning?: string };

  /**
   * `relPath`'s content as it existed at the moment this run began —
   * `undefined` if it didn't exist yet. `agent-api`'s AGENTS.md trust-
   * boundary read (§10.3 point 4, "human edits win") is the motivating
   * caller: an override must come from a human-authored file, not one the
   * model itself edited mid-run (a real gap fixed in round 3 of security
   * review — see `agent.ts`'s own comment on it), so this must stay
   * correct across a `resume()`'s second `buildRunDeps` call too, not just
   * the first. For `git-worktree`, `git show baseCommit:relPath` — already
   * unaffected by resume, since `baseCommit` is fixed at run creation. For
   * `snapshot`, there is no commit to read from: this backs `relPath` up
   * right now if it isn't already (idempotent, harmless even for a path
   * that's never otherwise edited — small extra backup file, nothing
   * more) and returns *that* backup's content, which is correct whether
   * this is the first call (before any tool call this run touches
   * anything) or a later `resume()`'s call (the backup was already taken
   * on the first).
   */
  readAtRunStart(relPath: string): string | undefined;

  /** Plain, JSON-serializable data for persistence — see the interface doc comment's "Persistence" section. */
  toState(): RunBackendState;
}

export type RunBackendState = ({ kind: "git-worktree" } & RunWorktree) | { kind: "snapshot"; runId: string; workspaceRoot: string; backupDir: string };

const SNAPSHOT_CHECKPOINT_ID = "snapshot:baseline";

class GitWorktreeRunBackend implements RunBackend {
  readonly kind = "git-worktree" as const;
  constructor(private readonly run: RunWorktree) {}

  get runId(): string {
    return this.run.runId;
  }
  get workspaceRoot(): string {
    return this.run.worktreePath;
  }

  beforeEdit(): void {
    /* no-op — the worktree copy is the isolation; nothing to back up pre-edit */
  }
  checkpoint(message: string): string | null {
    return gitCheckpoint(this.run, message);
  }
  diffAgainstBase(pathScope?: string): string {
    return gitDiffAgainstBase(this.run, pathScope);
  }
  diffFilesAgainstBase(pathScope?: string): FileDiff[] {
    return gitDiffFilesAgainstBase(this.run, pathScope);
  }
  diffStat(): string {
    return gitDiffStat(this.run);
  }
  listCheckpoints(): CheckpointRecord[] {
    return gitListCheckpoints(this.run);
  }
  rollbackTo(sha: string): void {
    gitRollbackTo(this.run, sha);
  }
  approve(opts?: ApproveOptions): { mergedSha?: string; stashRestoreWarning?: string } {
    return gitApproveRun(this.run, opts);
  }
  discard(): { stashRestoreWarning?: string } {
    return gitDiscardRun(this.run);
  }
  readAtRunStart(relPath: string): string | undefined {
    return git(["show", `${this.run.baseCommit}:${relPath}`], { cwd: this.run.worktreePath, allowFailure: true }) || undefined;
  }
  toState(): RunBackendState {
    return { kind: "git-worktree", ...this.run };
  }
}

class SnapshotRunBackend implements RunBackend {
  readonly kind = "snapshot" as const;
  private readonly backup: SnapshotBackup;

  constructor(
    readonly runId: string,
    readonly workspaceRoot: string,
    private readonly backupDir: string
  ) {
    this.backup = new SnapshotBackup(workspaceRoot, { backupDir });
  }

  beforeEdit(relPath: string): void {
    this.backup.snapshotBeforeFirstEdit(relPath);
  }
  checkpoint(_message: string): string | null {
    // See the interface doc comment: one fixed id once anything's been
    // snapshotted, `null` (matching git's "nothing to checkpoint") until
    // then — the message itself has nowhere durable to live without a
    // commit-like primitive, so it's intentionally not stored.
    return this.backup.touchedPaths().length > 0 ? SNAPSHOT_CHECKPOINT_ID : null;
  }
  diffAgainstBase(pathScope?: string): string {
    return this.backup.diffText(pathScope);
  }
  diffFilesAgainstBase(pathScope?: string): FileDiff[] {
    return this.backup.diffFiles(pathScope);
  }
  diffStat(): string {
    // No `git diff --stat` equivalent without a repo; a plain count is all
    // the §6.4 loop detector actually consumes (it hashes/compares this
    // string turn-to-turn to notice "nothing is changing anymore", not a
    // human-facing display) — real files-touched count is a faithful,
    // if coarser, substitute.
    const n = this.backup.touchedPaths().length;
    return n === 0 ? "" : `${n} file(s) changed`;
  }
  listCheckpoints(): CheckpointRecord[] {
    return this.backup.touchedPaths().length > 0 ? [{ sha: SNAPSHOT_CHECKPOINT_ID, message: "run start (snapshot baseline, §13.4)" }] : [];
  }
  rollbackTo(_sha: string): void {
    // Only one meaningful target exists for this backend (see the
    // interface doc comment) — the sha argument is resolved against
    // `listCheckpoints()` by the caller (`Agent.rollback`) before this is
    // ever reached, so by the time we're here it's already been confirmed
    // to be `SNAPSHOT_CHECKPOINT_ID` or a match wouldn't have been found.
    this.backup.rollback();
  }
  approve(): { mergedSha?: string; stashRestoreWarning?: string } {
    return {}; // see the interface doc comment — edits are already live, nothing to merge
  }
  discard(): { stashRestoreWarning?: string } {
    this.backup.rollback(); // see the interface doc comment — this is real, necessary work here, unlike the git backend's no-op-ish discard
    return {};
  }
  readAtRunStart(relPath: string): string | undefined {
    this.backup.snapshotBeforeFirstEdit(relPath); // idempotent — a no-op if already backed up
    const entry = this.backup.diff().find((d) => d.path === relPath);
    return entry?.before ?? undefined;
  }
  toState(): RunBackendState {
    return { kind: "snapshot", runId: this.runId, workspaceRoot: this.workspaceRoot, backupDir: this.backupDir };
  }
}

export function createGitWorktreeBackend(run: RunWorktree): RunBackend {
  return new GitWorktreeRunBackend(run);
}

/** `runStateDir`: this run's own state directory, e.g. `<stateDir>/runs/<runId>` — snapshots live under `<that>/snapshots`, alongside evidence/events. */
export function createSnapshotBackend(runId: string, workspaceRoot: string, runStateDir: string): RunBackend {
  return new SnapshotRunBackend(runId, workspaceRoot, path.join(runStateDir, "snapshots"));
}

/** Reconstructs a live `RunBackend` from `toState()`'s persisted data — see the interface doc comment's "Persistence" section. */
export function reviveRunBackend(state: RunBackendState): RunBackend {
  // `state` (narrowed to `{ kind: "git-worktree" } & RunWorktree`) is
  // passed as-is, not destructured to drop `kind` — TS's structural typing
  // only excess-property-checks an object *literal*, not an existing typed
  // variable, so the extra `kind` field is harmless here.
  if (state.kind === "git-worktree") {
    return new GitWorktreeRunBackend(state);
  }
  return new SnapshotRunBackend(state.runId, state.workspaceRoot, state.backupDir);
}
