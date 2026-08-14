/**
 * The persisted RunState and its state machine (PROJECT_SPEC.md §6.2).
 *
 * ```
 * States: CREATED → UNDERSTANDING → PLANNING → INSPECTING → ACTING → EDITING
 *         → VERIFYING → (REPAIRING → EDITING)* → AWAITING_APPROVAL → COMMITTING → DONE
 *         with edges to: PAUSED (steering), ESCALATED (human), FAILED, CANCELLED.
 * ```
 */

export type RunStatus =
  | "CREATED"
  | "UNDERSTANDING"
  | "PLANNING"
  | "INSPECTING"
  | "ACTING"
  | "EDITING"
  | "VERIFYING"
  | "REPAIRING"
  | "AWAITING_APPROVAL"
  | "COMMITTING"
  | "DONE"
  | "PAUSED"
  | "ESCALATED"
  | "FAILED"
  | "CANCELLED";

export const TERMINAL_STATES: ReadonlySet<RunStatus> = new Set(["DONE", "FAILED", "CANCELLED"]);

/**
 * The "happy path" edges plus, per §6.2, every non-terminal state can also
 * transition to PAUSED (steering/Ctrl-C), ESCALATED, or FAILED — those four
 * escape hatches are added programmatically below rather than repeated on
 * every row.
 */
const HAPPY_PATH_EDGES: Record<RunStatus, RunStatus[]> = {
  CREATED: ["UNDERSTANDING"],
  UNDERSTANDING: ["PLANNING", "INSPECTING"], // §6.7: planning is skippable for small/simple tasks
  PLANNING: ["INSPECTING"],
  INSPECTING: ["ACTING"],
  ACTING: ["ACTING", "EDITING", "VERIFYING"],
  EDITING: ["ACTING", "EDITING", "VERIFYING"],
  VERIFYING: ["REPAIRING", "AWAITING_APPROVAL", "DONE", "ESCALATED", "FAILED"],
  REPAIRING: ["EDITING"],
  AWAITING_APPROVAL: ["COMMITTING", "CANCELLED", "ESCALATED"],
  COMMITTING: ["DONE"],
  DONE: [],
  PAUSED: [], // resumes back into whatever state it was paused from (caller-tracked)
  ESCALATED: [],
  FAILED: [],
  CANCELLED: []
};

const ESCAPE_HATCHES: RunStatus[] = ["PAUSED", "ESCALATED", "FAILED", "CANCELLED"];

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  if (HAPPY_PATH_EDGES[from].includes(to)) return true;
  if (from !== "PAUSED" && ESCAPE_HATCHES.includes(to)) return true; // escape hatches apply to every non-terminal, non-paused state
  if (from === "PAUSED") return true; // resuming can re-enter any state the caller resumes into
  return false;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: RunStatus,
    public readonly to: RunStatus
  ) {
    super(`invalid RunState transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export interface Budgets {
  steps: number;
  wallclockMs: number;
  tokens: number;
  costUsd: number;
}

export interface BudgetConsumed {
  steps: number;
  wallclockMs: number;
  tokens: number;
  costUsd: number;
}

export interface ToolCallLogEntry {
  step: number;
  tool: string;
  args: unknown;
  ok: boolean;
  errorCode?: string;
  ts: number;
}

export interface VerificationResultSummary {
  step: number;
  allGreen: boolean;
  firstFailureStage?: string;
  cheatFlagCount: number;
  ts: number;
}

export interface RunState {
  runId: string;
  task: string;
  workflowId: string;
  provider: string;
  model: string;
  capabilityProfileId?: string;

  status: RunStatus;
  stepIndex: number;

  budgets: Budgets;
  consumed: BudgetConsumed;

  /**
   * Set when `capabilityProfileId` resolved to a persisted profile (§4.9):
   * the §4.5 context-budget allocation derived from it, for observability
   * (`agent inspect`). Shaped like @clutchcode/capability's `ContextBudget`,
   * duplicated by hand rather than imported so this file stays
   * dependency-free.
   */
  contextBudget?: {
    effectiveContext: number;
    systemAndTools: number;
    repoMapRetrieval: number;
    openFileWindows: number;
    conversationHistory: number;
    reservedOutput: number;
  };

  worktreePath?: string;
  baseCommit?: string;

  plan: string[];
  openWindows: string[];
  toolCallLog: ToolCallLogEntry[];
  verificationResults: VerificationResultSummary[];
  summaryCheckpoints: string[];

  loopDetectorState: unknown;
  repairIterations: number;

  lastError?: { class: string; detail: string };
  escalationReason?: string;

  createdAt: number;
  updatedAt: number;
}

export interface CreateRunStateOptions {
  runId: string;
  task: string;
  workflowId?: string;
  provider: string;
  model: string;
  capabilityProfileId?: string;
  budgets?: Partial<Budgets>;
}

const DEFAULT_BUDGETS: Budgets = {
  steps: 50, // §6.3
  wallclockMs: 20 * 60_000,
  tokens: 200_000,
  costUsd: 2.0
};

export function createRunState(opts: CreateRunStateOptions): RunState {
  const now = Date.now();
  return {
    runId: opts.runId,
    task: opts.task,
    workflowId: opts.workflowId ?? "default",
    provider: opts.provider,
    model: opts.model,
    capabilityProfileId: opts.capabilityProfileId,
    status: "CREATED",
    stepIndex: 0,
    budgets: { ...DEFAULT_BUDGETS, ...opts.budgets },
    consumed: { steps: 0, wallclockMs: 0, tokens: 0, costUsd: 0 },
    plan: [],
    openWindows: [],
    toolCallLog: [],
    verificationResults: [],
    summaryCheckpoints: [],
    loopDetectorState: undefined,
    repairIterations: 0,
    createdAt: now,
    updatedAt: now
  };
}

/** Mutates `state.status` after validating the edge; every transition is what makes `resume` possible (§6.2). */
export function transition(state: RunState, to: RunStatus): void {
  if (!canTransition(state.status, to)) {
    throw new InvalidTransitionError(state.status, to);
  }
  state.status = to;
  state.updatedAt = Date.now();
}
