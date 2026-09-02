import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectToolchain, runPipeline } from "@clutchcode/verification";

import { EVAL_CATEGORIES, applyReferenceSolution, checkTaskRequirements, defaultSuiteDir, loadSuite, materializeTaskRepo, parseTaskJson, runOracle } from "./eval-task.js";
import { makeTempDir } from "./fixture-repo.js";

/**
 * Suite validity (PROJECT_SPEC.md §16.3a/§16.3b).
 *
 * An eval task that is already solved on arrival, or that no solution can
 * satisfy, measures nothing — and a whole benchmark can quietly rot that
 * way without a single test failing, because every *scored* run would
 * still produce a plausible-looking number. So every task in the shipped
 * suite is validated here against real repositories, real toolchain
 * detection and real command execution, with no model anywhere in the
 * loop:
 *
 *   1. the held-out oracle FAILS on the pristine repository (the task is
 *      genuinely unsolved), and
 *   2. the oracle PASSES once the reference ("golden") solution is applied
 *      (the task is genuinely solvable, and the oracle is not impossible),
 *      and
 *   3. the repository's own deterministic gate is green after the
 *      reference solution (a golden solution that leaves the gate red
 *      could never be reached through the §14.7 completion contract), and
 *   4. the declared `startingGate` matches what the gate actually does on
 *      the pristine repo.
 */

function runGate(repoPath: string): { allGreen: boolean; firstFailure?: string; detail: string } {
  const commands = detectToolchain(repoPath);
  const evidenceDir = makeTempDir("clutchcode-eval-validity-evidence-");
  try {
    const result = runPipeline(commands, { cwd: repoPath, evidenceDir });
    return {
      allGreen: result.allGreen,
      firstFailure: result.firstFailure?.stage,
      detail: result.firstFailure ? `${result.firstFailure.command}\n${result.firstFailure.stdout}\n${result.firstFailure.stderr}` : ""
    };
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
}

describe("eval suite validity (§16.3a)", () => {
  const tasks = loadSuite();

  it("ships a suite that spans the realistic-task categories and more than one language", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(5);
    const categories = new Set(tasks.map((t) => t.category));
    // §16.3a's third bullet names the mix explicitly: "bug fix, small
    // feature, refactor, test-add, dependency bump ... across languages".
    // A superset check, not an equality one: bullet 2 is a *different*
    // bullet, and a suite that grew a category should not fail for growing.
    for (const required of ["bug-fix", "feature", "refactor", "test-add", "dependency-bump"]) {
      expect(categories, `§16.3a bullet 3 requires a "${required}" task`).toContain(required);
    }
    // §16.3a bullet 2: "Terminal-Bench-style tasks (shell/tooling tasks)".
    expect(categories, "§16.3a bullet 2 requires shell/tooling tasks").toContain("shell-tooling");
    // Every category the union declares must actually be represented —
    // otherwise a category could be added to the type and never shipped.
    expect(categories).toEqual(new Set(EVAL_CATEGORIES));
    expect(new Set(tasks.map((t) => t.language)).size).toBeGreaterThanOrEqual(2);
    // At least one task must arrive with a GREEN gate, or the suite could
    // not distinguish a real solution from a no-op at all.
    expect(tasks.some((t) => t.startingGate === "green")).toBe(true);
  });

  for (const task of tasks) {
    // A task whose toolchain genuinely isn't installed here can prove
    // nothing — its gate would be red for reasons that have nothing to do
    // with the task. Skip it honestly rather than either failing (which is
    // what broke CI: the runner has no pytest) or quietly weakening the
    // task to whatever happens to be installed. CI installs these, and
    // asserts they are present in a separate step, so a skip there would
    // be caught rather than silently costing coverage.
    const requirements = checkTaskRequirements(task);
    const maybeIt = requirements.ok ? it : it.skip;

    maybeIt(
      `${task.id}: unsolved on arrival, solvable by its reference solution, and green afterwards${requirements.ok ? "" : ` (needs: ${requirements.missing.join(", ")})`}`,
      () => {
        const pristine = path.join(makeTempDir("clutchcode-eval-validity-"), "repo");
        const solved = path.join(makeTempDir("clutchcode-eval-validity-"), "repo");
        try {
          materializeTaskRepo(task, pristine);
          materializeTaskRepo(task, solved);

          // 4. the declared starting gate is what actually happens.
          const startingGate = runGate(pristine);
          expect(startingGate.allGreen, `${task.id} declares startingGate "${task.startingGate}" but the gate said ${startingGate.allGreen ? "green" : `red at ${startingGate.firstFailure}`}`).toBe(
            task.startingGate === "green"
          );

          // 1. the oracle must fail before anything is solved.
          const before = runOracle(task, pristine);
          expect(before.passed, `${task.id}'s oracle passed on the PRISTINE repo — the task is already solved and would score a free point`).toBe(false);

          // 2 + 3. the reference solution satisfies both the oracle and the repo's own gate.
          applyReferenceSolution(task, solved);
          const gate = runGate(solved);
          expect(gate.allGreen, `${task.id}: the repo's own gate is red after the reference solution (${gate.firstFailure}):\n${gate.detail}`).toBe(true);

          const after = runOracle(task, solved);
          expect(after.passed, `${task.id}: the oracle rejected the reference solution:\n${after.stdout}\n${after.stderr}`).toBe(true);
        } finally {
          fs.rmSync(path.dirname(pristine), { recursive: true, force: true });
          fs.rmSync(path.dirname(solved), { recursive: true, force: true });
        }
      },
      120_000
    );
  }
});

describe("eval task parsing", () => {
  const dir = path.join(defaultSuiteDir(), "node-bugfix-duration");
  const valid = JSON.parse(fs.readFileSync(path.join(dir, "task.json"), "utf8")) as Record<string, unknown>;

  it("accepts the shipped tasks", () => {
    expect(parseTaskJson(valid, dir).id).toBe("node-bugfix-duration");
  });

  it("rejects a category outside the §16.3a set", () => {
    expect(() => parseTaskJson({ ...valid, category: "vibes" }, dir)).toThrow(/category/);
  });

  it("rejects a solution path that escapes the task directory", () => {
    expect(() => parseTaskJson({ ...valid, solutionPaths: ["../../etc/passwd"] }, dir)).toThrow(/stay inside the task directory/);
    expect(() => parseTaskJson({ ...valid, solutionPaths: ["/etc/passwd"] }, dir)).toThrow(/must be relative/);
  });

  it("rejects an id that does not match its directory", () => {
    expect(() => parseTaskJson({ ...valid, id: "something-else" }, dir)).toThrow(/must match the task directory name/);
  });

  it("rejects an empty oracle command", () => {
    expect(() => parseTaskJson({ ...valid, oracle: { command: [] } }, dir)).toThrow(/oracle.command/);
  });

  it("rejects an undeclared starting gate", () => {
    expect(() => parseTaskJson({ ...valid, startingGate: "maybe" }, dir)).toThrow(/startingGate/);
  });
});
