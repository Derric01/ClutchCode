import { describe, expect, it } from "vitest";
import { BudgetGuard } from "./budget.js";
import type { Budgets, BudgetConsumed } from "./run-state.js";

function budgets(overrides: Partial<Budgets> = {}): Budgets {
  return { steps: 3, wallclockMs: 60_000, tokens: 1000, costUsd: 1, ...overrides };
}
function consumed(overrides: Partial<BudgetConsumed> = {}): BudgetConsumed {
  return { steps: 0, wallclockMs: 0, tokens: 0, costUsd: 0, ...overrides };
}

describe("BudgetGuard", () => {
  it("is ok while under every limit", () => {
    const guard = new BudgetGuard(budgets(), consumed());
    expect(guard.check().ok).toBe(true);
  });

  it("flags the step budget once the cap is reached", () => {
    const guard = new BudgetGuard(budgets({ steps: 2 }), consumed());
    guard.recordStep();
    expect(guard.check().ok).toBe(true);
    guard.recordStep();
    const result = guard.check();
    expect(result.ok).toBe(false);
    expect(result.exceeded).toContain("steps");
    expect(result.hardStop).toBe(false);
  });

  it("flags the token budget from recorded usage", () => {
    const guard = new BudgetGuard(budgets({ tokens: 100 }), consumed());
    guard.recordUsage(60, 50);
    expect(guard.check().exceeded).toContain("tokens");
  });

  it("hard-stops on the cost ceiling", () => {
    const guard = new BudgetGuard(budgets({ costUsd: 0.5 }), consumed());
    guard.recordUsage(0, 0, 0.6);
    const result = guard.check();
    expect(result.exceeded).toContain("cost");
    expect(result.hardStop).toBe(true);
  });

  it("treats costUsd = 0 as unmetered (no cost ceiling, e.g. local models)", () => {
    const guard = new BudgetGuard(budgets({ costUsd: 0 }), consumed());
    guard.recordUsage(0, 0, 100); // absurd amount, still shouldn't trip a zero ceiling
    expect(guard.check().exceeded).not.toContain("cost");
  });

  it("resumes correctly from already-consumed wallclock (a resumed run)", () => {
    const guard = new BudgetGuard(budgets({ wallclockMs: 1000 }), consumed({ wallclockMs: 999_999 }));
    expect(guard.check().exceeded).toContain("wallclock");
  });
});
