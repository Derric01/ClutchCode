import type { NormalizedMessage } from "@clutchcode/providers";

/**
 * Summarization checkpoints (PROJECT_SPEC.md §4.5, §10): "compact tool
 * history into a running summary at token thresholds." A deterministic,
 * mechanical summary (not a model call) — cheap, testable, and it doesn't
 * spend the very budget it's trying to protect.
 *
 * The system message (index 0) and the most recent `keepRecent` messages
 * are always left untouched; everything older, once the conversation
 * exceeds `budgetChars`, collapses into one summary message.
 */

export interface CompactionResult {
  messages: NormalizedMessage[];
  compactedCount: number;
}

function summarizeMessage(m: NormalizedMessage): string {
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return `- called ${m.toolCalls.map((tc) => tc.name).join(", ")}`;
  }
  if (m.role === "tool") {
    try {
      const parsed = JSON.parse(m.content) as { ok?: boolean; error?: { code?: string } };
      return parsed.ok === false ? `  → failed (${parsed.error?.code ?? "error"})` : "  → ok";
    } catch {
      return "  → (tool result)";
    }
  }
  if (m.role === "user") {
    return `- note: ${m.content.slice(0, 100).replace(/\n/g, " ")}`;
  }
  return `- ${m.role}: ${m.content.slice(0, 100).replace(/\n/g, " ")}`;
}

export function compactHistory(messages: NormalizedMessage[], budgetChars: number, keepRecent = 6): CompactionResult {
  if (messages.length === 0) return { messages, compactedCount: 0 };

  const [system, ...rest] = messages;
  const totalChars = rest.reduce((sum, m) => sum + m.content.length, 0);

  if (totalChars <= budgetChars || rest.length <= keepRecent) {
    return { messages, compactedCount: 0 };
  }

  const toCompact = rest.slice(0, rest.length - keepRecent);
  const recent = rest.slice(rest.length - keepRecent);

  const summary: NormalizedMessage = {
    role: "user",
    content: [`[compacted ${toCompact.length} earlier message(s) to stay within the context budget (§4.5)]`, ...toCompact.map(summarizeMessage)].join(
      "\n"
    )
  };

  const out: NormalizedMessage[] = system ? [system, summary, ...recent] : [summary, ...recent];
  return { messages: out, compactedCount: toCompact.length };
}
