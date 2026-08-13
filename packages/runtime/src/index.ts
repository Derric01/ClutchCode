export {
  createRunState,
  transition,
  canTransition,
  InvalidTransitionError,
  TERMINAL_STATES
} from "./run-state.js";
export type {
  RunState,
  RunStatus,
  Budgets,
  BudgetConsumed,
  ToolCallLogEntry,
  VerificationResultSummary,
  CreateRunStateOptions
} from "./run-state.js";

export { RunStateStore } from "./state-store.js";

export { BudgetGuard } from "./budget.js";
export type { BudgetLimitKind, BudgetCheckResult } from "./budget.js";

export { LoopDetector, initLoopDetectorState } from "./loop-detector.js";
export type { LoopDetectorState, LoopWarning } from "./loop-detector.js";

export { classifyToolError, classifyProviderError, classifyVerificationFailure } from "./error-taxonomy.js";
export type { ErrorClass } from "./error-taxonomy.js";

export { shouldPlan } from "./planning-heuristic.js";
export type { PlanningHeuristicInput } from "./planning-heuristic.js";

export { buildSystemPrompt, buildInitialMessages, buildRepairMessage, buildCheatReviewMessage, toolsToSchemas } from "./message-builder.js";

export { AgentLoop } from "./agent-loop.js";
export type { AgentLoopDeps, AgentLoopOptions, RuntimeEvent } from "./agent-loop.js";

export { commitApprovedRun, rejectRun } from "./approve.js";
