import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunState, type RunState } from "@clutchcode/runtime";

import { defaultSuiteDir, loadEvalTask, type EvalTask, type OracleResult } from "./eval-task.js";
import { computeScoreboard, formatScoreboard, summarizeRun, type EvalTaskResult } from "./scoreboard.js";
import { readScoreboardHistory, saveScoreboard, scoreboardHistoryPath } from "./scoreboard-store.js";
import { makeTempDir } from "./fixture-repo.js";

/**
 * Metric definitions (PROJECT_SPEC.md §16.1, §16.2) exercised directly.
 * `summarizeRun`/`computeScoreboard` are pure, so every metric is asserted
 * against a hand-built run rather than inferred from a live run — a metric
 * that is only ever checked end-to-end is a metric nobody can tell is
 * wrong.
 */

const task: EvalTask = loadEvalTask(path.join(defaultSuiteDir(), "node-bugfix-duration"));

function stateWith(overrides: Partial<RunState>): RunState {
  return { ...createRunState({ runId: "r1", task: task.prompt, provider: "fake", model: "m" }), ...overrides };
}

function oracle(passed: boolean): OracleResult {
  return { passed, exitCode: passed ? 0 : 1, stdout: "", stderr: "", durationMs: 5 };
}

function toolCall(tool: string, args: string, ok: boolean): RunState["toolCallLog"][number] {
  return { step: 0, tool, args, ok, ts: 0 };
}

describe("summarizeRun (§16.1 VTCR, §16.2 supporting metrics)", () => {
  it("counts a green, cheat-free, oracle-passing run as verified", () => {
    const state = stateWith({
      status: "DONE",
      verificationResults: [{ step: 3, allGreen: true, cheatFlagCount: 0, ts: 0 }]
    });
    const result = summarizeRun({ task, state, oracle: oracle(true), wallclockMs: 1000 });
    expect(result.claimedDone).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("does NOT count a run the harness called done but the held-out oracle rejected", () => {
    // This is the whole reason the oracle is held out: a green gate is the
    // agent's own verdict on a suite the agent can see and edit.
    const state = stateWith({
      status: "DONE",
      verificationResults: [{ step: 3, allGreen: true, cheatFlagCount: 0, ts: 0 }]
    });
    const result = summarizeRun({ task, state, oracle: oracle(false), wallclockMs: 1000 });
    expect(result.claimedDone).toBe(true);
    expect(result.verified).toBe(false);
  });

  it("does NOT count a cheat-flagged run, even with a green gate and a passing oracle", () => {
    const state = stateWith({
      status: "ESCALATED",
      escalationReason: "cheat detection flagged 1 issue(s): removed-test-assertions",
      verificationResults: [{ step: 3, allGreen: true, cheatFlagCount: 1, ts: 0 }]
    });
    const result = summarizeRun({ task, state, oracle: oracle(true), wallclockMs: 1000 });
    expect(result.claimedDone).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.cheatFlags).toBe(1);
    expect(result.neededHuman).toBe(true);
  });

  it("counts edit attempts and applications separately (§16.2 #1)", () => {
    const state = stateWith({
      status: "DONE",
      verificationResults: [{ step: 4, allGreen: true, cheatFlagCount: 0, ts: 0 }],
      toolCallLog: [
        toolCall("read_file", '{"path":"src/duration.js"}', true),
        toolCall("edit_file", '{"path":"src/duration.js"}', false),
        toolCall("edit_file", '{"path":"src/duration.js"}', true),
        toolCall("write_file", '{"path":"src/other.js"}', true)
      ]
    });
    const result = summarizeRun({ task, state, oracle: oracle(true), wallclockMs: 1 });
    expect(result.editAttempts).toBe(3);
    expect(result.editsApplied).toBe(2);
  });

  it("detects whether the run ever went near a solution path (§16.2 #5)", () => {
    const touched = summarizeRun({
      task,
      state: stateWith({ toolCallLog: [toolCall("read_file", '{"path":"src/duration.js"}', true)] }),
      oracle: oracle(false),
      wallclockMs: 1
    });
    const untouched = summarizeRun({
      task,
      state: stateWith({ toolCallLog: [toolCall("read_file", '{"path":"README.md"}', true)] }),
      oracle: oracle(false),
      wallclockMs: 1
    });
    expect(touched.readAnySolutionPath).toBe(true);
    expect(untouched.readAnySolutionPath).toBe(false);
  });
});

function result(overrides: Partial<EvalTaskResult>): EvalTaskResult {
  return {
    taskId: "t",
    category: "bug-fix",
    language: "node",
    runId: "r",
    status: "DONE",
    gateGreen: true,
    cheatFlags: 0,
    claimedDone: true,
    oraclePassed: true,
    verified: true,
    editAttempts: 1,
    editsApplied: 1,
    neededHuman: false,
    readAnySolutionPath: true,
    tokens: 100,
    costUsd: 0,
    wallclockMs: 1000,
    steps: 3,
    repairIterations: 0,
    oracleExitCode: 0,
    ...overrides
  };
}

describe("computeScoreboard (§16.1, §16.2)", () => {
  const meta = { suite: "s", provider: "fake", model: "m", generatedAt: "2026-01-01T00:00:00.000Z" };

  it("computes VTCR as verified / total", () => {
    const board = computeScoreboard(meta, [
      result({ taskId: "a", verified: true }),
      result({ taskId: "b", verified: false, oraclePassed: false }),
      result({ taskId: "c", verified: false, oraclePassed: false, claimedDone: false, status: "FAILED", gateGreen: false }),
      result({ taskId: "d", verified: true })
    ]);
    expect(board.vtcr).toBe(0.5);
    expect(board.solvedCount).toBe(2);
  });

  it("separates what the harness claimed from what the oracle confirmed", () => {
    const board = computeScoreboard(meta, [
      result({ taskId: "a", verified: true }),
      // claimed done, oracle disagreed — the false completion §14.7 exists to prevent.
      result({ taskId: "b", verified: false, oraclePassed: false, claimedDone: true })
    ]);
    expect(board.claimedDoneRate).toBe(1);
    expect(board.vtcr).toBe(0.5);
    expect(board.falseCompletionRate).toBe(0.5);
  });

  it("reports edit-format accuracy across the whole board, and null when nothing was edited", () => {
    const board = computeScoreboard(meta, [result({ editAttempts: 4, editsApplied: 3 }), result({ editAttempts: 0, editsApplied: 0 })]);
    expect(board.metrics.editFormatAccuracy).toBe(0.75);

    const noEdits = computeScoreboard(meta, [result({ editAttempts: 0, editsApplied: 0 })]);
    expect(noEdits.metrics.editFormatAccuracy).toBeNull();
  });

  it("reports cheat flags per task and the flagged-task rate (§16.2 #2)", () => {
    const board = computeScoreboard(meta, [
      result({ taskId: "a", cheatFlags: 0 }),
      result({ taskId: "b", cheatFlags: 2, verified: false, claimedDone: false, status: "ESCALATED" }),
      result({ taskId: "c", cheatFlags: 0 }),
      result({ taskId: "d", cheatFlags: 0 })
    ]);
    expect(board.metrics.cheatFlagsPerTask).toBe(0.5);
    expect(board.metrics.cheatFlaggedTaskRate).toBe(0.25);
  });

  it("refuses to report a cost per solved task while no provider reports cost", () => {
    const board = computeScoreboard(meta, [result({ costUsd: 0 })]);
    expect(board.metrics.costPerSolvedTaskUsd).toBeNull();
    expect(board.notes.join(" ")).toMatch(/cost per solved task is null/);

    const priced = computeScoreboard(meta, [result({ costUsd: 0.5 }), result({ costUsd: 0.25, verified: false, oraclePassed: false })]);
    expect(priced.metrics.costPerSolvedTaskUsd).toBe(0.75);
  });

  it("reports wall-clock per solved task, and null when nothing was solved", () => {
    const board = computeScoreboard(meta, [result({ wallclockMs: 1000 }), result({ wallclockMs: 3000, verified: false, oraclePassed: false })]);
    expect(board.metrics.wallclockPerSolvedTaskMs).toBe(4000);

    const nothingSolved = computeScoreboard(meta, [result({ verified: false, oraclePassed: false })]);
    expect(nothingSolved.metrics.wallclockPerSolvedTaskMs).toBeNull();
  });

  it("reports the human-intervention rate (§16.2 #4)", () => {
    const board = computeScoreboard(meta, [result({ neededHuman: true }), result({ neededHuman: false }), result({ neededHuman: false }), result({ neededHuman: false })]);
    expect(board.metrics.humanInterventionRate).toBe(0.25);
  });

  it("counts retrieval insufficiency only for failures that never touched a solution path (§16.2 #5)", () => {
    const board = computeScoreboard(meta, [
      // failed, never looked at the file it had to change → retrieval-insufficient
      result({ taskId: "a", verified: false, oraclePassed: false, readAnySolutionPath: false }),
      // failed, but it did look → a reasoning failure, not a retrieval one
      result({ taskId: "b", verified: false, oraclePassed: false, readAnySolutionPath: true }),
      // solved without touching a declared path → not a failure at all
      result({ taskId: "c", verified: true, oraclePassed: true, readAnySolutionPath: false }),
      result({ taskId: "d" })
    ]);
    expect(board.metrics.retrievalInsufficiencyRate).toBe(0.25);
  });

  it("calls out run-level errors instead of blending them into ordinary task failures", () => {
    const board = computeScoreboard(meta, [result({ taskId: "boom", verified: false, oraclePassed: false, error: "ENOSPC" })]);
    expect(board.notes.join(" ")).toMatch(/run-level error/);
    expect(board.notes.join(" ")).toMatch(/boom/);
  });

  it("refuses to compute a board from nothing", () => {
    expect(() => computeScoreboard(meta, [])).toThrow(/zero task results/);
  });

  it("renders a human-readable board", () => {
    const text = formatScoreboard(computeScoreboard(meta, [result({ taskId: "a" }), result({ taskId: "b", verified: false, oraclePassed: false })]));
    expect(text).toContain("VTCR");
    expect(text).toContain("50.0%");
    expect(text).toContain("FALSE-OK"); // b claimed done but the oracle disagreed
  });
});

describe("scoreboard persistence (§16.3b)", () => {
  it("writes a full board and appends a headline row per run", () => {
    const dir = makeTempDir("clutchcode-eval-store-");
    try {
      const first = computeScoreboard({ suite: "s", provider: "fake", model: "m", generatedAt: "2026-01-01T00:00:00.000Z" }, [result({})]);
      const second = computeScoreboard({ suite: "s", provider: "fake", model: "m", generatedAt: "2026-01-02T00:00:00.000Z" }, [
        result({ verified: false, oraclePassed: false })
      ]);

      const savedFirst = saveScoreboard(dir, first);
      const savedSecond = saveScoreboard(dir, second);
      expect(savedFirst.jsonPath).not.toBe(savedSecond.jsonPath);
      expect(JSON.parse(fs.readFileSync(savedFirst.jsonPath, "utf8")).vtcr).toBe(1);

      const history = readScoreboardHistory(dir);
      expect(history.map((r) => r.vtcr)).toEqual([1, 0]);
      expect(history[1]!.file).toBe(path.basename(savedSecond.jsonPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty history when nothing has been written, and fails loudly on a corrupt line", () => {
    const dir = makeTempDir("clutchcode-eval-store-");
    try {
      expect(readScoreboardHistory(dir)).toEqual([]);
      fs.writeFileSync(scoreboardHistoryPath(dir), "{not json}\n", "utf8");
      expect(() => readScoreboardHistory(dir)).toThrow(/line 1 is not valid JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
