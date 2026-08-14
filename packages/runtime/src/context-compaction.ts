import type { NormalizedMessage } from "@clutchcode/providers";

/**
 * Conversation-history compaction (PROJECT_SPEC.md §4.5, §10):
 *
 * "Hard rule: the agent never gets the whole repo dumped into context.
 * Ever." §4.5 also names "summarization checkpoints (compact tool history
 * into a running summary at thresholds, §10)" as a mandatory technique —
 * true LLM-driven summarization is a Phase-7 memory feature (§25) this pass
 * doesn't build. What this module does instead, honestly: once the running
 * history estimate crosses its token budget, it drops whole *turns* from
 * the oldest end (never splitting an assistant tool-call from its
 * tool-result — that would produce a request no provider accepts) and
 * replaces them with one short notice, rather than silently truncating
 * mid-turn or letting history grow unbounded.
 */

/** A simple, explicitly-labeled proxy (~4 chars/token), matching the "character budget as a token proxy" convention already used at tool-output truncation (`@clutchcode/tools` `truncate.ts`). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: NormalizedMessage): number {
  let tokens = estimateTokens(message.content);
  for (const call of message.toolCalls ?? []) {
    tokens += estimateTokens(call.argsJson) + estimateTokens(call.name);
  }
  return tokens;
}

interface Turn {
  messages: NormalizedMessage[];
  tokens: number;
}

/**
 * Groups a message list into turns: a `system`/`user`/`assistant` message
 * plus every `tool` message immediately following it (the exact shape
 * `agent-loop.ts` produces — one assistant turn, then its tool results).
 * Compaction only ever drops *whole* turns, so a kept tool-result message
 * is never left pointing at a dropped tool-call.
 */
function groupTurns(messages: NormalizedMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "tool" && turns.length > 0) {
      turns[turns.length - 1]!.messages.push(message);
    } else {
      turns.push({ messages: [message], tokens: 0 });
    }
  }
  for (const turn of turns) {
    turn.tokens = turn.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  }
  return turns;
}

export interface CompactionResult {
  messages: NormalizedMessage[];
  compacted: boolean;
  /** How many messages were dropped (0 when `compacted` is false). */
  droppedCount: number;
}

/**
 * Drops the oldest turns until the estimated remaining history fits
 * `budgetTokens`, always pinning `messages[0]` (system prompt) and, if
 * present, `messages[1]` (the original task) — the model should never lose
 * sight of what it's meant to be doing. Never drops the single most recent
 * turn, even if it alone exceeds budget, since that would remove the exact
 * tool result the model is waiting on.
 */
export function compactHistory(messages: NormalizedMessage[], budgetTokens: number): CompactionResult {
  if (messages.length === 0) return { messages, compacted: false, droppedCount: 0 };

  const pinnedCount = messages[0]!.role === "system" ? (messages[1]?.role === "user" ? 2 : 1) : 0;
  const pinned = messages.slice(0, pinnedCount);
  const pinnedTokens = pinned.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  const turns = groupTurns(messages.slice(pinnedCount));
  let remaining = pinnedTokens + turns.reduce((sum, t) => sum + t.tokens, 0);

  if (remaining <= budgetTokens) return { messages, compacted: false, droppedCount: 0 };

  let cut = 0;
  let droppedCount = 0;
  while (cut < turns.length - 1 && remaining > budgetTokens) {
    remaining -= turns[cut]!.tokens;
    droppedCount += turns[cut]!.messages.length;
    cut += 1;
  }

  if (cut === 0) return { messages, compacted: false, droppedCount: 0 };

  const notice: NormalizedMessage = {
    role: "user",
    content: `[context budget: ${droppedCount} earlier message(s) across ${cut} turn(s) omitted to fit the ~${budgetTokens}-token conversation-history budget (§4.5); the run's event log still has the full history.]`
  };
  const kept = turns.slice(cut).flatMap((t) => t.messages);

  return { messages: [...pinned, notice, ...kept], compacted: true, droppedCount };
}
