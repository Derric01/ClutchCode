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
