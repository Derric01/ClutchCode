import type { RunStatus, RuntimeEvent } from "@clutchcode/agent-api";

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
