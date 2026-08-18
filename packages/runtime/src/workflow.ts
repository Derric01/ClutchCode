/**
 * Built-in workflows (PROJECT_SPEC.md §8.2).
 *
 * §8.1 recommends two authoring layers: built-ins as a typed TS DSL
 * (code-as-config, compile-time validated) and a JSON-Schema-validated
 * declarative form on top for user customization of the linear pipeline.
 * This module ships only the first layer — the three named built-ins,
 * implemented as concrete branches in `AgentLoop` gated on
 * `RunState.workflowId`, not a generic stage-pipeline interpreter. The
 * declarative layer, and the dedicated `agent workflow` list/select/
 * validate CLI command (§18.2 marks it Phase 2), are both still deferred;
 * today a workflow is selected by id via `agent run --workflow <id>` and
 * nothing more.
 */

export type BuiltinWorkflowId = "default" | "quickfix" | "review-only";

export const BUILTIN_WORKFLOW_IDS: readonly BuiltinWorkflowId[] = ["default", "quickfix", "review-only"];

export interface WorkflowDescriptor {
  id: BuiltinWorkflowId;
  name: string;
  /** Human-readable stage list, matching §8.2's notation. */
  stages: string;
  description: string;
}

export const BUILTIN_WORKFLOWS: Readonly<Record<BuiltinWorkflowId, WorkflowDescriptor>> = {
  default: {
    id: "default",
    name: "Default",
    stages: "plan(opt) → implement → verify → approve → commit",
    description: "Planning runs when the heuristic (§6.7) warrants it; otherwise unchanged from the baseline act→verify→approve loop."
  },
  quickfix: {
    id: "quickfix",
    name: "Quick fix",
    stages: "implement → verify → approve → commit",
    description: "Skips the planning stage unconditionally, even when the heuristic would otherwise trigger it — for small, well-scoped tasks where an upfront plan only adds latency."
  },
  "review-only": {
    id: "review-only",
    name: "Review only",
    stages: "inspect → review → report",
    description:
      "Read-only: write_file/edit_file are withheld from the model's tool set, so nothing in this workflow can touch the working tree. Finishes with the model's final reply captured as a report — no verify/approve/commit stage exists. Safe to run on a repo that isn't yet marked trusted (§12.4)."
  }
};

export function isBuiltinWorkflowId(id: string): id is BuiltinWorkflowId {
  return (BUILTIN_WORKFLOW_IDS as readonly string[]).includes(id);
}

/**
 * The actual, minimal thing `AgentLoop` needs from *any* workflow — built-in
 * or user-declarative (§8.1) — to drive its existing control flow. Both
 * `resolveBuiltinWorkflowPlan` below and `workflow-declaration.ts`'s
 * `resolveWorkflowPlan` produce this same shape, so `AgentLoop` never needs
 * to know which kind of workflow it's running.
 */
export interface WorkflowPlan {
  /** "auto": the §6.7 heuristic decides (built-in `default`). "always": force planning unconditionally — only reachable via a custom declarative workflow today, none of the three built-ins do this. "never": force-skip planning unconditionally (built-in `quickfix`). */
  planMode: "auto" | "always" | "never";
  /** §8.2 `review-only`-style: write_file/edit_file withheld, run finishes with no verify/approve/commit. */
  readonly: boolean;
}

export function resolveBuiltinWorkflowPlan(id: BuiltinWorkflowId): WorkflowPlan {
  switch (id) {
    case "default":
      return { planMode: "auto", readonly: false };
    case "quickfix":
      return { planMode: "never", readonly: false };
    case "review-only":
      return { planMode: "never", readonly: true };
  }
}
