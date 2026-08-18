import type { FileDiff, PrResult, RunState, RuntimeEvent } from "@clutchcode/agent-api";
import type { AgentRpcClient } from "@clutchcode/agent-rpc";
import { formatPrResult, formatRuntimeEventLine, formatStatusSummary } from "./presentation.js";

/**
 * Everything the orchestration needs from VS Code, expressed as an
 * interface instead of importing `vscode` directly — `extension.ts`
 * implements this with real `vscode.window` calls; tests implement it
 * with plain recording functions. This is what makes every task function
 * in this file testable end-to-end (including over a *real*
 * `AgentRpcClient` driving a *real* `Agent`) without an extension host.
 */
export interface TaskUI {
  showOutputLine(line: string): void;
  /** One real `vscode.diff` editor per changed file (§18.5 polish) — `extension.ts` is what actually opens them; this just hands over the structured per-file content. */
  showDiff(runId: string, files: FileDiff[]): void;
  askApproveOrReject(): Promise<"approve" | "reject" | "later">;
  showInfo(message: string): void;
  showError(message: string): void;
  /** §18.5 polish: a run-picker instead of typing a run id by hand. `runs` is pre-filtered by the caller; returns undefined if the user cancels. */
  pickRun(runs: RunState[], placeholder: string): Promise<string | undefined>;
}

export interface RunTaskOptions {
  task: string;
  providerKind: string;
  model: string;
  baseUrl?: string;
}

function subscribeToEvents(client: AgentRpcClient, ui: TaskUI): () => void {
  return client.onNotification((method, params) => {
    if (method !== "clutchcode/event") return;
    const { event } = params as { runId: string; event: RuntimeEvent };
    ui.showOutputLine(formatRuntimeEventLine(event));
  });
}

/**
 * Shared by `runClutchCodeTask` and `resumeTask` — both end up with a
 * `RunState` from the RPC call that started/continued them and need to do
 * the exact same thing with it: show the diff and ask for a decision if
 * it's ready for review, otherwise just report the final status.
 */
async function handlePostRunState(client: AgentRpcClient, state: RunState, ui: TaskUI): Promise<void> {
  if (state.status === "AWAITING_APPROVAL") {
    const { files } = await client.request<{ files: FileDiff[] }>("diffFiles", { runId: state.runId });
    ui.showDiff(state.runId, files);

    const decision = await ui.askApproveOrReject();
    if (decision === "approve") {
      await client.request("approve", { runId: state.runId, squash: true });
      ui.showInfo(`ClutchCode: run ${state.runId} approved and committed.`);
    } else if (decision === "reject") {
      await client.request("reject", { runId: state.runId });
      ui.showInfo(`ClutchCode: run ${state.runId} rejected.`);
    } else {
      ui.showInfo(`ClutchCode: run ${state.runId} is awaiting your review — approve/reject it later from the run list.`);
    }
    return;
  }

  ui.showInfo(`ClutchCode: run ${state.runId} — ${formatStatusSummary(state.status, state.escalationReason)}`);
}

/**
 * The one orchestration `clutchcode.run` needs (§18.5's UX: "a task
 * input; live streaming in a panel; native diff view for review;
 * approve/reject buttons"): submit the task, stream events into the
 * output panel as they arrive, and once verification lands on
 * AWAITING_APPROVAL, show the diff and ask the user to approve or reject
 * — mirroring the CLI's own run→diff→approve/reject flow exactly, just
 * over RPC instead of in-process.
 */
export async function runClutchCodeTask(client: AgentRpcClient, opts: RunTaskOptions, ui: TaskUI): Promise<void> {
  const unsubscribe = subscribeToEvents(client, ui);
  try {
    const state = await client.request<RunState>("run", opts);
    await handlePostRunState(client, state, ui);
  } catch (e) {
    ui.showError(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    unsubscribe();
  }
}

export interface ResumeExtend {
  extendSteps?: number;
  extendWallclockMs?: number;
  extendTokens?: number;
  extendCostUsd?: number;
}

/**
 * `clutchcode.resume` (§18.5 polish) — same post-state handling as a fresh
 * run, just continuing a PAUSED one instead of starting it. `extend`
 * defaults to nothing raised, matching `Agent.resume`'s own documented
 * semantics (§6.3 "ask to extend/stop"): resuming without extending
 * whichever budget it paused on isn't an error, it just re-pauses
 * immediately on the same check — the same behavior `agent resume`'s CLI
 * command already has without `--extend-*` flags, not new here.
 */
export async function resumeTask(client: AgentRpcClient, runId: string, ui: TaskUI, extend: ResumeExtend = {}): Promise<void> {
  const unsubscribe = subscribeToEvents(client, ui);
  try {
    const state = await client.request<RunState>("resume", { runId, ...extend });
    await handlePostRunState(client, state, ui);
  } catch (e) {
    ui.showError(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    unsubscribe();
  }
}

/** `clutchcode.rollback` (§18.5 polish) — a single request/response, no event stream to subscribe to. */
export async function rollbackTask(client: AgentRpcClient, runId: string, sha: string, ui: TaskUI): Promise<void> {
  try {
    await client.request("rollback", { runId, sha });
    ui.showInfo(`ClutchCode: run ${runId} rolled back to ${sha}.`);
  } catch (e) {
    ui.showError(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** `clutchcode.pr` (§18.5 polish) — mirrors `agent pr`'s three-way outcome (gh / compare-url / manual, §13.5). */
export async function prTask(client: AgentRpcClient, runId: string, ui: TaskUI): Promise<void> {
  try {
    const result = await client.request<PrResult>("pr", { runId });
    ui.showInfo(`ClutchCode: ${formatPrResult(runId, result)}`);
  } catch (e) {
    ui.showError(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface PickRunOptions {
  placeholder: string;
  /** e.g. only PAUSED runs for `clutchcode.resume` — omit to offer every run. */
  filter?: (state: RunState) => boolean;
}

/**
 * §18.5 polish: "a run-picker instead of typing a run id." Fetches the real
 * run list over RPC, filters it (e.g. to only PAUSED runs for resume), and
 * hands the picking itself to `ui.pickRun` — `extension.ts` implements that
 * with a real `vscode.window.showQuickPick`, tests with a scripted choice.
 */
export async function pickRun(client: AgentRpcClient, ui: TaskUI, opts: PickRunOptions): Promise<string | undefined> {
  const runs = await client.request<RunState[]>("listRuns");
  const candidates = opts.filter ? runs.filter(opts.filter) : runs;
  if (candidates.length === 0) {
    ui.showInfo("ClutchCode: no matching runs found.");
    return undefined;
  }
  return ui.pickRun(candidates, opts.placeholder);
}
