import type { RunStatus } from "@clutchcode/agent-api";

/**
 * Exit codes (PROJECT_SPEC.md §18.4) — documented and stable for scripting:
 *
 * | Code | Meaning |
 * | 0 | success (contract met) |
 * | 1 | failed verification |
 * | 2 | escalated / needs-human |
 * | 3 | budget/cost limit hit |
 * | 4 | config/env error |
 * | 130 | interrupted |
 */
export const EXIT = {
  SUCCESS: 0,
  FAILED: 1,
  ESCALATED: 2,
  BUDGET: 3,
  CONFIG_ERROR: 4,
  INTERRUPTED: 130
} as const;

export function exitCodeForRunStatus(status: RunStatus): number {
  switch (status) {
    case "DONE":
      return EXIT.SUCCESS;
    case "FAILED":
      return EXIT.FAILED;
    case "ESCALATED":
    case "AWAITING_APPROVAL":
      return EXIT.ESCALATED;
    case "PAUSED":
      return EXIT.BUDGET;
    case "CANCELLED":
      return EXIT.INTERRUPTED;
    default:
      // Any other in-flight status reaching the CLI's exit point is itself
      // unexpected plumbing state, not a documented outcome.
      return EXIT.ESCALATED;
  }
}
