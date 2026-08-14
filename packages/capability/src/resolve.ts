import type { CapabilityDefaults } from "@clutchcode/providers";
import type { CapabilityProfile } from "./types.js";

/**
 * The adaptation layer's actual input (PROJECT_SPEC.md §4.2): the narrow
 * slice of a `CapabilityProfile` that `computeContextBudget` (§4.5) and
 * `selectEditFormat` (§4.4) need, resolved from *either* a persisted
 * probe (§4.9) *or*, per ADR-015 ("fall back to static defaults if probe
 * fails"), a provider's own best-effort `CapabilityDefaults` (§4.7) when a
 * model has never been probed.
 */
export interface EffectiveCapability {
  effectiveContext: number;
  diffApplicationAccuracy: number;
  constrainedDecodeAvailable: boolean;
  /** False when this came from `CapabilityDefaults` guesswork, not a measured probe (§4.9). */
  probed: boolean;
}

/**
 * `0.75` is the exact `select_edit_format` (§4.4) threshold for plain,
 * non-grammar-enforced SEARCH/REPLACE — i.e. *today's* de-facto behavior
 * (always SEARCH/REPLACE, no whole-file fallback). Picking it as the
 * unprobed default means wiring the adaptation layer in does not change
 * edit-format behavior for anyone who hasn't run `clutchcode models probe`
 * yet; only the (new, strictly additive) context-budget safety net applies.
 */
const UNPROBED_DIFF_ACCURACY_GUESS = 0.75;

/**
 * Resolve the adaptation layer's inputs for one run: a measured
 * `CapabilityProfile` when one has been probed and persisted (§4.9), or a
 * conservative fallback built from the provider's own `capabilityDefaults`
 * (§4.7) otherwise. Pure — no I/O, no probing (that's `runCapabilityProbe`).
 */
export function resolveCapability(profile: CapabilityProfile | null, defaults: CapabilityDefaults): EffectiveCapability {
  if (profile) {
    return {
      effectiveContext: profile.effectiveContext,
      diffApplicationAccuracy: profile.diffApplicationAccuracy,
      constrainedDecodeAvailable: profile.constrainedDecodeAvailable,
      probed: true
    };
  }
  return {
    effectiveContext: defaults.approxEffectiveContext,
    diffApplicationAccuracy: UNPROBED_DIFF_ACCURACY_GUESS,
    constrainedDecodeAvailable: defaults.supportsConstrainedDecode,
    probed: false
  };
}
