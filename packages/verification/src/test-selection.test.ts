import { describe, expect, it } from "vitest";
import { selectImpactedTests } from "./test-selection.js";

describe("selectImpactedTests", () => {
  const allTestFiles = ["src/math.test.ts", "src/string-utils.test.ts", "src/unrelated.test.ts"];

  it("maps a changed source file to its colocated test file", () => {
    const { selected, runFullSuite } = selectImpactedTests(["src/math.ts"], allTestFiles);
    expect(runFullSuite).toBe(false);
    expect(selected).toEqual(["src/math.test.ts"]);
  });

  it("includes a changed test file directly", () => {
    const { selected, runFullSuite } = selectImpactedTests(["src/math.test.ts"], allTestFiles);
    expect(runFullSuite).toBe(false);
    expect(selected).toEqual(["src/math.test.ts"]);
  });

  it("falls back to the full suite when a changed file can't be mapped to any test", () => {
    const { runFullSuite } = selectImpactedTests(["src/mystery-module.ts"], allTestFiles);
    expect(runFullSuite).toBe(true);
  });

  it("falls back to the full suite if even one of several changed files is unmapped", () => {
    const { runFullSuite } = selectImpactedTests(["src/math.ts", "src/mystery-module.ts"], allTestFiles);
    expect(runFullSuite).toBe(true);
  });

  it("returns no full-suite run for an empty changed-file list", () => {
    const { selected, runFullSuite } = selectImpactedTests([], allTestFiles);
    expect(selected).toEqual([]);
    expect(runFullSuite).toBe(false);
  });
});
