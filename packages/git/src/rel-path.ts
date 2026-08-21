import path from "node:path";

/**
 * §13.4 non-git snapshot fallback: `SnapshotBackup.snapshotBeforeFirstEdit`
 * joins a caller-supplied `relPath` into two different roots —
 * `workspaceRoot` (to read the file's current content) and `backupDir` (to
 * store the backup) — with a bare `path.join`. Nothing about that join
 * rejects a `..` segment, and (unlike `path.resolve`) `path.join` never
 * treats an absolute-*looking* second argument as an override either, so
 * the concrete escape vector here is specifically `..` traversal, not a
 * leading `/`.
 *
 * Reproduced for real against a throwaway workspace before this validator
 * existed: with `relPath = path.relative(workspaceRoot, someFileOutsideIt)`
 * (e.g. `"../canary.txt"`), `snapshotBeforeFirstEdit` wrote its backup file
 * *outside* `backupDir` entirely — an arbitrary-location write of whatever
 * content sits at `workspaceRoot + relPath` — and a later `rollback()` for
 * that same `relPath` wrote backup content into a file *outside*
 * `workspaceRoot`, genuinely overwriting an unrelated file elsewhere on
 * disk with the run's own backed-up content. Same class of bug as `runId`
 * path traversal (`run-id.ts`), adapted for a value that legitimately needs
 * to carry subdirectory structure (e.g. `"src/nested/file.ts"`), so a bare
 * single-segment allow-list (`SAFE_RUN_ID_RE`) isn't the right shape here —
 * this instead rejects the specific traversal primitive itself (any `..`
 * path segment, checked on both separators regardless of the current
 * platform, since `relPath` is untrusted text that may assume a different
 * separator convention than this process's own `path.sep`).
 *
 * Currently unreachable in the live agent — `agent.ts`'s `run()` throws
 * before ever constructing a `SnapshotBackup`; the non-git execution path
 * isn't wired up yet (see HANDOFF.md). But `SnapshotBackup` is an exported
 * public API with its own test coverage, and closing this now — before that
 * wiring lands — means the class of bug can never ship reachable in the
 * first place.
 */
export function isSafeRelPath(relPath: string): boolean {
  if (relPath.length === 0 || relPath.includes("\0")) return false;
  if (path.isAbsolute(relPath)) return false;
  // Windows-style absolute/drive-relative/UNC shapes rejected even when
  // running on POSIX, since `relPath` is untrusted text, not necessarily
  // produced by `path` on this OS.
  if (/^[A-Za-z]:[\\/]/.test(relPath) || relPath.startsWith("\\")) return false;

  return !relPath.split(/[/\\]/).some((seg) => seg === "..");
}

export function assertSafeRelPath(relPath: string): void {
  if (!isSafeRelPath(relPath)) {
    throw new Error(
      `invalid relative path "${relPath}" — must be workspace-relative with no ".." segments and no absolute/drive prefix`,
    );
  }
}

/**
 * Defense-in-depth companion to `assertSafeRelPath`, mirroring the
 * "structural allow-list plus a `path`-based containment re-check on the
 * resolved result" pattern already used for `runId` elsewhere in this
 * package (`createRunWorktree`). Takes the already-joined `resolved` path
 * (not `root`/`relPath` recomputed here) so a caller checks the exact path
 * it's about to actually use, not a path this function reconstructs itself.
 */
export function assertContainedIn(root: string, resolved: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolved);
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`resolved path "${resolved}" escapes root "${root}"`);
  }
}
