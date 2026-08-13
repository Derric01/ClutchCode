/**
 * Error taxonomy (PROJECT_SPEC.md §6.8) — different recovery per class.
 * Misclassifying an environment error as a task error makes the model
 * flail; this taxonomy exists to prevent that.
 *
 * | Class | Examples | Recovery |
 * | Model error | malformed edit/tool output, refusal, empty | Repair prompt; format downgrade; retry with budget |
 * | Tool error | invalid args, file not found | Structured error back to model; it corrects |
 * | Environment error | build tool missing, network down, OOM | Surface to human/doctor, NOT the model |
 * | Task error | tests reveal the change is wrong | Repair loop: analyze → new edit → re-verify |
 */

export type ErrorClass = "model-error" | "tool-error" | "environment-error" | "task-error" | "unknown";

const TOOL_ERROR_CODES = new Set([
  "not-found",
  "path-outside-workspace",
  "denylisted",
  "policy-denied",
  "needs-approval",
  "bad-window",
  "not-a-file",
  "would-exceed-cap",
  "no-such-process",
  "not-a-repo",
  "bad-regex",
  "git-error"
]);

const MODEL_ERROR_CODES = new Set(["edit-block-failed"]);

const ENVIRONMENT_ERROR_CODES = new Set(["spawn-error", "search-backend-unavailable", "timeout", "kill-failed", "exec-error"]);

/** Classify a tool-call failure (a `ToolResult.error.code` from packages/tools) into the §6.8 taxonomy. */
export function classifyToolError(errorCode: string): ErrorClass {
  if (MODEL_ERROR_CODES.has(errorCode)) return "model-error";
  if (TOOL_ERROR_CODES.has(errorCode)) return "tool-error";
  if (ENVIRONMENT_ERROR_CODES.has(errorCode)) return "environment-error";
  return "unknown";
}

/** Classify a provider-stream error delta (`{type:"error", retryable}` from packages/providers). */
export function classifyProviderError(retryable: boolean): ErrorClass {
  // A retryable failure (rate limit, 5xx, network blip) is the environment
  // acting up, not the model's fault; a non-retryable one (bad request,
  // content policy) is treated as a model-facing problem to repair-prompt around.
  return retryable ? "environment-error" : "model-error";
}

/** A verification-stage failure is always a task error by definition (§6.8) — the repair loop owns it. */
export function classifyVerificationFailure(): ErrorClass {
  return "task-error";
}
