import type { ApproveOptions } from "@clutchcode/git";
import { transition, type RunState } from "./run-state.js";
import type { RunBackend } from "./run-backend.js";

/**
 * `agent approve` / `agent reject` (§13.1, §13.4, §18.3): resumes a run
 * parked at AWAITING_APPROVAL after a human reviews the diff. Kept separate
 * from `AgentLoop` because approval is, by design, a human act on their own
 * schedule — not something the async loop blocks on. Backend-agnostic since
 * `RunBackend.approve()`/`.discard()` (`./run-backend.js`) already carry the
 * git-worktree-vs-snapshot distinction — see that file's doc comment for
 * why the two backends' `discard()` in particular do meaningfully different
 * amounts of real work behind the same call here.
 */
export function commitApprovedRun(state: RunState, run: RunBackend, opts: ApproveOptions = {}): RunState {
  transition(state, "COMMITTING");
  run.approve(opts);
  transition(state, "DONE");
  return state;
}

export function rejectRun(state: RunState, run: RunBackend): RunState {
  transition(state, "CANCELLED");
  run.discard();
  return state;
}
