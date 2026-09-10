import fs from "node:fs";
import path from "node:path";
import { assertSafeRunId } from "@clutchcode/git";
import type { RunBackendState } from "@clutchcode/runtime";

/**
 * Persists a `RunBackend`'s plain data (`RunBackendState` — either the
 * git-worktree handle or the snapshot backend's workspace/backup paths,
 * §13.1/§13.4) alongside `RunState` so `agent diff`/`approve`/`reject`/
 * `resume` can be invoked as separate CLI calls, potentially in a
 * different process, and still find the run's execution backend.
 */

function backendStatePath(stateDir: string, runId: string): string {
  // §13.1: same shared-choke-point fix as `RunStateStore` — see its
  // `runDir` comment. `loadRunBackend` in particular is the entry point
  // `approve`/`reject`/`rollback`/`pr` use to resolve a caller-supplied
  // `runId` into a real backend that real, sometimes destructive
  // operations then run against.
  assertSafeRunId(runId);
  return path.join(stateDir, "runs", runId, "worktree.json");
}

export function saveRunBackend(stateDir: string, state: RunBackendState): void {
  const p = backendStatePath(stateDir, state.runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
}

export function loadRunBackendState(stateDir: string, runId: string): RunBackendState | null {
  const p = backendStatePath(stateDir, runId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunBackendState;
}
