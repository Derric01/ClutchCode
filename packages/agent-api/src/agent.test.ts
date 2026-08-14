import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCapabilityProfile, type CapabilityProfile } from "@clutchcode/capability";
import { Agent } from "./agent.js";
import { makeSampleRepo, makeTempDir, sseChunk, startScriptedServer, type ScriptedServer } from "./test-helpers.js";
import { initRepo } from "./scaffold.js";
import { markTrusted } from "./config.js";

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

describe("Agent + capability profiles (§4.2/§4.9)", () => {
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

  function sampleProfile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
    return {
      modelId: "probed-model",
      providerId: "fake",
      probedAt: "2026-08-14T00:00:00.000Z",
      probeDurationMs: 1,
      trials: 1,
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

  it("stamps capabilityProfileId when a persisted profile exists for the model", async () => {
    saveCapabilityProfile(sampleProfile(), modelsDir);
    const agent = new Agent(repoPath, stateDir);

    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "probed-model", yesMode: true, modelsDir });

    expect(state.capabilityProfileId).toBe("probed-model");
  }, 30_000);

  it("leaves capabilityProfileId unset when the model was never probed", async () => {
    const agent = new Agent(repoPath, stateDir);

    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "never-probed", yesMode: true, modelsDir });

    expect(state.capabilityProfileId).toBeUndefined();
  }, 30_000);
});

describe("Agent.resume (§6.2, §6.3, §18.2)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: ScriptedServer;

  // `providerKind: "fake"` pins to one fixed no-op turn (§4.7) — no good for
  // scripting a pause/resume across multiple turns. A local scripted
  // openai-compatible server drives the real provider adapter instead, the
  // same wire path `Agent.run`/`Agent.resume` use in production.
  const toolCallThenStop = [
    [
      sseChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "shell", arguments: JSON.stringify({ cmd: "echo hi" }) } }] } }]
      }),
      sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      "data: [DONE]\n\n"
    ],
    [sseChunk({ choices: [{ delta: { content: "Investigated, nothing to fix." }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
  ];

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    markTrusted(repoPath); // so the non-destructive `echo` is ALLOW'd outright instead of parking on an ASK approval
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server?.close();
  });

  it("continues a run past its step budget: pauses after 1 step, resumes after extending, reaches DONE", async () => {
    server = await startScriptedServer(toolCallThenStop);
    const agent = new Agent(repoPath, stateDir);

    const paused = await agent.run({
      task: "investigate",
      providerKind: "openai-compatible",
      model: "gpt-test",
      baseUrl: server.baseUrl,
      yesMode: true,
      budgets: { steps: 1 }
    });
    expect(paused.status).toBe("PAUSED");
    expect(paused.escalationReason).toMatch(/budget exceeded: steps/);
    expect(server.callCount()).toBe(1);

    const resumed = await agent.resume(paused.runId, { extendSteps: 5 });

    expect(resumed.status).toBe("DONE");
    expect(server.callCount()).toBe(2);
    // The resumed run reconnected to the same baseUrl without being asked again (§4.7, persisted on RunState).
    expect(resumed.baseUrl).toBe(server.baseUrl);
  }, 30_000);

  it("is a no-op that returns the state unchanged when the run isn't PAUSED", async () => {
    const agent = new Agent(repoPath, stateDir);
    const done = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true });
    expect(done.status).toBe("DONE");

    const result = await agent.resume(done.runId);

    expect(result.status).toBe("DONE");
    expect(result.runId).toBe(done.runId);
  }, 30_000);

  it("throws a clear error for an unknown run id", async () => {
    const agent = new Agent(repoPath, stateDir);
    await expect(agent.resume("does-not-exist")).rejects.toThrow(/no such run/);
  });
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
