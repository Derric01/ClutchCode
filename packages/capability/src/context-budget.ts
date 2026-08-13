import type { CapabilityProfile } from "./types.js";

/**
 * Context budgeting (PROJECT_SPEC.md §4.5): "the agent never gets the whole
 * repo dumped into context. Ever." Budget model as fractions of *effective*
 * context (§4.1's `effectiveContext`, measured in characters throughout
 * this codebase — the same proxy `packages/tools`' truncation already uses):
 *
 * | Segment | Share (8k profile) |
 * | System prompt + tool schemas | ~15% |
 * | Repo map / retrieval | ~20% |
 * | Open file windows | ~30% |
 * | Conversation/tool history | ~25% |
 * | Reserved for model output | ~10% |
 *
 * The retrieval budget scales down automatically as effective context
 * shrinks, because every share is a fraction of the same shrinking total.
 */

export interface ContextBudget {
  totalChars: number;
  systemChars: number;
  retrievalChars: number;
  openWindowsChars: number;
  historyChars: number;
  outputChars: number;
}

const SHARE = {
  system: 0.15,
  retrieval: 0.2,
  openWindows: 0.3,
  history: 0.25,
  output: 0.1
} as const;

export function computeContextBudget(profile: CapabilityProfile): ContextBudget {
  const total = profile.effectiveContext;
  return {
    totalChars: total,
    systemChars: Math.round(total * SHARE.system),
    retrievalChars: Math.round(total * SHARE.retrieval),
    openWindowsChars: Math.round(total * SHARE.openWindows),
    historyChars: Math.round(total * SHARE.history),
    outputChars: Math.round(total * SHARE.output)
  };
}

/** A rough chars-per-token proxy (§4.5 reserved-output share → `maxOutputTokens` hint), not a tokenizer. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function budgetToMaxOutputTokens(budget: ContextBudget): number {
  return Math.max(256, Math.round(budget.outputChars / CHARS_PER_TOKEN_ESTIMATE));
}
