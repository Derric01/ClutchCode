import type { Budgets, BudgetConsumed } from "./run-state.js";

/**
 * BudgetGuard (PROJECT_SPEC.md §6.3):
 *
 * | Budget | Default | On limit |
 * | Step budget | 50 tool steps | Pause → summarize → ask to extend/stop |
 * | Wall-clock | 20 min | Same pause/escalate |
 * | Token budget | per-run cap | Compact context; if still over, escalate |
 * | Cost ceiling | e.g. $2.00 (API); $0 for local | Hard stop + require explicit approval |
 *
 * All four are enforced in one BudgetGuard checked at every step. Local
 * models set cost=0 but keep step/wall-clock/token limits.
 */

export type BudgetLimitKind = "steps" | "wallclock" | "tokens" | "cost";

export interface BudgetCheckResult {
  ok: boolean;
  exceeded: BudgetLimitKind[];
  /** Cost is a hard stop distinct from the others (§6.3: "protects Profile C from a runaway bill"). */
  hardStop: boolean;
}

export class BudgetGuard {
  private readonly startedAt: number;

  constructor(
    private readonly budgets: Budgets,
    private readonly consumed: BudgetConsumed,
    now: number = Date.now()
  ) {
    this.startedAt = now - consumed.wallclockMs; // so an already-partially-consumed resumed run still tracks correctly
  }

  recordStep(): void {
    this.consumed.steps += 1;
    this.consumed.wallclockMs = Date.now() - this.startedAt;
  }

  recordUsage(inputTokens: number, outputTokens: number, costUsd = 0): void {
    this.consumed.tokens += inputTokens + outputTokens;
    this.consumed.costUsd += costUsd;
  }

  check(): BudgetCheckResult {
    this.consumed.wallclockMs = Date.now() - this.startedAt;
    const exceeded: BudgetLimitKind[] = [];

    if (this.consumed.steps >= this.budgets.steps) exceeded.push("steps");
    if (this.consumed.wallclockMs >= this.budgets.wallclockMs) exceeded.push("wallclock");
    if (this.consumed.tokens >= this.budgets.tokens) exceeded.push("tokens");
    const costExceeded = this.budgets.costUsd > 0 && this.consumed.costUsd >= this.budgets.costUsd;
    if (costExceeded) exceeded.push("cost");

    return { ok: exceeded.length === 0, exceeded, hardStop: costExceeded };
  }

  snapshot(): BudgetConsumed {
    return { ...this.consumed };
  }
}
