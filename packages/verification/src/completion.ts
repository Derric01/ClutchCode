import type { CheatFlag } from "./cheat-detection.js";

/**
 * The completion contract (PROJECT_SPEC.md §14.7):
 *
 * ```
 * A run is DONE-SUCCESS only if:
 *   deterministic gate is green (build+test+lint+typecheck as applicable)
 *   AND no cheating flags
 *   AND the human approved the diff
 * Otherwise: DONE-ESCALATED (with the standing reason) or FAILED.
 * Never "success on the model's word."
 * `agent run --yes` can drop the human-approval clause ONLY if the
 * deterministic gate + no-cheat conditions hold and the user opted in.
 * ```
 */

export type CompletionStatus =
  | { status: "DONE-SUCCESS" }
  | { status: "DONE-ESCALATED"; reason: string }
  | { status: "FAILED"; reason: string };

export interface CompletionInput {
  gateGreen: boolean;
  cheatFlags: CheatFlag[];
  humanApproved: boolean;
  /** `agent run --yes`: non-interactive completion, opted in by the user. */
  yesMode: boolean;
  standingFailureReason?: string;
}

export function evaluateCompletion(input: CompletionInput): CompletionStatus {
  if (!input.gateGreen) {
    return { status: "FAILED", reason: input.standingFailureReason ?? "deterministic verification gate is not green" };
  }

  if (input.cheatFlags.length > 0) {
    const summary = input.cheatFlags.map((f) => `${f.rule} in ${f.file}`).join("; ");
    return { status: "DONE-ESCALATED", reason: `cheat detection flagged ${input.cheatFlags.length} issue(s): ${summary}` };
  }

  if (input.humanApproved) return { status: "DONE-SUCCESS" };
  if (input.yesMode) return { status: "DONE-SUCCESS" };

  return { status: "DONE-ESCALATED", reason: "awaiting human approval of the diff" };
}
