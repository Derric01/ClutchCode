import crypto from "node:crypto";
import type { RuntimeEvent } from "@clutchcode/agent-api";
import type { SessionUpdate, ToolKind } from "@agentclientprotocol/sdk";

/**
 * RuntimeEvent → ACP `session/update` mapping (PROJECT_SPEC.md §18.1/§20).
 *
 * `AgentLoop` emits one `RuntimeEvent` per tick (§6.1); an ACP client wants
 * `session/update` notifications instead. This is a pure translation layer
 * — no I/O, no protocol framing — so it is unit-testable without a real
 * stdio connection or a real `Agent.run()`.
 *
 * A single `RuntimeEvent` can produce zero, one, or (rarely) more than one
 * `SessionUpdate`: most map 1:1, but nothing here ever needs to fan one
 * event into more than one update today (`tool.call`/`tool.result` are
 * *separate* events already, correlated by `toolCallId` — see
 * `createSessionUpdateMapper`'s queue below — not one event needing two
 * updates). The array return keeps the mapping honest if a future event
 * ever does need to.
 */

function textUpdate(kind: "agent_message_chunk" | "agent_thought_chunk", text: string): SessionUpdate {
  return { sessionUpdate: kind, content: { type: "text", text } };
}

/**
 * ClutchCode's native tool names (`packages/tools/src/tools/*.ts`) mapped
 * onto ACP's fixed `ToolKind` enum, which exists so a client can pick a
 * sensible icon — not for any behavioral difference. `git` is genuinely
 * ambiguous (a read, a write, or an execute depending on the subcommand)
 * so it maps to `"other"` rather than guessing.
 */
const TOOL_KIND: Record<string, ToolKind> = {
  read_file: "read",
  write_file: "edit",
  edit_file: "edit",
  shell: "execute",
  process: "execute",
  search: "search",
  git: "other"
};

function toolKindFor(tool: string): ToolKind {
  return TOOL_KIND[tool] ?? "other";
}

/**
 * Builds a stateful RuntimeEvent → SessionUpdate[] mapper for exactly one
 * `Agent.run()`/`Agent.resume()` call. Fresh state per prompt turn is
 * deliberate: ACP `toolCallId`s only need to be unique *within* the
 * updates this turn emits, and RuntimeEvent's `tool.call`/`tool.result`
 * pair carries no id of its own to correlate on — the loop only ever runs
 * one tool at a time (no concurrent tool calls), so a simple FIFO queue of
 * pending calls is enough to pair each `tool.result` with the `tool.call`
 * that preceded it.
 */
export function createSessionUpdateMapper(): (event: RuntimeEvent) => SessionUpdate[] {
  const pendingToolCalls: string[] = [];

  return (event: RuntimeEvent): SessionUpdate[] => {
    switch (event.type) {
      case "state.transition":
        return [textUpdate("agent_thought_chunk", `${event.from} → ${event.to}`)];

      case "model.request":
        return []; // implicit — the next model.response/tool.call is the visible signal

      case "model.response":
        return event.text.length > 0 ? [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.text }, messageId: crypto.randomUUID() }] : [];

      case "tool.call": {
        const toolCallId = crypto.randomUUID();
        pendingToolCalls.push(toolCallId);
        return [
          {
            sessionUpdate: "tool_call",
            toolCallId,
            title: event.tool,
            kind: toolKindFor(event.tool),
            status: "in_progress",
            rawInput: event.args
          }
        ];
      }

      case "tool.result": {
        const toolCallId = pendingToolCalls.shift() ?? crypto.randomUUID();
        return [
          {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: event.ok ? "completed" : "failed",
            ...(event.errorCode ? { content: [{ type: "content", content: { type: "text", text: `error: ${event.errorCode}` } }] } : {})
          }
        ];
      }

      case "verify.stage":
        return [
          {
            sessionUpdate: "tool_call",
            toolCallId: crypto.randomUUID(),
            title: `verify: ${event.stage}`,
            kind: "execute",
            status: event.passed ? "completed" : "failed"
          }
        ];

      case "cheat.flag":
        return [textUpdate("agent_message_chunk", `cheat flag: rule "${event.rule}" in ${event.file}`)];

      case "budget.hit":
        return [textUpdate("agent_message_chunk", `budget hit: ${event.kinds.join(", ")} — run paused, resumable`)];

      case "loop.detected":
        return [textUpdate("agent_thought_chunk", `loop detector: ${formatLoopWarning(event.warning)}`)];

      case "context.compacted":
        return [textUpdate("agent_thought_chunk", `context compacted: ${event.droppedCount} message(s) dropped`)];

      case "context.pruned":
        return [textUpdate("agent_thought_chunk", `tool results pruned: ${event.prunedCount} result(s), ~${event.reclaimedTokens} tokens reclaimed`)];

      case "escalation":
        return [textUpdate("agent_message_chunk", `escalated: ${event.reason}`)];

      case "run.end":
        return [textUpdate("agent_message_chunk", `run finished: ${event.status}`)];

      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };
}

function formatLoopWarning(warning: Extract<RuntimeEvent, { type: "loop.detected" }>["warning"]): string {
  switch (warning.kind) {
    case "repeated-call":
      return `repeated call (${warning.count}x)${warning.escalate ? ", escalating" : ""}`;
    case "oscillating-edit":
      return `oscillating edit on ${warning.file}${warning.escalate ? ", escalating" : ""}`;
    case "no-progress":
      return `no progress${warning.escalate ? ", escalating" : ""}`;
    case "almost-done-stall":
      return `almost-done stall${warning.escalate ? ", escalating" : ""}`;
    default: {
      const exhaustive: never = warning;
      return exhaustive;
    }
  }
}
