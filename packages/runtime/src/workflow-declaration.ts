import fs from "node:fs";
// Named import, not default — ajv's single `.d.ts` (no separate `.d.cts`)
// makes the default-export interop path unreliable under `NodeNext`
// module resolution (a known ajv/TS incompatibility); the named `Ajv`
// class export sidesteps it entirely.
import { Ajv, type ValidateFunction } from "ajv";

import { BUILTIN_WORKFLOW_IDS, isBuiltinWorkflowId, type WorkflowPlan } from "./workflow.js";

/**
 * §8.1's second authoring layer: "users customize the *linear pipeline* via
 * a JSON-Schema-validated declarative form (a small, deliberately
 * non-Turing-complete graph: ordered stages + per-stage enable/skip/
 * parameters, no arbitrary loops/conditionals)."
 *
 * This is real JSON-Schema validation (via `ajv`, not a hand-rolled
 * structural check dressed up as one) plus a second, semantic pass this
 * codebase's tests exercise directly: a `WorkflowDeclaration` only
 * resolves to a `WorkflowPlan` `AgentLoop` can actually execute if it
 * matches one of the two shapes that engine understands today — the "full"
 * pipeline (an `implement` stage, optionally gated by a `plan` stage, with
 * edits allowed) or the "readonly" pipeline (a single `implement` stage
 * with `params.readonly: true`, mirroring built-in `review-only`). Anything
 * else is rejected with a specific error rather than silently
 * misinterpreted — this is deliberately *not* a general stage-pipeline
 * interpreter (§8.1's "no arbitrary control flow"); it's real, schema-
 * validated authoring on top of the same fixed state space the three
 * built-ins already cover, expressible by id today only.
 */

export type BuiltinStageKind = "plan" | "implement" | "verify" | "approve" | "commit";

export interface WorkflowStageDeclaration {
  id: string;
  uses: BuiltinStageKind;
  when?: "always" | "on_failure";
  params?: Record<string, unknown>;
}

export interface WorkflowDeclaration {
  apiVersion: "clutchcode/v1";
  id: string;
  name: string;
  stages: WorkflowStageDeclaration[];
}

/**
 * Hand-written, deliberately narrow — this validates exactly the shape
 * above, not a general-purpose meta-schema. `additionalProperties: false`
 * throughout so a typo (`"uses": "implment"`) or an unsupported field is a
 * validation error, not a silently-ignored no-op.
 */
export const WORKFLOW_DECLARATION_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://clutchcode.dev/schema/workflow-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["apiVersion", "id", "name", "stages"],
  properties: {
    apiVersion: { const: "clutchcode/v1" },
    id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9-]*$" },
    name: { type: "string", minLength: 1 },
    stages: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "uses"],
        properties: {
          id: { type: "string", minLength: 1 },
          uses: { enum: ["plan", "implement", "verify", "approve", "commit"] },
          when: { enum: ["always", "on_failure"] },
          params: { type: "object" }
        }
      }
    }
  }
} as const;

let compiled: ValidateFunction | undefined;
function getValidator(): ValidateFunction {
  compiled ??= new Ajv({ allErrors: true, strict: true }).compile(WORKFLOW_DECLARATION_SCHEMA);
  return compiled;
}

/**
 * Structural (JSON-Schema) + semantic validation, in that order. Throws a
 * single `Error` describing every problem found — never returns a partial
 * or best-effort declaration, matching this codebase's convention of
 * failing loudly at a config boundary (e.g. `Agent.run`'s "unknown
 * workflow"/"not a git repository" errors) rather than a `Result` type.
 */
export function validateWorkflowDeclaration(raw: unknown): WorkflowDeclaration {
  const validate = getValidator();
  if (!validate(raw)) {
    const detail = (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`).join("; ");
    throw new Error(`invalid workflow declaration (§8.1 JSON-Schema): ${detail}`);
  }
  const decl = raw as WorkflowDeclaration;

  if (isBuiltinWorkflowId(decl.id)) {
    throw new Error(`workflow id "${decl.id}" collides with a built-in workflow id (${BUILTIN_WORKFLOW_IDS.join(", ")}) — pick a different id`);
  }

  const counts = new Map<BuiltinStageKind, number>();
  for (const stage of decl.stages) counts.set(stage.uses, (counts.get(stage.uses) ?? 0) + 1);
  for (const [uses, count] of counts) {
    if (count > 1) {
      throw new Error(
        `workflow "${decl.id}": stage kind "${uses}" appears ${count} times — each built-in stage kind may appear at most once (§8.1: this is a small, non-Turing-complete graph, not a general pipeline interpreter)`
      );
    }
  }

  const implementStage = decl.stages.find((s) => s.uses === "implement");
  if (!implementStage) {
    throw new Error(`workflow "${decl.id}": must include an "implement" stage — there's nothing for the run to do otherwise`);
  }

  const readonly = implementStage.params?.["readonly"] === true;
  if (readonly) {
    if (decl.stages.length !== 1) {
      throw new Error(
        `workflow "${decl.id}": a read-only "implement" stage (params.readonly: true) must be the only stage — verify/approve/commit have nothing to check without edits (§8.2 review-only shape)`
      );
    }
  } else if (!counts.has("verify")) {
    throw new Error(
      `workflow "${decl.id}": a non-readonly "implement" stage needs a "verify" stage too — AgentLoop has no path that edits without ever verifying (unless implement is readonly)`
    );
  }

  return decl;
}

/** Turns a validated declaration into the same shape `resolveBuiltinWorkflowPlan` produces, so `AgentLoop` never needs to know which kind of workflow it's running. */
export function resolveWorkflowPlan(decl: WorkflowDeclaration): WorkflowPlan {
  const implementStage = decl.stages.find((s) => s.uses === "implement")!;
  if (implementStage.params?.["readonly"] === true) return { planMode: "never", readonly: true };

  const planStage = decl.stages.find((s) => s.uses === "plan");
  if (!planStage) return { planMode: "never", readonly: false };
  return { planMode: planStage.params?.["mode"] === "always" ? "always" : "auto", readonly: false };
}

/** Reads, parses, and validates a workflow declaration file. Throws a clear error on any I/O, JSON, schema, or semantic failure — never a partial result. */
export function loadWorkflowDeclaration(filePath: string): WorkflowDeclaration {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    throw new Error(`failed to read/parse workflow file "${filePath}": ${e instanceof Error ? e.message : String(e)}`);
  }
  return validateWorkflowDeclaration(raw);
}
