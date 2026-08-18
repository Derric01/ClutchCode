import type { RunState, RuntimeEvent } from "@clutchcode/agent-api";
import type { AgentRpcClient } from "@clutchcode/agent-rpc";
import { formatRuntimeEventLine, formatStatusSummary } from "./presentation.js";

/**
 * Everything the orchestration needs from VS Code, expressed as an
 * interface instead of importing `vscode` directly — `extension.ts`
 * implements this with real `vscode.window` calls; tests implement it
 * with plain recording functions. This is what makes `runClutchCodeTask`
 * itself testable end-to-end (including over a *real* `AgentRpcClient`
 * driving a *real* `Agent`) without an extension host.
 */
export interface TaskUI {
  showOutputLine(line: string): void;
  showDiff(runId: string, diffText: string): void;
  askApproveOrReject(): Promise<"approve" | "reject" | "later">;
  showInfo(message: string): void;
  showError(message: string): void;
}

export interface RunTaskOptions {
  task: string;
  providerKind: string;
  model: string;
  baseUrl?: string;
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
  const unsubscribe = client.onNotification((method, params) => {
    if (method !== "clutchcode/event") return;
    const { event } = params as { runId: string; event: RuntimeEvent };
    ui.showOutputLine(formatRuntimeEventLine(event));
  });

  try {
    const state = await client.request<RunState>("run", opts);

    if (state.status === "AWAITING_APPROVAL") {
      const { diff } = await client.request<{ diff: string }>("diff", { runId: state.runId });
      ui.showDiff(state.runId, diff);

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
  } catch (e) {
    ui.showError(`ClutchCode: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    unsubscribe();
  }
}
