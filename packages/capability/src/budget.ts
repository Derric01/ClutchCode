/**
 * Context budgeting for 8k-32k local models (PROJECT_SPEC.md §4.5).
 *
 * "Hard rule: the agent never gets the whole repo dumped into context.
 * Ever." This is a pure allocator: given an *effective* context size (from
 * a CapabilityProfile, §4.9, not the advertised size) it returns how many
 * tokens each segment of the prompt gets. Retrieval/history/etc. budgets
 * scale down automatically as effective context shrinks, because every
 * segment is a fraction of the same number.
 */

export interface ContextBudgetFractions {
  /** System prompt + tool schemas — sized down for low instruction-fidelity models (§4.1). */
  systemAndTools: number;
  /** Repo map / retrieval (§9) — ranked symbols/files, not file bodies. */
  repoMapRetrieval: number;
  /** Open file windows — only the windows being edited, not whole files. */
  openFileWindows: number;
  /** Conversation/tool history, compacted with checkpoints (§10). */
  conversationHistory: number;
  /** Reserved for model output (the edit + reasoning). */
  reservedOutput: number;
}

/** Defaults tuned for a Profile B 8-12k model (§4.5 table), as fractions of effective context. */
export const DEFAULT_BUDGET_FRACTIONS: ContextBudgetFractions = {
  systemAndTools: 0.15,
  repoMapRetrieval: 0.2,
  openFileWindows: 0.3,
  conversationHistory: 0.25,
  reservedOutput: 0.1
};

export type ContextBudget = { effectiveContext: number } & ContextBudgetFractions;

const FRACTION_TOLERANCE = 1e-6;

/**
 * Allocate an effective-context token budget across the five segments
 * (§4.5). Fractions must sum to 1.0 (the default set does); segment sizes
 * are floored and any rounding remainder is handed to `reservedOutput` so
 * the segments always sum to exactly `effectiveContext` — a content
 * segment never silently grows past its configured share.
 */
export function computeContextBudget(effectiveContext: number, fractions: ContextBudgetFractions = DEFAULT_BUDGET_FRACTIONS): ContextBudget {
  if (!Number.isFinite(effectiveContext) || effectiveContext <= 0) {
    throw new Error(`effectiveContext must be a positive number, got ${effectiveContext}`);
  }
  const fractionSum = Object.values(fractions).reduce((a, b) => a + b, 0);
  if (Math.abs(fractionSum - 1) > FRACTION_TOLERANCE) {
    throw new Error(`context budget fractions must sum to 1.0, got ${fractionSum.toFixed(6)}`);
  }

  const keys = Object.keys(fractions) as Array<keyof ContextBudgetFractions>;
  const floored = {} as ContextBudgetFractions;
  let flooredSum = 0;
  for (const k of keys) {
    const v = Math.floor(effectiveContext * fractions[k]);
    floored[k] = v;
    flooredSum += v;
  }
  // Hand the rounding remainder to reservedOutput, never to a content segment.
  floored.reservedOutput += effectiveContext - flooredSum;

  return { effectiveContext, ...floored };
}
