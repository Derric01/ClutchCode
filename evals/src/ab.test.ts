import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeAbReport,
  formatAbReport,
  mulberry32,
  pairedBootstrapDeltaInterval,
  runAbComparison,
  wilsonInterval,
  type ArmObservation,
  type PerTaskOutcome
} from "./ab.js";
import { defaultSuiteDir, loadEvalTask } from "./eval-task.js";
import { startScriptedModelServer, type ScriptedModelServer, type ScriptedModelTurn } from "./scripted-model-server.js";

/**
 * The §16.4 A/B — the comparison that substantiates (or refutes) §16.1's
 * central claim.
 *
 * The statistics are tested against **published reference values** where
 * they exist (Wilson) and against **cases with a known exact answer**
 * where they do not (a bootstrap over data where every resample must give
 * the same delta). A confidence interval that is merely "plausible-
 * looking" is worse than none: it is the part of a published claim readers
 * cannot check for themselves, so it is the part that has to be checkable
 * here.
 */

const BUGFIX = loadEvalTask(path.join(defaultSuiteDir(), "node-bugfix-duration"));

let servers: ScriptedModelServer[] = [];

afterEach(async () => {
  for (const server of servers) await server.close();
  servers = [];
});

describe("wilsonInterval", () => {
  it("matches published reference values, including the boundaries Wald gets wrong", () => {
    // 0/10 at 95%: Wilson gives [0, 0.2775]; the Wald interval collapses
    // to [0, 0] — infinite confidence from ten observations — which is
    // precisely the regime a small eval suite lives in.
    const none = wilsonInterval(0, 10);
    expect(none.lo).toBeCloseTo(0, 10);
    expect(none.hi).toBeCloseTo(0.27753, 4);

    const half = wilsonInterval(5, 10);
    expect(half.lo).toBeCloseTo(0.23659, 4);
    expect(half.hi).toBeCloseTo(0.76341, 4);

    const all = wilsonInterval(10, 10);
    expect(all.lo).toBeCloseTo(0.72247, 4);
    expect(all.hi).toBeCloseTo(1, 10);
  });

  it("narrows as observations accumulate", () => {
    const few = wilsonInterval(5, 10);
    const many = wilsonInterval(50, 100);
    expect(many.hi - many.lo).toBeLessThan(few.hi - few.lo);
  });

  it("refuses input it cannot mean anything for", () => {
    expect(() => wilsonInterval(0, 0)).toThrow(/at least one observation/);
    expect(() => wilsonInterval(3, 2)).toThrow(/impossible/);
    expect(() => wilsonInterval(1.5, 10)).toThrow(/integer/);
  });
});

describe("mulberry32", () => {
  it("is deterministic for a seed, and different across seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const draw = (rng: () => number): number[] => Array.from({ length: 8 }, () => rng());
    const first = draw(a);
    expect(draw(b)).toEqual(first);
    expect(draw(c)).not.toEqual(first);
  });

  it("stays inside [0, 1) over a large sample and covers the range", () => {
    const rng = mulberry32(7);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });
});

describe("pairedBootstrapDeltaInterval", () => {
  const task = (taskId: string, clutchcodeSolved: number, nakedSolved: number, repetitions = 1): PerTaskOutcome => ({
    taskId,
    clutchcodeSolved,
    nakedSolved,
    repetitions
  });

  it("gives a degenerate [1, 1] when every task is solved by one arm and none by the other", () => {
    // Known exact answer: every resample, whatever tasks it draws, has
    // delta 1. An interval that came back anything else would be a bug in
    // the resampling, not noise.
    const ci = pairedBootstrapDeltaInterval([task("a", 1, 0), task("b", 1, 0), task("c", 1, 0)]);
    expect(ci).toEqual({ lo: 1, hi: 1 });
  });

  it("gives [0, 0] when the two arms are identical, so a null result reads as null", () => {
    const ci = pairedBootstrapDeltaInterval([task("a", 1, 1), task("b", 0, 0), task("c", 1, 1)]);
    expect(ci).toEqual({ lo: 0, hi: 0 });
  });

  it("brackets the point estimate and is genuinely non-degenerate on mixed data", () => {
    const perTask = [task("a", 2, 0, 2), task("b", 2, 2, 2), task("c", 1, 0, 2), task("d", 0, 0, 2)];
    const point = (2 + 2 + 1 + 0 - (0 + 2 + 0 + 0)) / 8;
    const ci = pairedBootstrapDeltaInterval(perTask);
    expect(ci.lo).toBeLessThan(ci.hi);
    expect(ci.lo).toBeLessThanOrEqual(point);
    expect(ci.hi).toBeGreaterThanOrEqual(point);
  });

  it("is reproducible from its seed — a published interval anyone can recompute", () => {
    const perTask = [task("a", 1, 0), task("b", 0, 1), task("c", 1, 1), task("d", 0, 0)];
    const first = pairedBootstrapDeltaInterval(perTask, { seed: 99, resamples: 2000 });
    const again = pairedBootstrapDeltaInterval(perTask, { seed: 99, resamples: 2000 });
    expect(again).toEqual(first);

    const otherSeed = pairedBootstrapDeltaInterval(perTask, { seed: 100, resamples: 2000 });
    expect(otherSeed.lo).toBeLessThanOrEqual(0);
    expect(otherSeed.hi).toBeGreaterThanOrEqual(0);
  });

  it("widens as alpha shrinks", () => {
    const perTask = [task("a", 1, 0), task("b", 1, 0), task("c", 0, 0), task("d", 0, 1)];
    const ninetyFive = pairedBootstrapDeltaInterval(perTask, { alpha: 0.05 });
    const ninetyNine = pairedBootstrapDeltaInterval(perTask, { alpha: 0.01 });
    expect(ninetyNine.hi - ninetyNine.lo).toBeGreaterThanOrEqual(ninetyFive.hi - ninetyFive.lo);
  });

  it("refuses to bootstrap nothing", () => {
    expect(() => pairedBootstrapDeltaInterval([])).toThrow(/zero tasks/);
    expect(() => pairedBootstrapDeltaInterval([task("a", 1, 0)], { alpha: 1 })).toThrow(/alpha/);
  });
});

describe("computeAbReport", () => {
  const obs = (taskId: string, repetition: number, solved: boolean): ArmObservation => ({ taskId, repetition, solved });
  const meta = { suite: "test", provider: "openai-compatible", model: "m" };

  it("computes both arms' VTCR, the delta, and per-task counts that re-derive it", () => {
    const clutch = [obs("a", 1, true), obs("a", 2, true), obs("b", 1, true), obs("b", 2, false)];
    const naked = [obs("a", 1, false), obs("a", 2, true), obs("b", 1, false), obs("b", 2, false)];

    const report = computeAbReport(meta, clutch, naked);
    expect(report.taskCount).toBe(2);
    expect(report.repetitions).toBe(2);
    expect(report.clutchcode.solved).toBe(3);
    expect(report.naked.solved).toBe(1);
    expect(report.clutchcode.vtcr).toBe(0.75);
    expect(report.naked.vtcr).toBe(0.25);
    expect(report.vtcrDelta).toBe(0.5);
    expect(report.perTask).toEqual([
      { taskId: "a", clutchcodeSolved: 2, nakedSolved: 1, repetitions: 2 },
      { taskId: "b", clutchcodeSolved: 1, nakedSolved: 0, repetitions: 2 }
    ]);
    expect(report.clutchcode.ci95.lo).toBeLessThan(report.clutchcode.vtcr);
    expect(report.clutchcode.ci95.hi).toBeGreaterThan(report.clutchcode.vtcr);
  });

  it("refuses an unpaired comparison rather than averaging mismatched data", () => {
    expect(() => computeAbReport(meta, [obs("a", 1, true), obs("b", 1, true)], [obs("a", 1, false)])).toThrow(/unpaired/);
    // Same count, different cells — the failure mode a length check alone misses.
    expect(() => computeAbReport(meta, [obs("a", 1, true), obs("b", 1, true)], [obs("a", 1, false), obs("c", 1, false)])).toThrow(
      /no observation for task "b"/
    );
    expect(() => computeAbReport(meta, [], [])).toThrow(/zero observations/);
  });

  it("refuses an unbalanced comparison where tasks were run different numbers of times", () => {
    const clutch = [obs("a", 1, true), obs("a", 2, true), obs("b", 1, true)];
    const naked = [obs("a", 1, false), obs("a", 2, false), obs("b", 1, false)];
    expect(() => computeAbReport(meta, clutch, naked)).toThrow(/unbalanced/);
  });

  it("always states that the delta is a conservative floor, and says so when the interval includes 0", () => {
    const tied = computeAbReport(meta, [obs("a", 1, true), obs("b", 1, false)], [obs("a", 1, true), obs("b", 1, false)]);
    expect(tied.vtcrDelta).toBe(0);
    expect(tied.notes.join(" ")).toMatch(/conservative floor/);
    expect(tied.notes.join(" ")).toMatch(/includes 0/);
    expect(tied.notes.join(" ")).toMatch(/1 repetition/);
    expect(tied.notes.join(" ")).toMatch(/cluster bootstrap over 2 task/);

    const clear = computeAbReport(meta, [obs("a", 1, true), obs("b", 1, true)], [obs("a", 1, false), obs("b", 1, false)]);
    expect(clear.notes.join(" ")).not.toMatch(/includes 0/);
  });

  it("records the bootstrap parameters so the interval can be recomputed from the report alone", () => {
    const report = computeAbReport(
      { ...meta, bootstrap: { resamples: 1234, seed: 4321 } },
      [obs("a", 1, true)],
      [obs("a", 1, false)]
    );
    expect(report.bootstrapResamples).toBe(1234);
    expect(report.bootstrapSeed).toBe(4321);
    expect(pairedBootstrapDeltaInterval(report.perTask, { resamples: 1234, seed: 4321 })).toEqual(report.deltaCi95);
  });
});

describe("formatAbReport", () => {
  it("prints both arms, the delta with its interval, and every caveat", () => {
    const report = computeAbReport(
      { suite: "s", provider: "ollama", model: "qwen2.5-coder:14b" },
      [{ taskId: "a", repetition: 1, solved: true }],
      [{ taskId: "a", repetition: 1, solved: false }]
    );
    const text = formatAbReport(report);
    expect(text).toContain("ollama/qwen2.5-coder:14b");
    expect(text).toContain("VTCR, ClutchCode arm:  100.0%");
    expect(text).toContain("VTCR, naked arm:       0.0%");
    expect(text).toContain("VTCR delta:            +100.0%");
    expect(text).toContain("cluster bootstrap over tasks");
    for (const note of report.notes) expect(text).toContain(note);
  });
});

describe("runAbComparison (§16.4) — both arms, one endpoint, everything below the model real", () => {
  const FIX_HOURS: ScriptedModelTurn = {
    kind: "tool_call",
    id: "call_fix",
    name: "edit_file",
    args: {
      path: "src/duration.js",
      edits: [
        {
          search: "    if (unit === 'h') {\n      total += value * 60 * 1000;\n",
          replace: "    if (unit === 'h') {\n      total += value * 60 * 60 * 1000;\n"
        }
      ]
    }
  };

  it(
    "measures a real delta: the harness fixes the bug, the naked single-shot only talks about it",
    async () => {
      const harnessTurns: ScriptedModelTurn[] = [FIX_HOURS, { kind: "text", text: "Fixed the hours multiplier." }];
      let harnessCalls = 0;
      let nakedCalls = 0;

      // One endpoint, two arms, told apart by what they actually send: the
      // ClutchCode arm declares tools, the naked arm declares none. That is
      // not a testing trick — it is the difference between the arms.
      const server = await startScriptedModelServer([], {
        route: ({ body }) => {
          if (body.includes('"tools"')) {
            const turn = harnessTurns[harnessCalls] ?? { kind: "text" as const, text: "done" };
            harnessCalls += 1;
            return turn;
          }
          nakedCalls += 1;
          return { kind: "text", text: "You should multiply hours by 60 * 60 * 1000 in src/duration.js." };
        }
      });
      servers.push(server);

      const { report, clutchcodeBoard, nakedResults } = await runAbComparison([BUGFIX], {
        providerKind: "openai-compatible",
        model: "scripted-ab",
        baseUrl: server.baseUrl,
        suiteLabel: "test"
      });

      expect(report.clutchcode.vtcr).toBe(1);
      expect(report.naked.vtcr).toBe(0);
      expect(report.vtcrDelta).toBe(1);
      // One task, one repetition: every bootstrap resample draws the same
      // task, so the interval is exactly [1, 1] — and the report says out
      // loud that a zero-width interval here means agreement, not
      // precision.
      expect(report.deltaCi95).toEqual({ lo: 1, hi: 1 });
      expect(report.notes.join(" ")).toMatch(/coarse/);

      // The naked arm really was single-shot, and the harness arm really
      // did take more than one turn — the two facts the delta rests on.
      expect(nakedCalls).toBe(1);
      expect(harnessCalls).toBeGreaterThan(1);
      expect(nakedResults[0]!.modelCalls).toBe(1);
      expect(nakedResults[0]!.blocksEmitted).toBe(0);

      // The ClutchCode arm's §16.2 supporting metrics survive the A/B.
      expect(clutchcodeBoard.vtcr).toBe(1);
      expect(clutchcodeBoard.metrics.editFormatAccuracy).toBe(1);
    },
    240_000
  );

  it(
    "reports no delta when the naked single-shot solves it too — the result that would refute §16.1",
    async () => {
      const solvedFile = [
        "src/duration.js",
        "```js",
        "'use strict';",
        "",
        "function parseDuration(text) {",
        "  const pattern = /(\\d+)(h|m|s)/g;",
        "  let total = 0;",
        "  let match;",
        "  while ((match = pattern.exec(String(text))) !== null) {",
        "    const value = Number(match[1]);",
        "    const unit = match[2];",
        "    if (unit === 'h') {",
        "      total += value * 60 * 60 * 1000;",
        "    } else if (unit === 'm') {",
        "      total += value * 60 * 1000;",
        "    } else {",
        "      total += value * 1000;",
        "    }",
        "  }",
        "  return total;",
        "}",
        "",
        "module.exports = { parseDuration };",
        "```"
      ].join("\n");

      const harnessTurns: ScriptedModelTurn[] = [FIX_HOURS, { kind: "text", text: "Fixed." }];
      let harnessCalls = 0;
      const server = await startScriptedModelServer([], {
        route: ({ body }) => {
          if (body.includes('"tools"')) {
            const turn = harnessTurns[harnessCalls] ?? { kind: "text" as const, text: "done" };
            harnessCalls += 1;
            return turn;
          }
          return { kind: "text", text: solvedFile };
        }
      });
      servers.push(server);

      const { report, nakedResults } = await runAbComparison([BUGFIX], {
        providerKind: "openai-compatible",
        model: "scripted-ab-tie",
        baseUrl: server.baseUrl,
        suiteLabel: "test"
      });

      expect(nakedResults[0]!.filesWritten).toBe(1);
      expect(report.naked.vtcr).toBe(1);
      expect(report.clutchcode.vtcr).toBe(1);
      expect(report.vtcrDelta).toBe(0);
      expect(report.deltaCi95).toEqual({ lo: 0, hi: 0 });
      expect(report.notes.join(" ")).toMatch(/includes 0/);
    },
    240_000
  );

  it("refuses an empty suite and a non-positive repetition count", async () => {
    await expect(runAbComparison([], { providerKind: "fake", model: "" })).rejects.toThrow(/empty eval suite/);
    await expect(runAbComparison([BUGFIX], { providerKind: "fake", model: "", repetitions: 0 })).rejects.toThrow(/positive integer/);
  });
});

describe("computeAbReport — tasks the host cannot run (§16.4)", () => {
  const meta = { suite: "s", provider: "fake", model: "m" };
  const solvable = (solved: boolean): ArmObservation => ({ taskId: "solvable", repetition: 1, solved });
  const refused = (taskId: string): ArmObservation => ({ taskId, repetition: 1, solved: false, refused: true });

  it("excludes a refused task from the denominator instead of scoring it as a mutual failure", () => {
    const baseline = computeAbReport(meta, [solvable(true)], [solvable(false)]);
    expect(baseline.vtcrDelta).toBe(1);
    expect(baseline.deltaCi95).toEqual({ lo: 1, hi: 1 });

    // Same comparison, plus one task this host genuinely cannot run. Both arms
    // refuse it symmetrically, so every pairing check passes and nothing
    // throws — which is exactly why counting it would be a *silent* distortion.
    const withRefused = computeAbReport(
      meta,
      [solvable(true), refused("needs-pytest")],
      [solvable(false), refused("needs-pytest")]
    );

    // The headline must be unmoved by a missing binary.
    expect(withRefused.vtcrDelta).toBe(1);
    expect(withRefused.deltaCi95).toEqual({ lo: 1, hi: 1 });
    expect(withRefused.clutchcode.observations).toBe(1);
    expect(withRefused.naked.observations).toBe(1);

    // ...and the exclusion must be visible, not swallowed.
    expect(withRefused.refusedObservations).toBe(1);
    expect(withRefused.refusedTaskIds).toEqual(["needs-pytest"]);
    expect(withRefused.perTask.map((t) => t.taskId)).toEqual(["solvable"]);
    expect(withRefused.notes.some((n) => n.includes("needs-pytest") && n.includes("excluded"))).toBe(true);
  });

  it("throws when one arm refused a task the other ran — the arms disagree about what was attempted", () => {
    expect(() =>
      computeAbReport(meta, [solvable(true), refused("x")], [solvable(false), { taskId: "x", repetition: 1, solved: true }])
    ).toThrow(/asymmetric A\/B refusal/);
  });

  it("refuses to report at all when every observation was refused, rather than inventing a delta", () => {
    expect(() => computeAbReport(meta, [refused("a")], [refused("a")])).toThrow(/all 1 observation\(s\) were refused/);
  });

  it("is unchanged for a suite with no refusals (the refused flag is optional)", () => {
    const r = computeAbReport(meta, [solvable(true)], [solvable(false)]);
    expect(r.refusedObservations).toBe(0);
    expect(r.refusedTaskIds).toEqual([]);
    expect(r.notes.some((n) => n.includes("excluded"))).toBe(false);
  });
});
