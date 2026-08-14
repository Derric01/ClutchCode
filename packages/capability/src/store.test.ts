import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capabilityProfilePath, listCapabilityProfiles, loadCapabilityProfile, saveCapabilityProfile } from "./store.js";
import type { CapabilityProfile } from "./types.js";

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

describe("capability profile persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-capability-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a profile through save/load", () => {
    const profile = sampleProfile();
    const p = saveCapabilityProfile(profile, dir);
    expect(fs.existsSync(p)).toBe(true);

    const loaded = loadCapabilityProfile(profile.modelId, dir);
    expect(loaded).toEqual(profile);
  });

  it("returns null for a model that was never probed", () => {
    expect(loadCapabilityProfile("never-probed-model", dir)).toBeNull();
  });

  it("flattens a model id with slashes into a safe filename", () => {
    const p = capabilityProfilePath("openrouter/qwen-2.5-coder", dir);
    expect(p).not.toContain("/qwen-2.5-coder");
    expect(path.dirname(p)).toBe(dir);
  });

  it("lists every saved profile sorted by model id", () => {
    saveCapabilityProfile(sampleProfile({ modelId: "zeta-model" }), dir);
    saveCapabilityProfile(sampleProfile({ modelId: "alpha-model" }), dir);

    const all = listCapabilityProfiles(dir);
    expect(all.map((p) => p.modelId)).toEqual(["alpha-model", "zeta-model"]);
  });

  it("returns an empty list when the models directory doesn't exist yet", () => {
    expect(listCapabilityProfiles(path.join(dir, "nonexistent"))).toEqual([]);
  });
});
