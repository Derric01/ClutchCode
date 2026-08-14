import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCapabilityProfile, type CapabilityProfile } from "@clutchcode/capability";
import { Agent } from "./agent.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";
import { initRepo } from "./scaffold.js";

function sampleProfile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    modelId: "n/a",
    providerId: "fake",
    probedAt: "2026-08-14T00:00:00.000Z",
    probeDurationMs: 100,
    trials: 3,
    diffApplicationAccuracy: 0.9,
    instructionFidelity: 0.9,
    longPromptInstructionFidelity: "high",
    toolTransport: "native",
    structuredOutputScore: 0.9,
    structuredOutputReliability: "high",
    effectiveContext: 16000,
    loopCheckPassed: true,
    supportsParallelTools: true,
    constrainedDecodeAvailable: false,
    notes: [],
    ...overrides
  };
}

describe("Agent (agent-api boundary, wired end-to-end with a real worktree)", () => {
  let repoPath: string;
  let stateDir: string;
  let agent: Agent;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    agent = new Agent(repoPath, stateDir);
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("runs end-to-end in --yes mode using the fake dry-run provider and reaches DONE", async () => {
    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true });

    expect(state.status).toBe("DONE");
    expect(agent.status()!.runId).toBe(state.runId);
    expect(agent.listRuns().map((s) => s.runId)).toContain(state.runId);
  }, 30_000);

  it("stops at AWAITING_APPROVAL without --yes; diff/approve/inspect all work against the persisted run", async () => {
    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a" });
    expect(state.status).toBe("AWAITING_APPROVAL");

    // diff() reads the still-live worktree without throwing.
    expect(() => agent.diff(state.runId)).not.toThrow();

    const { state: inspected, events } = agent.inspect(state.runId);
    expect(inspected.runId).toBe(state.runId);
    expect(events.some((e) => e.type === "run.end")).toBe(true);

    const approved = agent.approve(state.runId, { squash: true, message: "approved" });
    expect(approved.status).toBe("DONE");
  }, 30_000);

  it("reject discards the run and marks it CANCELLED", async () => {
    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a" });
    expect(state.status).toBe("AWAITING_APPROVAL");

    const rejected = agent.reject(state.runId);
    expect(rejected.status).toBe("CANCELLED");
  }, 30_000);

  it("throws a clear error for an unknown run id", () => {
    expect(() => agent.diff("does-not-exist")).toThrow(/no worktree metadata/);
    expect(() => agent.inspect("does-not-exist")).toThrow(/no such run/);
  });

  it("status() is null with no runs yet", () => {
    expect(agent.status()).toBeNull();
  });
});

describe("Agent + capability profile (§4.9 wired into a live run)", () => {
  let repoPath: string;
  let stateDir: string;
  let modelsDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    modelsDir = makeTempDir("clutchcode-agentapi-models-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(modelsDir, { recursive: true, force: true });
  });

  it("picks up a persisted profile for the run's model and records the derived budget on RunState", async () => {
    saveCapabilityProfile(sampleProfile({ modelId: "n/a" }), modelsDir);
    const agent = new Agent(repoPath, stateDir, modelsDir);

    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true });

    expect(state.capabilityProfileId).toBe("n/a");
    expect(state.contextBudget?.effectiveContext).toBe(16000);
    expect(state.contextBudget?.reservedOutput).toBe(1600); // 10% of 16000
  }, 30_000);

  it("a model with no persisted profile runs exactly as before (no profile id, no budget)", async () => {
    const agent = new Agent(repoPath, stateDir, modelsDir); // modelsDir exists but is empty
    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true });

    expect(state.capabilityProfileId).toBeUndefined();
    expect(state.contextBudget).toBeUndefined();
  }, 30_000);
});

describe("initRepo", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = makeTempDir("clutchcode-init-test-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("scaffolds agent.toml and AGENTS.md", () => {
    const result = initRepo(repoPath);
    expect(result.configCreated).toBe(true);
    expect(result.agentsMdCreated).toBe(true);
    expect(fs.existsSync(`${repoPath}/agent.toml`)).toBe(true);
    expect(fs.existsSync(`${repoPath}/AGENTS.md`)).toBe(true);
  });

  it("never overwrites existing files", () => {
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(`${repoPath}/AGENTS.md`, "custom content\n", "utf8");
    const result = initRepo(repoPath);
    expect(result.agentsMdCreated).toBe(false);
    expect(fs.readFileSync(`${repoPath}/AGENTS.md`, "utf8")).toBe("custom content\n");
  });
});
