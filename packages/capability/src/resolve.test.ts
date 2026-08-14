import { describe, expect, it } from "vitest";
import { resolveCapability } from "./resolve.js";
import type { CapabilityProfile } from "./types.js";
import type { CapabilityDefaults } from "@clutchcode/providers";

function sampleProfile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    modelId: "qwen2.5-coder:14b",
    providerId: "ollama",
    probedAt: "2026-08-14T00:00:00.000Z",
    probeDurationMs: 1234,
    trials: 3,
    diffApplicationAccuracy: 0.9,
    instructionFidelity: 0.8,
    longPromptInstructionFidelity: "high",
    toolTransport: "native",
    structuredOutputScore: 0.7,
    structuredOutputReliability: "medium",
    effectiveContext: 8000,
    loopCheckPassed: true,
    supportsParallelTools: false,
    constrainedDecodeAvailable: true,
    notes: [],
    ...overrides
  };
}

const defaults: CapabilityDefaults = {
  supportsNativeTools: true,
  supportsParallelTools: false,
  supportsConstrainedDecode: false,
  approxEffectiveContext: 32_000
};

describe("resolveCapability", () => {
  it("passes a measured profile's fields through unchanged, marked probed", () => {
    const profile = sampleProfile({ diffApplicationAccuracy: 0.42, constrainedDecodeAvailable: true, effectiveContext: 12_000 });
    expect(resolveCapability(profile, defaults)).toEqual({
      effectiveContext: 12_000,
      diffApplicationAccuracy: 0.42,
      constrainedDecodeAvailable: true,
      probed: true
    });
  });

  it("falls back to the provider's CapabilityDefaults when nothing was probed, marked unprobed", () => {
    const result = resolveCapability(null, defaults);
    expect(result.probed).toBe(false);
    expect(result.effectiveContext).toBe(defaults.approxEffectiveContext);
    expect(result.constrainedDecodeAvailable).toBe(defaults.supportsConstrainedDecode);
  });

  it("the unprobed diff-accuracy guess sits exactly at the plain search/replace threshold (§4.4) — no behavior change for unprobed models", () => {
    const result = resolveCapability(null, defaults);
    expect(result.diffApplicationAccuracy).toBe(0.75);
  });
});
