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

  it("does not treat a same-named test file in an unrelated directory as a confident mapping — falls back to the full suite instead (real gap caught in round 3 of security review: basename-only matching, with no directory relationship check, let an unrelated same-named test file elsewhere in the repo silently satisfy the mapping)", () => {
    // src/moduleA/helpers.ts changes; its real coverage would be
    // src/moduleA/moduleA.test.ts (a different basename, so unmapped by
    // this Phase-1 heuristic either way) — but src/moduleB/helpers.test.ts
    // must NOT count as "mapped" just because it shares a basename.
    const crossModuleTestFiles = ["src/moduleB/helpers.test.ts"];
    const { runFullSuite, selected } = selectImpactedTests(["src/moduleA/helpers.ts"], crossModuleTestFiles);
    expect(runFullSuite).toBe(true);
    expect(selected).toEqual([]);
  });

  it("still maps across a conventional src/ + test/ sibling split (not over-restricted by the directory-relatedness fix)", () => {
    const { selected, runFullSuite } = selectImpactedTests(["src/math.ts"], ["test/math.test.ts"]);
    expect(runFullSuite).toBe(false);
    expect(selected).toEqual(["test/math.test.ts"]);
  });

  it("still maps into a conventional __tests__ subdirectory beside the changed file", () => {
    const { selected, runFullSuite } = selectImpactedTests(["src/components/Button.ts"], ["src/components/__tests__/Button.test.ts"]);
    expect(runFullSuite).toBe(false);
    expect(selected).toEqual(["src/components/__tests__/Button.test.ts"]);
  });
});
