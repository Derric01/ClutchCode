import { spawnSync } from "node:child_process";
import { truncate } from "@clutchcode/tools";
import type { ToolchainCommands } from "./toolchain.js";

/**
 * The deterministic verification pipeline (PROJECT_SPEC.md §14.1, §14.3):
 *
 * ```
 * build → test → lint → typecheck → static-analysis → security-scan → diff-review → behavior-verification
 * ```
 *
 * Phase 1 implements the deterministic subset (build/test/lint/typecheck); the
 * remaining stages are model-based/advisory (§14.3) or Phase 2+ (static
 * analysis, security scan) and are out of scope here. A model never
 * overrides a deterministic failure — this pipeline's result IS the gate.
 */

export type StageName = "build" | "test" | "lint" | "typecheck";
export const STAGE_ORDER: StageName[] = ["build", "test", "lint", "typecheck"];

export interface StageResult {
  stage: StageName;
  ran: boolean; // false if no command was configured for this stage (skipped, not failed)
  command?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  passed: boolean;
  durationMs: number;
}

export interface PipelineOptions {
  cwd: string;
  evidenceDir: string;
  timeoutMs?: number;
  outputBudget?: number;
  /** Stop at the first failing stage (default true) — a red build makes running tests pointless. */
  stopOnFailure?: boolean;
}

export interface PipelineResult {
  stages: StageResult[];
  allGreen: boolean;
  /** The first failing stage, if any — the standing failure the repair loop targets (§14.5). */
  firstFailure?: StageResult;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_OUTPUT_BUDGET = 20_000;

function runStage(stage: StageName, command: string | undefined, opts: PipelineOptions): StageResult {
  if (!command) {
    return { stage, ran: false, exitCode: null, stdout: "", stderr: "", passed: true, durationMs: 0 };
  }

  const start = Date.now();
  const proc = spawnSync(command, {
    shell: true,
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 50_000_000
  });
  const durationMs = Date.now() - start;

  const budget = opts.outputBudget ?? DEFAULT_OUTPUT_BUDGET;
  const stdout = truncate(proc.stdout ?? "", { budget, kind: "test", evidenceDir: opts.evidenceDir, label: `${stage}-stdout` }).shown;
  const stderr = truncate(proc.stderr ?? "", { budget, kind: "test", evidenceDir: opts.evidenceDir, label: `${stage}-stderr` }).shown;

  const timedOut = proc.error && (proc.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const passed = !timedOut && proc.status === 0;

  return { stage, ran: true, command, exitCode: proc.status, stdout, stderr, passed, durationMs };
}

/** Run the deterministic gate in order, short-circuiting on the first failure by default. */
export function runPipeline(commands: ToolchainCommands, opts: PipelineOptions): PipelineResult {
  const stages: StageResult[] = [];
  let firstFailure: StageResult | undefined;
  const stopOnFailure = opts.stopOnFailure ?? true;

  for (const stage of STAGE_ORDER) {
    const command = commands[stage];
    const result = runStage(stage, command, opts);
    stages.push(result);
    if (!result.passed && !firstFailure) {
      firstFailure = result;
      if (stopOnFailure) break;
    }
  }

  return { stages, allGreen: !firstFailure, firstFailure };
}
