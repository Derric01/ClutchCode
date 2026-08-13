/**
 * The capability matrix & profile (PROJECT_SPEC.md §4.1, §4.9) — "the
 * heart": the harness adapts its edit format, tool protocol, and context
 * budget to what a model can *actually* do, measured once via the probe
 * and persisted, rather than assumed from a static per-model table.
 */

export type ToolTransport = "native" | "json" | "emulation";

export interface CapabilityProfile {
  providerId: string;
  modelId: string;
  /** §4.9 check 1: fraction of trials producing an exactly-applicable SEARCH/REPLACE block. */
  diffAcc: number;
  /** §4.9 check 2: fraction of trials the model obeyed an explicit stop instruction instead of rambling/looping. */
  instructionFidelity: number;
  /** §4.9 check 3: how the model actually invokes tools when offered a schema. */
  toolTransport: ToolTransport;
  /** §4.9 check 4: fraction of trials producing schema-valid JSON on request. */
  structuredOutputReliability: number;
  /** §4.9 check 5: needle-in-haystack estimate of usable context, in characters (a rough proxy for tokens). */
  effectiveContext: number;
  /** §4.9 check 6: does the model stop instead of redundantly repeating an already-satisfied action? */
  loopCheckPassed: boolean;
  /** From the provider adapter's own declared capability, carried through for convenience. */
  supportsConstrainedDecode: boolean;
  probedAt: number;
  probeVersion: number;
}

/** Conservative defaults for a model that has never been probed (§4.9: "fall back to static defaults if probe fails"). */
export const UNPROBED_PROFILE: Omit<CapabilityProfile, "providerId" | "modelId"> = {
  diffAcc: 0.5,
  instructionFidelity: 0.5,
  toolTransport: "emulation",
  structuredOutputReliability: 0.5,
  effectiveContext: 8_000,
  loopCheckPassed: false,
  supportsConstrainedDecode: false,
  probedAt: 0,
  probeVersion: 0
};

export function unprobedProfile(providerId: string, modelId: string): CapabilityProfile {
  return { providerId, modelId, ...UNPROBED_PROFILE };
}
