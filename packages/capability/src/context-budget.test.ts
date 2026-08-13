import { describe, expect, it } from "vitest";
import { budgetToMaxOutputTokens, computeContextBudget } from "./context-budget.js";
import { unprobedProfile } from "./types.js";

describe("computeContextBudget (§4.5)", () => {
  it("splits effective context into the spec's five shares", () => {
    const profile = { ...unprobedProfile("fake", "m"), effectiveContext: 8_000 };
    const budget = computeContextBudget(profile);

    expect(budget.totalChars).toBe(8_000);
    expect(budget.systemChars).toBe(1_200); // 15%
    expect(budget.retrievalChars).toBe(1_600); // 20%
    expect(budget.openWindowsChars).toBe(2_400); // 30%
    expect(budget.historyChars).toBe(2_000); // 25%
    expect(budget.outputChars).toBe(800); // 10%
  });

  it("scales every share down proportionally for a smaller effective context", () => {
    const profile = { ...unprobedProfile("fake", "m"), effectiveContext: 4_000 };
    const budget = computeContextBudget(profile);
    expect(budget.historyChars).toBe(1_000);
    expect(budget.retrievalChars).toBe(800);
  });
});

describe("budgetToMaxOutputTokens", () => {
  it("converts the output share into a token estimate for a large-context model", () => {
    const profile = { ...unprobedProfile("fake", "m"), effectiveContext: 32_000 };
    // outputChars = 32000 * 0.1 = 3200; 3200 / 4 chars-per-token = 800
    expect(budgetToMaxOutputTokens(computeContextBudget(profile))).toBe(800);
  });

  it("never returns below the floor even for a tiny effective context", () => {
    const profile = { ...unprobedProfile("fake", "m"), effectiveContext: 100 };
    expect(budgetToMaxOutputTokens(computeContextBudget(profile))).toBe(256);
  });
});
