import type { FileDiff, PrResult, RunStatus, RuntimeEvent } from "@clutchcode/agent-api";

/**
 * Pure formatting — deliberately has no `vscode` import, so it's testable
 * without an extension host. `extension.ts` is the only file in this
 * package allowed to import `vscode`; everything that can be pure, is.
 */

export function formatRuntimeEventLine(event: RuntimeEvent): string {
  switch (event.type) {
    case "state.transition":
      return `→ ${event.from} → ${event.to}`;
    case "model.request":
      return "… model request";
    case "model.response":
      return `« model response (${event.toolCalls} tool call${event.toolCalls === 1 ? "" : "s"})`;
    case "tool.call":
      return `▶ ${event.tool} ${event.args}`;
    case "tool.result":
      return `${event.ok ? "✓" : "✗"} ${event.tool}${event.errorCode ? ` (${event.errorCode})` : ""}`;
    case "verify.stage":
      return `${event.passed ? "✓" : "✗"} verify: ${event.stage}`;
    case "cheat.flag":
      return `⚠ cheat detection: ${event.rule} (${event.file})`;
    case "budget.hit":
      return `⏸ budget hit: ${event.kinds.join(", ")}`;
    case "loop.detected":
      return `⚠ loop detected: ${event.warning.kind}`;
    case "context.compacted":
      return `… context compacted (${event.droppedCount} message(s) dropped)`;
    case "escalation":
      return `⚠ escalated: ${event.reason}`;
    case "run.end":
      return `■ run ended: ${event.status}`;
    default: {
      const exhaustive: never = event;
      return `? unknown event: ${JSON.stringify(exhaustive)}`;
    }
  }
}

/** A one-line summary for the final status message shown after a run ends. */
export function formatStatusSummary(status: RunStatus, escalationReason?: string): string {
  switch (status) {
    case "DONE":
      return "completed and committed";
    case "AWAITING_APPROVAL":
      return "verification green — awaiting your review";
    case "PAUSED":
      return `paused${escalationReason ? `: ${escalationReason}` : ""} — resumable`;
    case "ESCALATED":
      return `escalated${escalationReason ? `: ${escalationReason}` : ""} — needs your attention`;
    case "FAILED":
      return `failed verification${escalationReason ? `: ${escalationReason}` : ""}`;
    case "CANCELLED":
      return "cancelled";
    default:
      return `status: ${status}`;
  }
}

/**
 * The tab title for one file's native two-sided diff (§18.5 polish — a real
 * `vscode.diff` editor per changed file, replacing the single unified-text
 * document the extension used to show). A rename gets an "old → new" title
 * since `vscode.diff` itself only ever labels the two content URIs, not
 * that they're the same logical file under different names.
 */
export function formatDiffTabTitle(file: FileDiff): string {
  const label = file.status === "renamed" ? `${file.oldPath} → ${file.path}` : file.path;
  return `${label} (${file.status})`;
}

/** The info message shown after `agent pr` finishes — mirrors the CLI's own three-way `PrResult.method` handling (§13.5). */
export function formatPrResult(runId: string, result: PrResult): string {
  if (result.method === "gh") return `run ${runId} — PR opened: ${result.url}`;
  if (result.method === "compare-url") return `run ${runId} — branch "${result.branch}" pushed to ${result.remote}; open a PR: ${result.url}`;
  return `run ${runId} — branch "${result.branch}" pushed to ${result.remote} (no gh/GitHub compare URL available — open a PR manually)`;
}
