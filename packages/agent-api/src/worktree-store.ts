import fs from "node:fs";
import path from "node:path";
import { assertSafeRunId, type RunWorktree } from "@clutchcode/git";

/**
 * Persists the `RunWorktree` handle (branch, base commit, worktree path)
 * alongside `RunState` so `agent diff`/`approve`/`reject`/`resume` can be
 * invoked as separate CLI calls, potentially in a different process, and
 * still find the run's worktree.
 */

function worktreeMetaPath(stateDir: string, runId: string): string {
  // §13.1: same shared-choke-point fix as `RunStateStore` — see its
  // `runDir` comment. `loadRunWorktree` in particular is the entry point
  // `approve`/`reject`/`rollback`/`pr` use to resolve a caller-supplied
  // `runId` into a real `worktreePath`/`repoPath` that real, sometimes
  // destructive `git` operations then run against.
  assertSafeRunId(runId);
  return path.join(stateDir, "runs", runId, "worktree.json");
}

export function saveRunWorktree(stateDir: string, run: RunWorktree): void {
  const p = worktreeMetaPath(stateDir, run.runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(run, null, 2), "utf8");
}

export function loadRunWorktree(stateDir: string, runId: string): RunWorktree | null {
  const p = worktreeMetaPath(stateDir, runId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunWorktree;
}
