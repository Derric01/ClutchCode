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

export type FailureClass = "compile-error" | "test-assertion" | "test-error-env" | "command-not-found" | "lint" | "typecheck" | "unknown";

export const MAX_REPAIR_ITERS = 3;

const ENV_ERROR_RE =
  /econnrefused|enotfound|getaddrinfo|network is unreachable|no space left on device|permission denied|dial tcp|could not connect/i;
const COMPILE_ERROR_RE =
  /syntaxerror|cannot find module|unexpected token|referenceerror.*is not defined|importerror|modulenotfounderror|error ts\d{4}|compilation failed/i;
const TEST_ASSERTION_RE = /assertionerror|expect\(.*\)\.(to|not)|assert(_equal|equal)?\(|failed:.*expected|assertionfailederror/i;
const COMMAND_NOT_FOUND_RE = /: not found\b|: command not found|is not recognized as an internal or external command/i;
// A bare "no such file or directory" is ambiguous on its own: a shell's own
// exec-failure message uses that exact phrase for a genuinely missing
// *command* (e.g. bash's `execvp: eslint: No such file or directory`), but
// so does every Node.js ENOENT for an ordinary missing *file* — a test
// fixture, a generated asset — that has nothing to do with a missing
// binary and is exactly the kind of real, fixable bug a code edit should
// address, not something to hand back as "stop calling tools, escalate."
// Node always labels its own ENOENT errors explicitly ("ENOENT: no such
// file or directory, open '...'"); a shell's exec-failure message never
// does. So: trust the phrase only when the surrounding output *isn't*
// Node's own ENOENT wording.
const BARE_NO_SUCH_FILE_RE = /\bno such file or directory\b/i;
const NODE_ENOENT_RE = /\benoent\b/i;

/**
 * Classify a failed verification stage into the §6.8 error taxonomy so the
 * runtime routes it correctly: a task error re-enters the repair loop, an
 * environment error surfaces to the human instead of being handed back to
 * the model ("misclassifying an environment error as a task error makes
 * the model flail").
 *
 * `command-not-found` is checked first, ahead of every stage-specific
 * branch — including `lint`/`typecheck`, which otherwise always trust
 * their own stage name as the classification. Without this, a missing
 * `eslint`/`tsc` binary would get reported as "there's a lint issue" /
 * "there's a typecheck issue" and sent to the model to "fix," when the
 * actual problem is a wrong or stale cached command (§10.3's project
 * memory) that no code edit can repair — this is exactly the case
 * `@clutchcode/memory`'s `markToolchainFactStale` exists to self-heal
 * from a run's real verification result, not a guess.
 */
export function classifyFailure(result: StageResult): FailureClass {
  const output = `${result.stdout}\n${result.stderr}`;

  // Exit code 127 is the POSIX-standard "command not found" signal from a
  // shell (`runStage` always spawns via `shell: true`, i.e. through a real
  // shell, so this is a reliable mechanical check); the text patterns are
  // a fallback for shells/platforms that report it differently.
  const isCommandNotFound =
    result.exitCode === 127 || COMMAND_NOT_FOUND_RE.test(output) || (BARE_NO_SUCH_FILE_RE.test(output) && !NODE_ENOENT_RE.test(output));
  if (isCommandNotFound) return "command-not-found";

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
