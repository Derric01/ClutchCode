import { describe, expect, it } from "vitest";
import { shouldPlan } from "./planning-heuristic.js";

describe("shouldPlan", () => {
  it("skips planning for a short, single-file task", () => {
    expect(shouldPlan({ taskDescription: "Fix the off-by-one error in parseLine", estimatedFileCount: 1 })).toBe(false);
  });

  it("plans for a multi-file task", () => {
    expect(shouldPlan({ taskDescription: "Update the API", estimatedFileCount: 5 })).toBe(true);
  });

  it("plans when the capability profile shows low instruction fidelity", () => {
    expect(shouldPlan({ taskDescription: "Fix a typo", lowInstructionFidelity: true })).toBe(true);
  });

  it("plans for a long or ambiguous task description", () => {
    expect(shouldPlan({ taskDescription: "Refactor the authentication module across several services" })).toBe(true);
    expect(shouldPlan({ taskDescription: "x".repeat(500) })).toBe(true);
  });
});
