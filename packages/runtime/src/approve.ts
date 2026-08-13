import { approveRun, discardRun, type ApproveOptions, type RunWorktree } from "@clutchcode/git";
import { transition, type RunState } from "./run-state.js";

/**
 * `agent approve` / `agent reject` (§13.1, §18.3): resumes a run parked at
 * AWAITING_APPROVAL after a human reviews the diff. Kept separate from
 * `AgentLoop` because approval is, by design, a human act on their own
 * schedule — not something the async loop blocks on.
 */
export function commitApprovedRun(state: RunState, run: RunWorktree, opts: ApproveOptions = {}): RunState {
  transition(state, "COMMITTING");
  approveRun(run, opts);
  transition(state, "DONE");
  return state;
}

export function rejectRun(state: RunState, run: RunWorktree): RunState {
  transition(state, "CANCELLED");
  discardRun(run);
  return state;
}
