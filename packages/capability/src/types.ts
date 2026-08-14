/**
 * Capability profile (PROJECT_SPEC.md §4.1) — the persisted result of the
 * capability probe (§4.9). One profile per model id; the adaptation layer
 * (§4.2) reads it to pick edit format (§4.4), tool transport (§4.8), and
 * context budget (§4.5) instead of assuming a model can do more than it
 * actually can.
 *
 * Each field is either **probed** (measured by `runCapabilityProbe`, §4.9)
 * or **configured** (known ahead of time from the provider adapter, §4.7) —
 * the spec draws this line explicitly ("Each dimension is probed or
 * configured"), and the two are kept distinct below.
 */

export type ToolTransport = "native" | "json-mode-only" | "none";
export type ReliabilityTier = "high" | "medium" | "low";

export interface CapabilityProfile {
  /** The model id as passed to the provider (§18.2 `--model`). */
  modelId: string;
  /** Which provider adapter this profile was probed against (§4.7). */
  providerId: string;
  /** ISO-8601 timestamp of the probe run. */
  probedAt: string;
  /** Total wall time the probe took, ms — a first-class §4.1 dimension ("latency"). */
  probeDurationMs: number;
  /** How many trials each scored check ran (§4.9). */
  trials: number;

  // --- probed (§4.9 checks 1-6) ---

  /** Check 1 — valid search/replace emission, §4.1 "diff-application accuracy" (0..1). */
  diffApplicationAccuracy: number;
  /** Check 2 raw score (0..1) — stop-condition obedience. */
  instructionFidelity: number;
  /** Check 2 bucketed — §4.1 "long-prompt instruction fidelity". */
  longPromptInstructionFidelity: ReliabilityTier;
  /** Check 3 — native tool call vs JSON-in-text vs neither, §4.1 "native tool/function calling". */
  toolTransport: ToolTransport;
  /** Check 4 raw score (0..1) — JSON structured-output reliability. */
  structuredOutputScore: number;
  /** Check 4 bucketed — §4.1 "structured-output reliability". */
  structuredOutputReliability: ReliabilityTier;
  /** Check 5 — needle-in-haystack estimate of usable context, §4.1 "advertised vs effective context". */
  effectiveContext: number;
  /** Check 6 — did the model stop instead of repeating an already-finished action? */
  loopCheckPassed: boolean;

  // --- configured (known from the provider adapter, not probed) ---

  supportsParallelTools: boolean;
  constrainedDecodeAvailable: boolean;

  /** Free-text notes surfaced to the user (§4.9 output), e.g. why a check degraded. */
  notes: string[];
}
