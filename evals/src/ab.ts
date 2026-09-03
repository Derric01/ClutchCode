import path from "node:path";

import type { Budgets, ProviderKind } from "@clutchcode/agent-api";

import { checkTaskRequirements, type EvalTask } from "./eval-task.js";
import { runEvalTask } from "./eval-runner.js";
import { runNakedTask, type NakedRunOptions, type NakedTaskResult } from "./naked-arm.js";
import { computeScoreboard, type EvalTaskResult, type Scoreboard } from "./scoreboard.js";

/**
 * The §16.4 A/B — **the actual North Star claim** (PROJECT_SPEC.md §16.1,
 * §16.4).
 *
 * §16.1: *"VTCR of a 14B-class local model with the ClutchCode harness
 * materially exceeds the same model's single-shot/naked VTCR … If that
 * delta is not real and measurable, the project has no reason to exist."*
 * §16.4 spells out the experiment: the same model, both arms, "the VTCR
 * delta with confidence intervals over repeated runs".
 *
 * This module is the comparator. `eval-runner.ts` provides the ClutchCode
 * arm, `naked-arm.ts` the naked one; everything here is about turning two
 * sets of per-task outcomes into a delta nobody has to take on trust.
 *
 * ## Why the statistics are shaped the way they are
 *
 * **Per-arm VTCR gets a Wilson score interval, not a Wald one.** These
 * boards sit at 0% and 100% constantly — a five-task suite against a
 * scripted model is *usually* one or the other — and the textbook
 * `p̂ ± z·√(p̂(1-p̂)/n)` interval collapses to zero width exactly there,
 * reporting infinite confidence from five observations. Wilson does not.
 *
 * **The delta gets a cluster bootstrap over tasks, not a two-proportion
 * z-test.** The observations are paired (the same task, the same
 * repetition, both arms) and correlated within a task: an easy task is
 * easy in both arms, K times over. Treating `tasks × repetitions`
 * Bernoulli trials as independent would understate the interval by
 * exactly the amount that matters. Resampling whole *tasks* keeps each
 * task's repetitions together, which is the correlation structure that
 * actually exists, and needs no distributional assumption at all.
 *
 * The honest consequence, stated here and attached to every report: with
 * a five-task suite the interval is **wide and coarse**. That is not a
 * defect of the method, it is what five tasks can support. Growing the
 * suite (§16.3a) is what narrows it — not a different formula.
 */

export const ARMS = ["clutchcode", "naked"] as const;
export type Arm = (typeof ARMS)[number];

export interface Interval {
  lo: number;
  hi: number;
}

/** Two-sided 95% normal quantile. */
export const Z_95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion.
 *
 * Chosen over the Wald interval because it stays sane at the boundaries —
 * `wilsonInterval(0, 10)` is `[0, 0.2775]`, not `[0, 0]` — which is the
 * regime a small eval suite actually lives in. Verified against published
 * reference values in `ab.test.ts`.
 */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(n)) {
    throw new Error(`wilsonInterval needs integer counts, got ${successes}/${n}`);
  }
  if (n <= 0) throw new Error("wilsonInterval needs at least one observation");
  if (successes < 0 || successes > n) throw new Error(`wilsonInterval: ${successes} successes out of ${n} is impossible`);

  const z2 = z * z;
  const denominator = n + z2;
  const center = (successes + z2 / 2) / denominator;
  const halfWidth = (z / denominator) * Math.sqrt((successes * (n - successes)) / n + z2 / 4);
  return { lo: Math.max(0, center - halfWidth), hi: Math.min(1, center + halfWidth) };
}

/**
 * mulberry32 — a small, public-domain 32-bit PRNG.
 *
 * A bootstrap that used `Math.random()` would give a different confidence
 * interval every time the same board was re-analyzed, which makes a
 * published number unreproducible. The seed is recorded on the report so
 * anyone can rerun the analysis and get the same interval back.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PerTaskOutcome {
  taskId: string;
  clutchcodeSolved: number;
  nakedSolved: number;
  /** Repetitions of this task in each arm — the same number in both, by construction. */
  repetitions: number;
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  /** Two-sided; 0.05 → a 95% percentile interval. */
  alpha?: number;
}

export const DEFAULT_BOOTSTRAP_RESAMPLES = 5000;
export const DEFAULT_BOOTSTRAP_SEED = 20260904;

/**
 * Percentile bootstrap for the paired VTCR delta, clustered on the task.
 *
 * Each resample draws `perTask.length` tasks **with replacement** and
 * recomputes both arms' rates over the drawn tasks — so a task's
 * repetitions always travel together and the within-task correlation is
 * preserved rather than assumed away.
 */
export function pairedBootstrapDeltaInterval(perTask: PerTaskOutcome[], opts: BootstrapOptions = {}): Interval {
  if (perTask.length === 0) throw new Error("cannot bootstrap a delta from zero tasks");
  const resamples = opts.resamples ?? DEFAULT_BOOTSTRAP_RESAMPLES;
  const alpha = opts.alpha ?? 0.05;
  if (resamples < 1) throw new Error("bootstrap needs at least one resample");
  if (!(alpha > 0 && alpha < 1)) throw new Error(`alpha must be strictly between 0 and 1, got ${alpha}`);

  const random = mulberry32(opts.seed ?? DEFAULT_BOOTSTRAP_SEED);
  const deltas: number[] = [];

  for (let r = 0; r < resamples; r += 1) {
    let clutch = 0;
    let naked = 0;
    let total = 0;
    for (let k = 0; k < perTask.length; k += 1) {
      const drawn = perTask[Math.floor(random() * perTask.length)]!;
      clutch += drawn.clutchcodeSolved;
      naked += drawn.nakedSolved;
      total += drawn.repetitions;
    }
    // A resample can only have zero observations if every drawn task had
    // zero repetitions, which `computeAbReport` rejects up front.
    deltas.push(total === 0 ? 0 : (clutch - naked) / total);
  }

  deltas.sort((a, b) => a - b);
  const m = deltas.length;
  const clamp = (i: number): number => Math.min(m - 1, Math.max(0, i));
  return {
    lo: deltas[clamp(Math.floor((alpha / 2) * m))]!,
    hi: deltas[clamp(Math.ceil((1 - alpha / 2) * m) - 1)]!
  };
}

export interface ArmSummary {
  arm: Arm;
  /** tasks × repetitions. */
  observations: number;
  solved: number;
  /** §16.1's VTCR for this arm. */
  vtcr: number;
  ci95: Interval;
}

export interface AbReport {
  schemaVersion: 1;
  generatedAt: string;
  suite: string;
  provider: string;
  model: string;
  taskCount: number;
  /** §16.4's "K seeds" — independent repetitions (see `RunAbOptions.repetitions`). */
  repetitions: number;
  clutchcode: ArmSummary;
  naked: ArmSummary;
  /** §16.4's headline: VTCR(ClutchCode) − VTCR(naked). */
  vtcrDelta: number;
  deltaCi95: Interval;
  bootstrapResamples: number;
  bootstrapSeed: number;
  /** Per-task counts, so the headline delta can be re-derived by hand from the report alone. */
  perTask: PerTaskOutcome[];
  /** Observations excluded because the host could not run the task (see `ArmObservation.refused`). */
  refusedObservations: number;
  /** Task ids excluded for that reason, so a reader can see exactly what was left out. */
  refusedTaskIds: string[];
  /** Honest caveats attached to this specific comparison. */
  notes: string[];
}

export interface AbReportMeta {
  suite: string;
  provider: string;
  model: string;
  generatedAt?: string;
  bootstrap?: BootstrapOptions;
}

/** One arm's outcome for one (task, repetition) cell. */
export interface ArmObservation {
  taskId: string;
  repetition: number;
  solved: boolean;
  /**
   * The host could not run this task at all (its declared `requires` are
   * unusable here), so **both** arms refused it and neither result says
   * anything about the agent.
   *
   * Such an observation is excluded from the scored denominator rather than
   * counted as a mutual failure. Counting it silently halved a real delta:
   * one solvable task (ClutchCode solves, naked does not) plus one unrunnable
   * task reported `vtcrDelta` 0.5 with a 95% interval of [0, 1], where the
   * tasks that actually ran gave 1.0 and [1, 1]. Nothing threw, because the
   * refusal is symmetric and so every pairing check passes — the delta just
   * quietly drifted toward zero because a binary was missing. §16.4's delta
   * is the North Star claim, so it is computed over tasks that genuinely ran
   * and the excluded ones are reported explicitly instead.
   */
  refused?: boolean;
}

function keyOf(o: ArmObservation): string {
  return `${o.taskId}\u0000${o.repetition}`;
}

/**
 * Turn two arms' observations into the §16.4 report.
 *
 * Pure — no filesystem, no processes, no model — so every number below is
 * unit-testable without running a suite. The pairing is **checked, not
 * assumed**: an A/B whose arms cover different (task, repetition) cells is
 * not a paired comparison, and silently averaging it would produce a
 * confident-looking delta from mismatched data.
 */
export function computeAbReport(meta: AbReportMeta, clutchcode: ArmObservation[], naked: ArmObservation[]): AbReport {
  if (clutchcode.length === 0) throw new Error("cannot compute an A/B report from zero observations");
  if (clutchcode.length !== naked.length) {
    throw new Error(`unpaired A/B: the ClutchCode arm has ${clutchcode.length} observations and the naked arm ${naked.length}`);
  }
  const nakedByKey = new Map(naked.map((o) => [keyOf(o), o]));
  if (nakedByKey.size !== naked.length) throw new Error("the naked arm has duplicate (task, repetition) observations");
  for (const o of clutchcode) {
    if (!nakedByKey.has(keyOf(o))) {
      throw new Error(`unpaired A/B: the naked arm has no observation for task "${o.taskId}" repetition ${o.repetition}`);
    }
  }

  // A refusal must be symmetric: both arms consult the same
  // `checkTaskRequirements` on the same host, so a task refused in one arm and
  // not the other means the two arms disagreed about what they even attempted,
  // and no delta computed from that is meaningful. Fail loudly rather than
  // average across it.
  for (const o of clutchcode) {
    const pair = nakedByKey.get(keyOf(o))!;
    if ((o.refused ?? false) !== (pair.refused ?? false)) {
      throw new Error(
        `asymmetric A/B refusal: task "${o.taskId}" repetition ${o.repetition} was refused by the ` +
          `${o.refused ? "ClutchCode" : "naked"} arm but run by the other — the arms disagree about what was attempted`
      );
    }
  }

  const refusedTaskIds = [...new Set(clutchcode.filter((o) => o.refused).map((o) => o.taskId))];
  const refusedObservations = clutchcode.filter((o) => o.refused).length;
  const scored = clutchcode.filter((o) => !o.refused);
  if (scored.length === 0) {
    throw new Error(
      `cannot compute an A/B report: all ${clutchcode.length} observation(s) were refused because this host ` +
        `cannot run them (${refusedTaskIds.join(", ")})`
    );
  }

  const perTaskMap = new Map<string, PerTaskOutcome>();
  const order: string[] = [];
  for (const o of scored) {
    let row = perTaskMap.get(o.taskId);
    if (!row) {
      row = { taskId: o.taskId, clutchcodeSolved: 0, nakedSolved: 0, repetitions: 0 };
      perTaskMap.set(o.taskId, row);
      order.push(o.taskId);
    }
    row.repetitions += 1;
    if (o.solved) row.clutchcodeSolved += 1;
    if (nakedByKey.get(keyOf(o))!.solved) row.nakedSolved += 1;
  }
  const perTask = order.map((id) => perTaskMap.get(id)!);

  const observations = scored.length;
  const clutchSolved = scored.filter((o) => o.solved).length;
  const nakedSolved = scored.filter((o) => nakedByKey.get(keyOf(o))!.solved).length;
  const repetitionCounts = new Set(perTask.map((t) => t.repetitions));
  if (repetitionCounts.size !== 1) {
    throw new Error(`unbalanced A/B: tasks were run a different number of times (${[...repetitionCounts].sort((a, b) => a - b).join(", ")})`);
  }
  const repetitions = perTask[0]!.repetitions;

  const bootstrapResamples = meta.bootstrap?.resamples ?? DEFAULT_BOOTSTRAP_RESAMPLES;
  const bootstrapSeed = meta.bootstrap?.seed ?? DEFAULT_BOOTSTRAP_SEED;
  const deltaCi95 = pairedBootstrapDeltaInterval(perTask, { ...meta.bootstrap, resamples: bootstrapResamples, seed: bootstrapSeed });

  const vtcrDelta = (clutchSolved - nakedSolved) / observations;

  const notes: string[] = [
    "the naked arm is graded on the held-out oracle alone, while the ClutchCode arm must also reach DONE with a green deterministic gate and zero cheat flags (§14.7) before its oracle result counts. That asymmetry favours the naked arm, so this delta is a conservative floor."
  ];
  if (repetitions === 1) {
    notes.push(
      "run with 1 repetition: §16.4 asks for K seeds because local models are nondeterministic, so this interval reflects between-task variation only, not the model's own run-to-run variance."
    );
  }
  if (perTask.length < 10) {
    notes.push(
      `the delta interval is a cluster bootstrap over ${perTask.length} task(s); below ~10 tasks it is coarse, and a zero-width interval means every resample agreed, not that the estimate is precise.`
    );
  }
  if (refusedObservations > 0) {
    notes.push(
      `${refusedObservations} observation(s) were excluded because this host cannot run the task (${refusedTaskIds.join(", ")}); ` +
        `the delta is over the ${observations} observation(s) that actually ran. Counting a refusal as a mutual failure would drag the delta toward zero for an environment reason.`
    );
  }
  if (deltaCi95.lo <= 0 && deltaCi95.hi >= 0) {
    notes.push("the 95% interval for the delta includes 0 — on its own this comparison does not substantiate §16.1's claim.");
  }

  return {
    schemaVersion: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    suite: meta.suite,
    provider: meta.provider,
    model: meta.model,
    taskCount: perTask.length,
    refusedObservations,
    refusedTaskIds,
    repetitions,
    clutchcode: { arm: "clutchcode", observations, solved: clutchSolved, vtcr: clutchSolved / observations, ci95: wilsonInterval(clutchSolved, observations) },
    naked: { arm: "naked", observations, solved: nakedSolved, vtcr: nakedSolved / observations, ci95: wilsonInterval(nakedSolved, observations) },
    vtcrDelta,
    deltaCi95,
    bootstrapResamples,
    bootstrapSeed,
    perTask,
    notes
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function signedPct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

/** A human-readable §16.4 report for a terminal (`--json` keeps the machine form). */
export function formatAbReport(report: AbReport): string {
  const lines: string[] = [];
  lines.push(`ClutchCode vs. naked single-shot (§16.4) — ${report.provider}/${report.model || "(no model id)"}`);
  lines.push(`suite: ${report.suite}`);
  lines.push(`generated: ${report.generatedAt}`);
  lines.push(`${report.taskCount} task(s) × ${report.repetitions} repetition(s) = ${report.clutchcode.observations} observations per arm`);
  lines.push("");
  lines.push(`VTCR, ClutchCode arm:  ${pct(report.clutchcode.vtcr)}  (${report.clutchcode.solved}/${report.clutchcode.observations})  95% CI [${pct(report.clutchcode.ci95.lo)}, ${pct(report.clutchcode.ci95.hi)}]`);
  lines.push(`VTCR, naked arm:       ${pct(report.naked.vtcr)}  (${report.naked.solved}/${report.naked.observations})  95% CI [${pct(report.naked.ci95.lo)}, ${pct(report.naked.ci95.hi)}]`);
  lines.push(`VTCR delta:            ${signedPct(report.vtcrDelta)}  95% CI [${signedPct(report.deltaCi95.lo)}, ${signedPct(report.deltaCi95.hi)}]  (cluster bootstrap over tasks, ${report.bootstrapResamples} resamples, seed ${report.bootstrapSeed})`);
  lines.push("");

  const idWidth = Math.max(4, ...report.perTask.map((t) => t.taskId.length));
  lines.push(`${"task".padEnd(idWidth)}  clutchcode  naked`);
  for (const t of report.perTask) {
    lines.push(`${t.taskId.padEnd(idWidth)}  ${`${t.clutchcodeSolved}/${t.repetitions}`.padEnd(10)}  ${t.nakedSolved}/${t.repetitions}`);
  }

  lines.push("");
  for (const note of report.notes) lines.push(`note: ${note}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Running the comparison
// ---------------------------------------------------------------------------

export interface RunAbOptions {
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  /** Label recorded on the report — the suite directory by default. */
  suiteLabel?: string;
  /**
   * §16.4's "K seeds". Named `repetitions` because that is exactly what it
   * is: `NormalizedRequest` carries no seed field, so nothing here sets a
   * provider-side seed. The point of K is to average over a local model's
   * own run-to-run nondeterminism, which independent repetitions do.
   */
  repetitions?: number;
  workDir?: string;
  keepWorkDir?: boolean;
  budgets?: Partial<Budgets>;
  bootstrap?: BootstrapOptions;
  naked?: Pick<NakedRunOptions, "maxOutputTokens" | "temperature" | "promptFiles">;
  onArmStart?: (arm: Arm, task: EvalTask, repetition: number) => void;
  onClutchcodeResult?: (result: EvalTaskResult, repetition: number) => void;
  onNakedResult?: (result: NakedTaskResult) => void;
}

export interface AbRunOutput {
  report: AbReport;
  /** The ClutchCode arm's own §16.2 board, pooled over every repetition — the supporting metrics the naked arm has no analogue for. */
  clutchcodeBoard: Scoreboard;
  clutchcodeResults: EvalTaskResult[];
  nakedResults: NakedTaskResult[];
}

/**
 * Run both arms of the §16.4 A/B over a suite.
 *
 * Order is fixed — for each repetition, each task, the ClutchCode arm then
 * the naked arm — because a comparison whose execution order varies is not
 * reproducible, and because the harness's own tests script both arms
 * through one endpoint.
 */
export async function runAbComparison(tasks: EvalTask[], opts: RunAbOptions): Promise<AbRunOutput> {
  if (tasks.length === 0) throw new Error("cannot run an A/B over an empty eval suite");
  const repetitions = opts.repetitions ?? 1;
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error(`repetitions must be a positive integer, got ${repetitions}`);

  const clutchcodeResults: EvalTaskResult[] = [];
  const nakedResults: NakedTaskResult[] = [];
  const clutchObservations: ArmObservation[] = [];
  const nakedObservations: ArmObservation[] = [];

  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const task of tasks) {
      // Asked once, here, and applied to both arms — so a refusal is symmetric
      // by construction rather than by two runners happening to agree. Both
      // `runEvalTask` and `runNakedTask` make the same call internally and
      // refuse too; this is the same memoized check, used to mark the pair.
      const runnable = checkTaskRequirements(task).ok;

      opts.onArmStart?.("clutchcode", task, repetition);
      const { result } = await runEvalTask(task, {
        providerKind: opts.providerKind,
        model: opts.model,
        baseUrl: opts.baseUrl,
        // Each repetition gets its own scratch directory: `runEvalTask`
        // names a task's directory after the task id alone, so sharing one
        // parent across repetitions would have repetition 2 collide with
        // repetition 1's tree.
        workDir: opts.workDir === undefined ? undefined : path.join(opts.workDir, `clutchcode-r${repetition}`),
        keepWorkDir: opts.keepWorkDir,
        budgets: opts.budgets
      });
      clutchcodeResults.push(result);
      clutchObservations.push({ taskId: task.id, repetition, solved: result.verified, refused: !runnable });
      opts.onClutchcodeResult?.(result, repetition);

      opts.onArmStart?.("naked", task, repetition);
      const naked = await runNakedTask(task, {
        providerKind: opts.providerKind,
        model: opts.model,
        baseUrl: opts.baseUrl,
        repetition,
        workDir: opts.workDir === undefined ? undefined : path.join(opts.workDir, "naked"),
        keepWorkDir: opts.keepWorkDir,
        ...opts.naked
      });
      nakedResults.push(naked.result);
      nakedObservations.push({ taskId: task.id, repetition, solved: naked.result.solved, refused: !runnable });
      opts.onNakedResult?.(naked.result);
    }
  }

  const suite = opts.suiteLabel ?? path.dirname(tasks[0]!.dir);
  const report = computeAbReport(
    { suite, provider: opts.providerKind, model: opts.model, bootstrap: opts.bootstrap },
    clutchObservations,
    nakedObservations
  );

  const nakedErrors = nakedResults.filter((r) => r.error);
  if (nakedErrors.length > 0) {
    report.notes.push(
      `${nakedErrors.length} naked-arm run(s) ended with an error rather than a finished call — scored unsolved, which biases the delta *upward*: ${[
        ...new Set(nakedErrors.map((r) => r.taskId))
      ].join(", ")}.`
    );
  }

  const clutchcodeBoard = computeScoreboard({ suite, provider: opts.providerKind, model: opts.model }, clutchcodeResults);
  if (repetitions > 1) {
    clutchcodeBoard.notes.push(
      `this board pools ${repetitions} repetitions, so "taskCount" is task-runs (${tasks.length} tasks × ${repetitions}), not distinct tasks.`
    );
  }

  return { report, clutchcodeBoard, clutchcodeResults, nakedResults };
}
