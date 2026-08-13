import type { StageResult } from "./pipeline.js";

/**
 * Failure classification & repair loop constants (PROJECT_SPEC.md §14.5,
 * §6.8). The repair loop itself (model call → edit → re-verify) lives in
 * the runtime package, which needs the model; this module supplies the
 * deterministic classification step and its caps.
 *
 * ```
 * classify(failure): compile-error | test-assertion | test-error(env) | lint | typecheck | flaky?
 * repair_loop: hard cap MAX_REPAIR_ITERS (default 3) → escalate
 * flaky detection: a test that passes on rerun without a code change is
 *   flagged, not "fixed"
 * ```
 */

export type FailureClass = "compile-error" | "test-assertion" | "test-error-env" | "lint" | "typecheck" | "unknown";

export const MAX_REPAIR_ITERS = 3;

const ENV_ERROR_RE =
  /econnrefused|enotfound|getaddrinfo|network is unreachable|no space left on device|permission denied|dial tcp|could not connect/i;
const COMPILE_ERROR_RE =
  /syntaxerror|cannot find module|unexpected token|referenceerror.*is not defined|importerror|modulenotfounderror|error ts\d{4}|compilation failed/i;
const TEST_ASSERTION_RE = /assertionerror|expect\(.*\)\.(to|not)|assert(_equal|equal)?\(|failed:.*expected|assertionfailederror/i;

/**
 * Classify a failed verification stage into the §6.8 error taxonomy so the
 * runtime routes it correctly: a task error re-enters the repair loop, an
 * environment error surfaces to the human instead of being handed back to
 * the model ("misclassifying an environment error as a task error makes
 * the model flail").
 */
export function classifyFailure(result: StageResult): FailureClass {
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.stage === "lint") return "lint";
  if (result.stage === "typecheck") return "typecheck";

  if (result.stage === "build") {
    if (ENV_ERROR_RE.test(output)) return "test-error-env";
    return "compile-error";
  }

  // stage === "test"
  if (ENV_ERROR_RE.test(output)) return "test-error-env";
  if (COMPILE_ERROR_RE.test(output)) return "compile-error";
  if (TEST_ASSERTION_RE.test(output)) return "test-assertion";
  return "unknown";
}

/** §14.5: "a test that passes on rerun without a code change is flagged, not 'fixed'." */
export function isFlaky(firstRunPassed: boolean, rerunPassed: boolean, codeChangedBetweenRuns: boolean): boolean {
  return !codeChangedBetweenRuns && !firstRunPassed && rerunPassed;
}

export interface RepairLoopState {
  iterations: number;
  standingFailure?: StageResult;
}

export function shouldEscalate(state: RepairLoopState): boolean {
  return state.iterations >= MAX_REPAIR_ITERS;
}
