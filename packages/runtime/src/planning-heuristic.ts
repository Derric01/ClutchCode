/**
 * Planning heuristic (PROJECT_SPEC.md §6.7): a separate, cheap model call
 * only when the task warrants it. Skip explicit planning for
 * single-file/small-diff/low-step tasks; trigger it when multi-file,
 * ambiguous, or the capability profile shows low instruction fidelity (a
 * plan anchors a weak model). [C:Med] — thresholds need eval tuning.
 */

export interface PlanningHeuristicInput {
  taskDescription: string;
  /** A rough estimate of files likely touched, if known. */
  estimatedFileCount?: number;
  /** From the capability profile (§4.9) — true for models that ramble/lose the thread without an anchor. */
  lowInstructionFidelity?: boolean;
}

const AMBIGUITY_MARKERS = /\b(and also|across|multiple|refactor|architecture|several|throughout)\b/i;
const LONG_TASK_CHARS = 400;

export function shouldPlan(input: PlanningHeuristicInput): boolean {
  if (input.lowInstructionFidelity) return true;
  if ((input.estimatedFileCount ?? 1) > 1) return true;
  if (input.taskDescription.length > LONG_TASK_CHARS) return true;
  if (AMBIGUITY_MARKERS.test(input.taskDescription)) return true;
  return false;
}
