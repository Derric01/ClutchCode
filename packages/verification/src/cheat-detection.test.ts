import { describe, expect, it } from "vitest";
import { detectCheats } from "./cheat-detection.js";

function fileDiff(path: string, removed: string[], added: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 0000000..1111111 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${removed.length} +1,${added.length} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`)
  ].join("\n");
}

describe("detectCheats", () => {
  it("flags a test file that loses assertions without gaining any", () => {
    const diff = fileDiff(
      "src/math.test.ts",
      ["it('adds two numbers', () => { expect(add(1, 2)).toBe(3); });", "it('handles negatives', () => { expect(add(-1, -2)).toBe(-3); });"],
      ["// tests removed, feature works trust me"]
    );
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "removed-test-assertions")).toBe(true);
  });

  it("flags a real assertion weakened to a trivial one", () => {
    const diff = fileDiff("src/math.test.ts", ["expect(add(1, 2)).toBe(3);"], ["expect(add(1, 2)).toBeDefined();"]);
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "weakened-assertion")).toBe(true);
  });

  it("flags a newly-added .skip/.only marker", () => {
    const diff = fileDiff("src/math.test.ts", ["it('adds', () => { expect(add(1, 2)).toBe(3); });"], ["it.skip('adds', () => { expect(add(1, 2)).toBe(3); });"]);
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "added-skip-marker")).toBe(true);
  });

  it("flags a bare except/empty catch added around a failing path", () => {
    const pyDiff = fileDiff("src/worker.py", ["result = risky_call()"], ["try:", "    result = risky_call()", "except:", "    pass"]);
    expect(detectCheats(pyDiff).some((f) => f.rule === "swallowed-error")).toBe(true);

    const jsDiff = fileDiff("src/worker.ts", ["riskyCall();"], ["try { riskyCall(); } catch (e) {}"]);
    expect(detectCheats(jsDiff).some((f) => f.rule === "swallowed-error")).toBe(true);
  });

  it("flags a function body collapsed into a bare literal return", () => {
    const diff = fileDiff(
      "src/calc.ts",
      ["let total = 0;", "for (const n of numbers) {", "  total += n * weight(n);", "}", "return total;"],
      ["return 42;"]
    );
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "possible-hardcoded-output")).toBe(true);
  });

  it("flags a snapshot edit with no accompanying source change", () => {
    const diff = fileDiff("__snapshots__/Component.test.ts.snap", ["exports[`renders`] = `<div>old</div>`;"], ["exports[`renders`] = `<div>new</div>`;"]);
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "unexplained-snapshot-edit")).toBe(true);
  });

  it("does not flag a snapshot edit accompanied by a real source change", () => {
    const diff = [
      fileDiff("src/Component.tsx", ["return <div>old</div>;"], ["return <div>new</div>;"]),
      fileDiff("__snapshots__/Component.test.ts.snap", ["exports[`renders`] = `<div>old</div>`;"], ["exports[`renders`] = `<div>new</div>`;"])
    ].join("\n");
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "unexplained-snapshot-edit")).toBe(false);
  });

  it("does not flag an ordinary, honest bugfix diff", () => {
    const diff = fileDiff("src/math.ts", ["return a - b; // BUG: should add"], ["return a + b;"]);
    const flags = detectCheats(diff);
    expect(flags).toEqual([]);
  });

  it("does not flag a test file gaining more assertions than it loses (a real fix)", () => {
    const diff = fileDiff(
      "src/math.test.ts",
      ["it('adds', () => { expect(add(1, 2)).toBe(3); });"],
      ["it('adds', () => { expect(add(1, 2)).toBe(3); });", "it('adds negatives', () => { expect(add(-1, -2)).toBe(-3); });"]
    );
    const flags = detectCheats(diff);
    expect(flags.some((f) => f.rule === "removed-test-assertions")).toBe(false);
  });
});
