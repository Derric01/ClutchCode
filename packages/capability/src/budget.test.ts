import { describe, expect, it } from "vitest";
import { computeContextBudget, DEFAULT_BUDGET_FRACTIONS, type ContextBudgetFractions } from "./budget.js";

describe("computeContextBudget", () => {
  it("allocates the §4.5 default shares and sums exactly to the input", () => {
    const budget = computeContextBudget(8000);
    expect(budget.effectiveContext).toBe(8000);
    expect(budget.systemAndTools).toBe(1200); // 15%
    expect(budget.repoMapRetrieval).toBe(1600); // 20%
    expect(budget.openFileWindows).toBe(2400); // 30%
    expect(budget.conversationHistory).toBe(2000); // 25%
    expect(budget.reservedOutput).toBe(800); // 10%
    const sum =
      budget.systemAndTools + budget.repoMapRetrieval + budget.openFileWindows + budget.conversationHistory + budget.reservedOutput;
    expect(sum).toBe(8000);
  });

  it("scales every segment down as effective context shrinks", () => {
    const small = computeContextBudget(4000);
    const large = computeContextBudget(32000);
    expect(small.openFileWindows).toBeLessThan(large.openFileWindows);
    expect(small.repoMapRetrieval).toBeLessThan(large.repoMapRetrieval);
  });

  it("hands any flooring remainder to reservedOutput so segments always sum exactly", () => {
    const budget = computeContextBudget(1001); // not evenly divisible by the default fractions
    const sum =
      budget.systemAndTools + budget.repoMapRetrieval + budget.openFileWindows + budget.conversationHistory + budget.reservedOutput;
    expect(sum).toBe(1001);
  });

  it("accepts custom fractions that sum to 1.0", () => {
    const fractions: ContextBudgetFractions = {
      systemAndTools: 0.1,
      repoMapRetrieval: 0.1,
      openFileWindows: 0.5,
      conversationHistory: 0.2,
      reservedOutput: 0.1
    };
    const budget = computeContextBudget(10000, fractions);
    expect(budget.openFileWindows).toBe(5000);
  });

  it("rejects fractions that don't sum to 1.0", () => {
    const bad: ContextBudgetFractions = { ...DEFAULT_BUDGET_FRACTIONS, reservedOutput: 0.5 };
    expect(() => computeContextBudget(8000, bad)).toThrow(/sum to 1\.0/);
  });

  it("rejects a non-positive effective context", () => {
    expect(() => computeContextBudget(0)).toThrow(/positive/);
    expect(() => computeContextBudget(-100)).toThrow(/positive/);
  });
});
