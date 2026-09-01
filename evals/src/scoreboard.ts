import type { RunState, RunStatus, ToolCallLogEntry } from "@clutchcode/agent-api";

import type { EvalCategory, EvalTask, OracleResult } from "./eval-task.js";

/**
 * The per-model scoreboard (PROJECT_SPEC.md §16.1, §16.2, §16.3b).
 *
 * Everything here is a **pure function of a finished run** — a `RunState`
 * plus the held-out oracle's verdict — so the metric definitions are
 * directly unit-testable without running a model, and the runner
 * (`eval-runner.ts`) stays a thin "materialize → run → grade" shell.
 *
 * Where a metric's literal §16.2 phrasing turns out to be degenerate or
 * unmeasurable against the runtime as it actually exists today, this file
 * says so at the definition rather than quietly reporting a number that
 * looks measured but isn't — see `cheatFlagsPerTask` and
 * `costPerSolvedTaskUsd`.
 */

export interface EvalTaskResult {
  taskId: string;
  category: EvalCategory;
  language: string;
  runId: string;
  /** The run's final state-machine status (§6.2). */
  status: RunStatus;
  /** The deterministic gate (§14.1) was green at the run's last verification. */
  gateGreen: boolean;
  /** Cheat flags (§14.6) raised at the run's last verification. */
  cheatFlags: number;
  /** The harness itself believed it was finished: DONE, green gate, no cheat flags (§14.7). */
  claimedDone: boolean;
  /** The held-out oracle passed against the delivered repository (§16.3b). */
  oraclePassed: boolean;
  /** §16.1's VTCR numerator: the harness completed it AND the held-out oracle agrees. */
  verified: boolean;
  /** §16.2 metric 1: `edit_file`/`write_file` calls attempted and applied. */
  editAttempts: number;
  editsApplied: number;
  /** §16.2 metric 4: the run ended needing a human (escalated, or parked awaiting approval). */
  neededHuman: boolean;
  /** §16.2 metric 5 input: the run touched at least one of the task's `solutionPaths`. */
  readAnySolutionPath: boolean;
  tokens: number;
  /** Always 0 until a provider adapter reports cost — see `Scoreboard.notes`. */
  costUsd: number;
  /** Measured by the harness around the whole run, so it includes verification, not just model time. */
  wallclockMs: number;
  steps: number;
  repairIterations: number;
  escalationReason?: string;
  oracleExitCode: number | null;
  /** Set when the run threw instead of finishing — a harness/environment failure, reported, never silently scored as a task failure. */
  error?: string;
}

export interface ScoreboardMetrics {
  /** §16.2 #1 — applied edits / attempted edits. `null` when the run attempted no edits at all. */
  editFormatAccuracy: number | null;
  /**
   * §16.2 #2, stated honestly. The literal metric ("cheat flags per solved
   * task") is degenerate under §14.7's own completion contract: a cheat
   * flag forces ESCALATED, so a flagged run can never also be a solved
   * one, and the literal ratio is identically zero no matter how badly the
   * detectors regress. These two are the non-degenerate form of the same
   * question — total flags per task, and the share of tasks that drew any
   * flag at all.
   */
  cheatFlagsPerTask: number;
  cheatFlaggedTaskRate: number;
  /**
   * §16.2 #3. `null` until a provider adapter actually reports cost:
   * `BudgetGuard.recordUsage` takes a `costUsd`, but no adapter passes one
   * today, so a computed number here would be a measured-looking zero.
   */
  costPerSolvedTaskUsd: number | null;
  /** §16.2 #3, local tiers. `null` when nothing was solved. */
  wallclockPerSolvedTaskMs: number | null;
  /** §16.2 #4 — share of tasks that ended needing a human. */
  humanInterventionRate: number;
  /** §16.2 #5 — share of tasks that failed the oracle without the run ever touching a solution path. */
  retrievalInsufficiencyRate: number;
}

export interface Scoreboard {
  schemaVersion: 1;
  generatedAt: string;
  suite: string;
  provider: string;
  model: string;
  taskCount: number;
  solvedCount: number;
  /** §16.1 North Star: solved / taskCount. */
  vtcr: number;
  /** Share of tasks the harness *claimed* were done (green gate, no cheat flags). */
  claimedDoneRate: number;
  /**
   * Claimed done but the held-out oracle disagreed — the number the whole
   * completion contract (§14.7) exists to keep at zero, and the reason the
   * oracle is held out at all.
   */
  falseCompletionRate: number;
  metrics: ScoreboardMetrics;
  /** Honest caveats attached to this specific board (unmeasurable metrics, harness errors). */
  notes: string[];
  tasks: EvalTaskResult[];
}

const EDIT_TOOLS = new Set(["edit_file", "write_file"]);

function countEdits(log: ToolCallLogEntry[]): { attempts: number; applied: number } {
  let attempts = 0;
  let applied = 0;
  for (const entry of log) {
    if (!EDIT_TOOLS.has(entry.tool)) continue;
    attempts += 1;
    if (entry.ok) applied += 1;
  }
  return { attempts, applied };
}

/**
 * §16.2 #5's input signal. Deliberately a *substring* check over the
 * recorded (already-redacted) tool-call arguments rather than a
 * per-tool argument schema walk: read_file, search, shell and the edit
 * tools all name a path differently, and the question being asked here —
 * "did this run ever go near the file it needed?" — is answered the same
 * way by all of them. Documented as a heuristic in
 * `docs/EVAL_METHODOLOGY.md`; it grades nothing, it only explains failures.
 */
function touchedAnySolutionPath(log: ToolCallLogEntry[], solutionPaths: string[]): boolean {
  return log.some((entry) => {
    // `ToolCallLogEntry.args` is typed `unknown` even though the runtime
    // writes the redacted args *string* — normalize rather than assume.
    const args = typeof entry.args === "string" ? entry.args : JSON.stringify(entry.args ?? "");
    return solutionPaths.some((p) => args.includes(p));
  });
}

export interface SummarizeInput {
  task: EvalTask;
  state: RunState;
  oracle: OracleResult;
  /** Harness-measured wall-clock for the whole run, verification included. */
  wallclockMs: number;
  error?: string;
}

/** Grade one finished run against one task. Pure — no filesystem, no processes. */
export function summarizeRun(input: SummarizeInput): EvalTaskResult {
  const { task, state, oracle } = input;
  const lastVerification = state.verificationResults.at(-1);
  const gateGreen = lastVerification?.allGreen ?? false;
  const cheatFlags = lastVerification?.cheatFlagCount ?? 0;
  const claimedDone = state.status === "DONE" && gateGreen && cheatFlags === 0;
  const { attempts, applied } = countEdits(state.toolCallLog);

  return {
    taskId: task.id,
    category: task.category,
    language: task.language,
    runId: state.runId,
    status: state.status,
    gateGreen,
    cheatFlags,
    claimedDone,
    oraclePassed: oracle.passed,
    verified: claimedDone && oracle.passed,
    editAttempts: attempts,
    editsApplied: applied,
    neededHuman: state.status === "ESCALATED" || state.status === "AWAITING_APPROVAL",
    readAnySolutionPath: touchedAnySolutionPath(state.toolCallLog, task.solutionPaths),
    tokens: state.consumed.tokens,
    costUsd: state.consumed.costUsd,
    wallclockMs: input.wallclockMs,
    steps: state.consumed.steps,
    repairIterations: state.repairIterations,
    escalationReason: state.escalationReason,
    oracleExitCode: oracle.exitCode,
    error: input.error
  };
}

export interface ScoreboardMeta {
  suite: string;
  provider: string;
  model: string;
  generatedAt?: string;
}

export function computeScoreboard(meta: ScoreboardMeta, tasks: EvalTaskResult[]): Scoreboard {
  const taskCount = tasks.length;
  if (taskCount === 0) throw new Error("cannot compute a scoreboard from zero task results");

  const rate = (n: number): number => n / taskCount;
  const solved = tasks.filter((t) => t.verified);
  const solvedCount = solved.length;

  const editAttempts = tasks.reduce((sum, t) => sum + t.editAttempts, 0);
  const editsApplied = tasks.reduce((sum, t) => sum + t.editsApplied, 0);
  const totalCheatFlags = tasks.reduce((sum, t) => sum + t.cheatFlags, 0);
  const totalCostUsd = tasks.reduce((sum, t) => sum + t.costUsd, 0);
  const totalWallclockMs = tasks.reduce((sum, t) => sum + t.wallclockMs, 0);
  const anyCostReported = tasks.some((t) => t.costUsd > 0);

  const notes: string[] = [];
  if (!anyCostReported) {
    notes.push(
      "cost per solved task is null: no provider adapter reports a per-request cost yet, so a number here would be a measured-looking zero (§16.2 #3)."
    );
  }
  const errored = tasks.filter((t) => t.error);
  if (errored.length > 0) {
    // Scored as unsolved (nothing was delivered), but called out rather
    // than blended into the ordinary failures: a run that *threw* says
    // something about the environment or the provider, not about the
    // model's ability to do the task, and a board that hid that would
    // understate its own noise. `--provider fake`, for instance, scripts
    // exactly one turn, so any task needing a repair iteration ends here.
    notes.push(
      `${errored.length} task(s) ended with a run-level error rather than a finished run — scored unsolved, see each task's "error": ${errored
        .map((t) => t.taskId)
        .join(", ")}.`
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    suite: meta.suite,
    provider: meta.provider,
    model: meta.model,
    taskCount,
    solvedCount,
    vtcr: rate(solvedCount),
    claimedDoneRate: rate(tasks.filter((t) => t.claimedDone).length),
    falseCompletionRate: rate(tasks.filter((t) => t.claimedDone && !t.oraclePassed).length),
    metrics: {
      editFormatAccuracy: editAttempts === 0 ? null : editsApplied / editAttempts,
      cheatFlagsPerTask: totalCheatFlags / taskCount,
      cheatFlaggedTaskRate: rate(tasks.filter((t) => t.cheatFlags > 0).length),
      costPerSolvedTaskUsd: anyCostReported && solvedCount > 0 ? totalCostUsd / solvedCount : null,
      wallclockPerSolvedTaskMs: solvedCount > 0 ? totalWallclockMs / solvedCount : null,
      humanInterventionRate: rate(tasks.filter((t) => t.neededHuman).length),
      retrievalInsufficiencyRate: rate(tasks.filter((t) => !t.oraclePassed && !t.readAnySolutionPath).length)
    },
    notes,
    tasks
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function optional(x: number | null, format: (n: number) => string): string {
  return x === null ? "n/a" : format(x);
}

/** A human-readable board for a terminal (§18.4 keeps `--json` for machines). */
export function formatScoreboard(board: Scoreboard): string {
  const lines: string[] = [];
  lines.push(`ClutchCode eval scoreboard (§16) — ${board.provider}/${board.model || "(no model id)"}`);
  lines.push(`suite: ${board.suite}`);
  lines.push(`generated: ${board.generatedAt}`);
  lines.push("");
  lines.push(`VTCR (§16.1):            ${pct(board.vtcr)}  (${board.solvedCount}/${board.taskCount} verified)`);
  lines.push(`claimed done:            ${pct(board.claimedDoneRate)}`);
  lines.push(`false completions:       ${pct(board.falseCompletionRate)}  (claimed done, held-out oracle disagreed)`);
  lines.push("");
  lines.push(`edit-format accuracy:    ${optional(board.metrics.editFormatAccuracy, pct)}`);
  lines.push(`cheat flags per task:    ${board.metrics.cheatFlagsPerTask.toFixed(2)}  (tasks flagged: ${pct(board.metrics.cheatFlaggedTaskRate)})`);
  lines.push(`cost / solved task:      ${optional(board.metrics.costPerSolvedTaskUsd, (n) => `$${n.toFixed(4)}`)}`);
  lines.push(`wall-clock / solved:     ${optional(board.metrics.wallclockPerSolvedTaskMs, (n) => `${(n / 1000).toFixed(1)}s`)}`);
  lines.push(`human-intervention rate: ${pct(board.metrics.humanInterventionRate)}`);
  lines.push(`retrieval insufficiency: ${pct(board.metrics.retrievalInsufficiencyRate)}`);
  lines.push("");

  const idWidth = Math.max(4, ...board.tasks.map((t) => t.taskId.length));
  lines.push(`${"task".padEnd(idWidth)}  result    status              oracle   edits    steps`);
  for (const t of board.tasks) {
    const result = t.verified ? "VERIFIED" : t.claimedDone ? "FALSE-OK" : "failed  ";
    const edits = `${t.editsApplied}/${t.editAttempts}`;
    lines.push(
      `${t.taskId.padEnd(idWidth)}  ${result}  ${t.status.padEnd(18)}  ${(t.oraclePassed ? "pass" : "fail").padEnd(7)}  ${edits.padEnd(7)}  ${t.steps}`
    );
  }

  if (board.notes.length > 0) {
    lines.push("");
    for (const note of board.notes) lines.push(`note: ${note}`);
  }

  return lines.join("\n");
}
