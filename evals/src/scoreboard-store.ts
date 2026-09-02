import fs from "node:fs";
import path from "node:path";

import type { AbReport } from "./ab.js";
import type { Scoreboard } from "./scoreboard.js";

/**
 * Scoreboard persistence (PROJECT_SPEC.md §16.3b — "stored in the run DB").
 *
 * The project has no SQLite dependency yet (see `RunStateStore`'s note:
 * §15.1/§19.2 target SQLite+JSONL, Phase 1 ships the JSON/JSONL half), so a
 * board is stored the same way every other durable artifact here is: one
 * full JSON document per run, plus an append-only JSONL history of the
 * headline numbers. Append-only is the point — a scoreboard is only useful
 * as a *series*, since §16.2's metrics are regression detectors, not
 * one-off readings.
 */

export interface SavedScoreboard {
  /** The full board document. */
  jsonPath: string;
  /** The append-only history this run was added to. */
  historyPath: string;
}

/** One row of the append-only history — the headline numbers, without the per-task detail. */
export interface ScoreboardHistoryRow {
  generatedAt: string;
  suite: string;
  provider: string;
  model: string;
  taskCount: number;
  solvedCount: number;
  vtcr: number;
  claimedDoneRate: number;
  falseCompletionRate: number;
  editFormatAccuracy: number | null;
  cheatFlagsPerTask: number;
  humanInterventionRate: number;
  retrievalInsufficiencyRate: number;
  file: string;
}

function slugForFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function scoreboardHistoryPath(dir: string): string {
  return path.join(dir, "scoreboard.jsonl");
}

export function saveScoreboard(dir: string, board: Scoreboard): SavedScoreboard {
  fs.mkdirSync(dir, { recursive: true });

  const stamp = board.generatedAt.replace(/[:.]/g, "-");
  const name = `scoreboard-${stamp}-${slugForFilename(board.provider)}-${slugForFilename(board.model || "no-model")}.json`;
  const jsonPath = path.join(dir, name);
  fs.writeFileSync(jsonPath, `${JSON.stringify(board, null, 2)}\n`, "utf8");

  const row: ScoreboardHistoryRow = {
    generatedAt: board.generatedAt,
    suite: board.suite,
    provider: board.provider,
    model: board.model,
    taskCount: board.taskCount,
    solvedCount: board.solvedCount,
    vtcr: board.vtcr,
    claimedDoneRate: board.claimedDoneRate,
    falseCompletionRate: board.falseCompletionRate,
    editFormatAccuracy: board.metrics.editFormatAccuracy,
    cheatFlagsPerTask: board.metrics.cheatFlagsPerTask,
    humanInterventionRate: board.metrics.humanInterventionRate,
    retrievalInsufficiencyRate: board.metrics.retrievalInsufficiencyRate,
    file: name
  };
  const historyPath = scoreboardHistoryPath(dir);
  fs.appendFileSync(historyPath, `${JSON.stringify(row)}\n`, "utf8");

  return { jsonPath, historyPath };
}

/** Read the append-only history back, oldest first. A malformed line fails loudly rather than being skipped — a silently-dropped row would understate a regression. */
export function readScoreboardHistory(dir: string): ScoreboardHistoryRow[] {
  const file = scoreboardHistoryPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as ScoreboardHistoryRow;
      } catch (err) {
        throw new Error(`${file}: line ${i + 1} is not valid JSON (${(err as Error).message})`);
      }
    });
}

// ---------------------------------------------------------------------------
// The §16.4 A/B report
// ---------------------------------------------------------------------------

/** One row of the append-only A/B history — the headline delta, without the per-task detail. */
export interface AbHistoryRow {
  generatedAt: string;
  suite: string;
  provider: string;
  model: string;
  taskCount: number;
  repetitions: number;
  clutchcodeVtcr: number;
  nakedVtcr: number;
  vtcrDelta: number;
  deltaCi95Lo: number;
  deltaCi95Hi: number;
  file: string;
}

export function abHistoryPath(dir: string): string {
  return path.join(dir, "ab.jsonl");
}

export interface SavedAbReport {
  jsonPath: string;
  historyPath: string;
}

/**
 * Persist a §16.4 A/B report the same way a scoreboard is persisted: one
 * full JSON document, plus an append-only history of the headline numbers.
 * A delta is only meaningful as a series — §16.4 asks for it to be
 * published so the claim is falsifiable, and a single reading cannot show
 * whether it is holding up.
 */
export function saveAbReport(dir: string, report: AbReport): SavedAbReport {
  fs.mkdirSync(dir, { recursive: true });

  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const name = `ab-${stamp}-${slugForFilename(report.provider)}-${slugForFilename(report.model || "no-model")}.json`;
  const jsonPath = path.join(dir, name);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const row: AbHistoryRow = {
    generatedAt: report.generatedAt,
    suite: report.suite,
    provider: report.provider,
    model: report.model,
    taskCount: report.taskCount,
    repetitions: report.repetitions,
    clutchcodeVtcr: report.clutchcode.vtcr,
    nakedVtcr: report.naked.vtcr,
    vtcrDelta: report.vtcrDelta,
    deltaCi95Lo: report.deltaCi95.lo,
    deltaCi95Hi: report.deltaCi95.hi,
    file: name
  };
  const historyPath = abHistoryPath(dir);
  fs.appendFileSync(historyPath, `${JSON.stringify(row)}\n`, "utf8");

  return { jsonPath, historyPath };
}

/** Read the append-only A/B history back, oldest first. A malformed line fails loudly, for the same reason `readScoreboardHistory` does. */
export function readAbHistory(dir: string): AbHistoryRow[] {
  const file = abHistoryPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as AbHistoryRow;
      } catch (err) {
        throw new Error(`${file}: line ${i + 1} is not valid JSON (${(err as Error).message})`);
      }
    });
}
