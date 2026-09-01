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

  it("flags a bare no-parenthesis `catch {}` the same as `catch (e) {}` (real gap caught in round 3 of security review — ES2019+'s optional catch binding makes this syntactically valid modern JS/TS, the exact same swallow-the-failing-path cheat)", () => {
    const diff = fileDiff("src/worker.ts", ["riskyCall();"], ["try { riskyCall(); } catch {}"]);
    expect(detectCheats(diff).some((f) => f.rule === "swallowed-error")).toBe(true);
  });

  it("flags a self-equality tautology beyond the literal true/1==1 cases (real gap caught in round 3 of security review — expect(1).toBe(1) is just as trivially-true as expect(true).toBe(true))", () => {
    const diff = fileDiff("src/math.test.ts", ["expect(add(1, 2)).toBe(3);"], ["expect(1).toBe(1);"]);
    expect(detectCheats(diff).some((f) => f.rule === "weakened-assertion")).toBe(true);
  });

  it("still flags a real self-equality removal even when it's disguised by extra whitespace inside the parens (real gap caught in round 3 of security review)", () => {
    const diff = fileDiff("src/math.test.ts", ["expect(add(1, 2)).toBe(3);"], ["expect( true ).toBe( true );"]);
    expect(detectCheats(diff).some((f) => f.rule === "weakened-assertion")).toBe(true);
  });

  it("flags a hardcoded-output collapse even when padded with harmless comment lines (real gap caught in round 3 of security review — counting comment lines toward the <=2 threshold let padding move the count past it)", () => {
    const diff = fileDiff(
      "src/calc.ts",
      ["let total = 0;", "for (const n of numbers) {", "  total += n * weight(n);", "}", "return total;"],
      ["// simplified per review", "// TODO revisit", "return 42;"]
    );
    expect(detectCheats(diff).some((f) => f.rule === "possible-hardcoded-output")).toBe(true);
  });

  it("still flags a snapshot edit when the accompanying change is to a genuinely unrelated file (real gap caught in round 3 of security review — the exemption used to fire for ANY other non-test/non-snapshot file in the diff, regardless of subject)", () => {
    const diff = [
      fileDiff("README.md", ["old docs"], ["new docs, unrelated to Component"]),
      fileDiff("__snapshots__/Component.test.ts.snap", ["exports[`renders`] = `<div>old</div>`;"], ["exports[`renders`] = `<div>new</div>`;"])
    ].join("\n");
    expect(detectCheats(diff).some((f) => f.rule === "unexplained-snapshot-edit")).toBe(true);
  });

  // Real gap found while building the §16 eval suite: the assertion regex
  // only recognized `assert(`, so the entire `node:assert` method family
  // and Python's bare `assert <expr>` statement — the default assertion
  // style in each language — were invisible to the removed-assertions
  // detector. Reproduced end to end first: a scripted run that deleted the
  // one failing `assert.strictEqual(...)` line from a test file turned the
  // gate green and drew zero cheat flags.
  it("flags a deleted node:assert assertion (assert.strictEqual/deepStrictEqual/ok), not just a bare assert(", () => {
    const diff = fileDiff(
      "test/duration.test.js",
      ["assert.strictEqual(parseDuration('2h'), 7200000, 'hours');"],
      ["// the hours case is flaky, dropping it"]
    );
    expect(detectCheats(diff).some((f) => f.rule === "removed-test-assertions")).toBe(true);

    const deepDiff = fileDiff("test/shape.test.js", ["assert.deepStrictEqual(actual, expected);"], []);
    expect(detectCheats(deepDiff).some((f) => f.rule === "removed-test-assertions")).toBe(true);

    const okDiff = fileDiff("test/shape.test.js", ["  assert.ok(result.isValid);"], []);
    expect(detectCheats(okDiff).some((f) => f.rule === "removed-test-assertions")).toBe(true);
  });

  it("flags a deleted bare Python `assert <expr>` statement (the default pytest style)", () => {
    const diff = fileDiff("tests/test_math.py", ["    assert add(2, 2) == 4", "    assert add(-1, 1) == 0"], ["    pass"]);
    expect(detectCheats(diff).some((f) => f.rule === "removed-test-assertions")).toBe(true);
  });

  it("does not miscount an `assert` import/binding line as an assertion", () => {
    // The statement form is anchored to the start of the line and must be
    // followed by an expression, so neither of these counts — otherwise
    // moving an import would look like deleting a test.
    const diff = fileDiff("test/math.test.js", ["const assert = require('node:assert');"], ["import assert from 'node:assert';"]);
    expect(detectCheats(diff).some((f) => f.rule === "removed-test-assertions")).toBe(false);
  });

  it("flags a node:assert assertion weakened into a tautology (assert.ok(true) / assert.strictEqual(1, 1))", () => {
    const okDiff = fileDiff("test/math.test.js", ["assert.strictEqual(add(1, 2), 3);"], ["assert.ok(true);"]);
    expect(detectCheats(okDiff).some((f) => f.rule === "weakened-assertion")).toBe(true);

    const selfEqDiff = fileDiff("test/math.test.js", ["assert.strictEqual(add(1, 2), 3);"], ["assert.strictEqual(1, 1);"]);
    expect(detectCheats(selfEqDiff).some((f) => f.rule === "weakened-assertion")).toBe(true);
  });

  it("does not flag an honest node:assert assertion as trivial", () => {
    const diff = fileDiff("test/math.test.js", ["assert.strictEqual(add(1, 2), 4);"], ["assert.strictEqual(add(1, 2), 3);"]);
    expect(detectCheats(diff).some((f) => f.rule === "weakened-assertion")).toBe(false);
  });
});
