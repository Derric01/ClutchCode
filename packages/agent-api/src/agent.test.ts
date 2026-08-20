import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectBwrapOnPath } from "@clutchcode/sandbox";
import { saveCapabilityProfile, type CapabilityProfile } from "@clutchcode/capability";
import { Agent } from "./agent.js";
import { addBareOrigin, makeMonorepo, makeSampleRepo, makeTempDir, sseChunk, startScriptedServer, type ScriptedServer } from "./test-helpers.js";
import { initRepo } from "./scaffold.js";
import { markTrusted, saveConfig, loadConfig } from "./config.js";
import { correctMemoryFact, forgetMemoryFact, listMemory, showMemoryFact } from "./memory.js";

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

describe("Agent + project memory (§10.3) — real toolchain-memory persistence and self-healing", () => {
  let repoPath: string;
  let stateDir: string;
  let memoryDir: string;
  let server: ScriptedServer;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    memoryDir = makeTempDir("clutchcode-agentapi-memory-");
    markTrusted(repoPath);
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    await server?.close();
  });

  it("a real run persists toolchain memory with provenance and timestamps", async () => {
    const agent = new Agent(repoPath, stateDir);
    await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true, memoryDir });

    const memory = listMemory(repoPath, { configDir: memoryDir });
    expect(memory).toBeDefined();
    expect(memory!.facts.test?.value).toBe("npm run test");
    expect(memory!.facts.test?.source).toBeTruthy();
    expect(new Date(memory!.facts.test!.derivedAt).getTime()).toBeGreaterThan(0);
  }, 30_000);

  it("a second run reuses the cached toolchain memory instead of re-deriving (derivedAt unchanged)", async () => {
    const agent = new Agent(repoPath, stateDir);
    await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true, memoryDir });
    const firstDerivedAt = showMemoryFact(repoPath, "test", { configDir: memoryDir })?.derivedAt;

    await agent.run({ task: "investigate again", providerKind: "fake", model: "n/a", yesMode: true, memoryDir });
    const secondDerivedAt = showMemoryFact(repoPath, "test", { configDir: memoryDir })?.derivedAt;

    expect(secondDerivedAt).toBe(firstDerivedAt);
  }, 30_000);

  it("a corrected fact via agent-api's correctMemoryFact is what the next real run actually uses", async () => {
    correctMemoryFact(repoPath, "test", "echo corrected-command-ran", { configDir: memoryDir });

    const agent = new Agent(repoPath, stateDir);
    server = await startScriptedServer([
      [
        sseChunk({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "shell", arguments: JSON.stringify({ cmd: "echo hi" }) } }] } }]
        }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    const state = await agent.run({ task: "investigate", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl, yesMode: true, memoryDir });

    expect(state.status).toBe("DONE"); // "echo corrected-command-ran" exits 0, unlike the real `npm run test` which needs no network but would differ from this override
    expect(state.verificationResults.at(-1)?.allGreen).toBe(true);
  }, 30_000);

  it("verification is the truth oracle (§10.3 point 3): a command-not-found failure marks the cached fact stale end to end, through a real run", async () => {
    // Force a broken cached command directly, bypassing detection — the
    // real thing under test is the *loop's reaction* when it turns out to
    // be wrong, not detection itself (already covered elsewhere).
    correctMemoryFact(repoPath, "test", "this-binary-does-not-exist-anywhere", { configDir: memoryDir });
    expect(showMemoryFact(repoPath, "test", { configDir: memoryDir })?.stale).toBeUndefined();

    // Same broken command fails identically every turn, so the loop
    // detector's "almost-done-stall" check (3 consecutive verify
    // failures, independent of and checked before the repair-iteration
    // cap) is what actually ends this run — matters for the assertions
    // below, and it still only takes 3 turns, well within what's scripted.
    const stopTurn = [sseChunk({ choices: [{ delta: { content: "investigated, nothing to fix" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"];
    server = await startScriptedServer([stopTurn, stopTurn, stopTurn, stopTurn]);

    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "investigate", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl, yesMode: true, memoryDir });

    expect(state.status).toBe("ESCALATED");
    expect(state.escalationReason).toContain("almost-done-stall");

    const fact = showMemoryFact(repoPath, "test", { configDir: memoryDir });
    expect(fact?.stale).toBe(true);
    expect(fact?.staleReason).toContain("command not found");
  }, 30_000);

  it("listMemory/showMemoryFact/forgetMemoryFact are wired through the real Agent API boundary", () => {
    correctMemoryFact(repoPath, "build", "make", { configDir: memoryDir });
    expect(listMemory(repoPath, { configDir: memoryDir })?.facts.build?.value).toBe("make");
    expect(showMemoryFact(repoPath, "build", { configDir: memoryDir })?.value).toBe("make");
    expect(forgetMemoryFact(repoPath, "build", { configDir: memoryDir })).toBe(true);
    expect(showMemoryFact(repoPath, "build", { configDir: memoryDir })).toBeUndefined();
  });
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

describe("AGENTS.md override trust boundary (§10.3 point 4 — real gap caught in round 3 of security review)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: ScriptedServer;

  beforeEach(() => {
    // Root test genuinely fails (no AGENTS.md at the base commit) — the
    // scenario needs a real, deterministic failure a fake override could
    // plausibly be used to mask.
    repoPath = makeMonorepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    markTrusted(repoPath); // so the write_file tool call is ALLOW'd outright
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server?.close();
  });

  it("an AGENTS.md the model writes mid-run — surviving into a resumed continuation — does NOT override which test command verification actually runs (previously: the model could self-declare `test: echo ok` and have the deterministic gate rubber-stamp a genuinely broken build)", async () => {
    // Two tool calls in the SAME model turn (one step, per the budget
    // guard's per-turn accounting): the AGENTS.md override itself, plus an
    // unrelated, no-op-for-the-test-command edit to package.json (a fresh
    // `version` field) — needed to invalidate `computeManifestHash`'s
    // cached record so `getOrDetectToolchain` actually re-derives (and
    // re-applies AGENTS.md overrides) on the *next* `buildRunDeps` call
    // instead of serving the pre-attack cached commands unchanged. This
    // mirrors the exact two-file mechanism the security review flagged —
    // confirmed necessary by first writing a version of this test with
    // only the AGENTS.md write, which passed even against the unfixed
    // code because the untouched manifest hash still cache-hit.
    const writeTurn = [
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({ path: "AGENTS.md", body: "test: `echo pwned-cheat-passed`\n" })
                  }
                },
                {
                  index: 1,
                  id: "call_2",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({
                      path: "package.json",
                      body: JSON.stringify({ name: "root", version: "0.0.2", scripts: { test: "node -e \"process.exit(1)\"" } }, null, 2)
                    })
                  }
                }
              ]
            }
          }
        ]
      }),
      sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      "data: [DONE]\n\n"
    ];
    // Same "no fix attempted, verification keeps failing" shape as the
    // "verification is the truth oracle" stall test above: a repeated,
    // no-tool-call "done" turn triggers the 3-consecutive-verify-failure
    // "almost-done-stall" escalation, ending the run cleanly instead of
    // exhausting the scripted server's turns.
    const stopTurn = [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"];
    server = await startScriptedServer([writeTurn, stopTurn, stopTurn, stopTurn]);
    const agent = new Agent(repoPath, stateDir);

    const paused = await agent.run({
      task: "make the tests pass",
      providerKind: "openai-compatible",
      model: "gpt-test",
      baseUrl: server.baseUrl,
      yesMode: true,
      budgets: { steps: 1 }
    });
    expect(paused.status).toBe("PAUSED");

    const resumed = await agent.resume(paused.runId, { extendSteps: 5 });
    expect(resumed.status).toBe("ESCALATED");
    // Real behavioral proof: the root test command genuinely fails
    // (`makeMonorepo`'s root `process.exit(1)`) — if the model's injected
    // AGENTS.md override had taken effect, verification would have run
    // `echo pwned-cheat-passed` instead and reported allGreen: true.
    expect(resumed.verificationResults.at(-1)?.allGreen).toBe(false);
  }, 30_000);
});

describe("Agent.checkpoints / Agent.rollback (§13.3)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: ScriptedServer;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    markTrusted(repoPath);
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server?.close();
  });

  it("checkpoints() lists the checkpoint verification created, and rollback() restores it", async () => {
    server = await startScriptedServer([
      [
        sseChunk({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "feature.txt", body: "v1\n" }) } }] } }]
        }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "add a feature", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl });
    expect(state.status).toBe("AWAITING_APPROVAL"); // no --yes, worktree still around to inspect

    const checkpoints = agent.checkpoints(state.runId);
    expect(checkpoints.length).toBeGreaterThan(0);

    // Round-trips through an abbreviated sha, matching real `git log --oneline` width.
    const rolledBack = agent.rollback(state.runId, checkpoints[0]!.sha.slice(0, 7));
    expect(rolledBack.runId).toBe(state.runId);
  }, 30_000);

  it("rollback() rejects a sha that isn't one of the run's checkpoints", async () => {
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "investigate", providerKind: "fake", model: "n/a" });
    expect(() => agent.rollback(state.runId, "deadbeef")).toThrow(/no checkpoint matching/);
  }, 30_000);
});

describe("Agent.diffFiles (§18.5 native two-sided diff view data layer)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: ScriptedServer;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    markTrusted(repoPath);
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server?.close();
  });

  it("reports per-file before/after content through the real Agent API boundary", async () => {
    server = await startScriptedServer([
      [
        sseChunk({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "feature.txt", body: "v1\n" }) } }] } }]
        }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "add a feature", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl });
    expect(state.status).toBe("AWAITING_APPROVAL"); // no --yes, worktree still around to inspect

    const files = agent.diffFiles(state.runId);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("feature.txt");
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.before).toBeUndefined();
    expect(files[0]!.after).toBe("v1\n");
  }, 30_000);

  it("throws a clear error for an unknown run id, same as diff()", () => {
    const agent = new Agent(repoPath, stateDir);
    expect(() => agent.diffFiles("does-not-exist")).toThrow(/no worktree metadata/);
  });
});

describe("Agent.pr (§13.5)", () => {
  let repoPath: string;
  let stateDir: string;
  let bareRemote: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    bareRemote = addBareOrigin(repoPath);
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
  });

  it("pushes the run's branch to origin and falls back to a manual result when gh/GitHub aren't available", async () => {
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "investigate", providerKind: "fake", model: "n/a" });
    expect(state.status).toBe("AWAITING_APPROVAL");

    const result = await agent.pr(state.runId);

    expect(result.method).toBe("manual"); // no `gh` in this test environment; the bare local path isn't GitHub
    expect(result.remote).toBe("origin");
    const branches = execFileSync("git", ["branch", "--list", result.branch], { cwd: bareRemote, encoding: "utf8" });
    expect(branches.trim()).not.toBe("");
  }, 30_000);

  it("throws a clear error for an unknown run id", async () => {
    const agent = new Agent(repoPath, stateDir);
    await expect(agent.pr("does-not-exist")).rejects.toThrow(/no such run/);
  });
});

describe("Agent.run scope (§13.4 monorepos)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeMonorepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("pins verification to the scoped subdir, so a failing root toolchain doesn't block a passing scoped one", async () => {
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "investigate", providerKind: "fake", model: "n/a", yesMode: true, scope: "packages/foo" });

    expect(state.status).toBe("DONE");
    expect(state.verificationResults[0]!.allGreen).toBe(true);
    expect(state.scope).toBe("packages/foo");
  }, 30_000);

  it("rejects a scope that doesn't exist in the worktree", async () => {
    const agent = new Agent(repoPath, stateDir);
    await expect(agent.run({ task: "investigate", providerKind: "fake", model: "n/a", scope: "packages/nope" })).rejects.toThrow(/does not exist/);
  }, 30_000);

  it("a scoped run's toolchain memory is visible via listMemory/showMemoryFact only when given the same scope — not the bare repo path (real bug caught in review)", async () => {
    const memoryDir = makeTempDir("clutchcode-agentapi-memory-");
    try {
      const agent = new Agent(repoPath, stateDir);
      await agent.run({ task: "investigate", providerKind: "fake", model: "n/a", yesMode: true, scope: "packages/foo", memoryDir });

      // The scoped cache genuinely has the fact...
      const scoped = listMemory(repoPath, { configDir: memoryDir }, "packages/foo");
      expect(scoped).toBeDefined();
      expect(scoped!.facts.test?.value).toBeTruthy();
      expect(showMemoryFact(repoPath, "test", { configDir: memoryDir }, "packages/foo")?.value).toBeTruthy();

      // ...but is a genuinely different cache file than the unscoped lookup —
      // this is the bug: before the fix, there was no way to pass a scope at
      // all, so this call was the *only* one available and always came back
      // empty for a scoped run.
      expect(listMemory(repoPath, { configDir: memoryDir })).toBeUndefined();
    } finally {
      fs.rmSync(memoryDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("correctMemoryFact with a scope writes to the scoped cache a scoped run actually reads — not the unscoped one", async () => {
    const memoryDir = makeTempDir("clutchcode-agentapi-memory-");
    try {
      correctMemoryFact(repoPath, "test", "echo scoped-correction-ran", { configDir: memoryDir }, "packages/foo");

      const agent = new Agent(repoPath, stateDir);
      const state = await agent.run({ task: "investigate", providerKind: "fake", model: "n/a", yesMode: true, scope: "packages/foo", memoryDir });

      expect(state.status).toBe("DONE");
      expect(state.verificationResults.at(-1)?.allGreen).toBe(true);
      // Correcting without a scope must NOT have affected the scoped run at all.
      expect(showMemoryFact(repoPath, "test", { configDir: memoryDir })).toBeUndefined();
    } finally {
      fs.rmSync(memoryDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("Agent.run workflow selection (§8.2)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("defaults to the \"default\" workflow when --workflow is omitted", async () => {
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({ task: "investigate the repo", providerKind: "fake", model: "n/a", yesMode: true });
    expect(state.workflowId).toBe("default");
  }, 30_000);

  it("review-only runs end to end through the real Agent API boundary: DONE, no edits, no verification", async () => {
    const agent = new Agent(repoPath, stateDir);
    const before = fs.readFileSync(path.join(repoPath, "README.md"), "utf8");

    const state = await agent.run({ task: "review the repo", providerKind: "fake", model: "n/a", yesMode: true, workflowId: "review-only" });

    expect(state.status).toBe("DONE");
    expect(state.workflowId).toBe("review-only");
    expect(state.verificationResults).toHaveLength(0);
    expect(fs.readFileSync(path.join(repoPath, "README.md"), "utf8")).toBe(before);
  }, 30_000);

  it("rejects an unknown workflow id with a clear error instead of a confusing downstream failure", async () => {
    const agent = new Agent(repoPath, stateDir);
    await expect(agent.run({ task: "investigate", providerKind: "fake", model: "n/a", workflowId: "does-not-exist" })).rejects.toThrow(
      /unknown workflow "does-not-exist"/
    );
  }, 30_000);
});

describe("Agent.run workflowFile (§8.1 user-declarative workflows)", () => {
  let repoPath: string;
  let stateDir: string;
  let workflowFile: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    workflowFile = path.join(stateDir, "always-plan.json");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function writeReadonlyWorkflow(): void {
    fs.writeFileSync(
      workflowFile,
      JSON.stringify({
        apiVersion: "clutchcode/v1",
        id: "custom-readonly",
        name: "Custom Readonly",
        stages: [{ id: "implement", uses: "implement", params: { readonly: true } }]
      }),
      "utf8"
    );
  }

  it("runs a real custom workflow end to end: the declaration's own id becomes state.workflowId, and its plan is genuinely honored", async () => {
    writeReadonlyWorkflow();
    const agent = new Agent(repoPath, stateDir);
    const before = fs.readFileSync(path.join(repoPath, "README.md"), "utf8");

    const state = await agent.run({ task: "review the repo", providerKind: "fake", model: "n/a", yesMode: true, workflowFile });

    expect(state.workflowId).toBe("custom-readonly"); // the declaration's id, not a built-in one
    expect(state.workflowPlan).toEqual({ planMode: "never", readonly: true });
    expect(state.status).toBe("DONE");
    expect(state.verificationResults).toHaveLength(0); // readonly — no verify stage ran
    expect(fs.readFileSync(path.join(repoPath, "README.md"), "utf8")).toBe(before);
  }, 30_000);

  it("rejects an invalid workflow file (§8.1 semantic rule violation) with a clear error", async () => {
    fs.writeFileSync(workflowFile, JSON.stringify({ apiVersion: "clutchcode/v1", id: "no-verify", name: "No Verify", stages: [{ id: "implement", uses: "implement" }] }), "utf8");
    const agent = new Agent(repoPath, stateDir);
    await expect(agent.run({ task: "investigate", providerKind: "fake", model: "n/a", workflowFile })).rejects.toThrow(/needs a "verify" stage too/);
  }, 30_000);

  it("rejects workflowId and workflowFile given together", async () => {
    writeReadonlyWorkflow();
    const agent = new Agent(repoPath, stateDir);
    await expect(agent.run({ task: "investigate", providerKind: "fake", model: "n/a", workflowId: "quickfix", workflowFile })).rejects.toThrow(
      /mutually exclusive/
    );
  }, 30_000);

  it("resume() correctly re-executes a custom workflow's plan even after its source file is deleted — the resolved plan is persisted, not re-read from disk", async () => {
    writeReadonlyWorkflow();
    const agent = new Agent(repoPath, stateDir);

    const paused = await agent.run({
      task: "review the repo",
      providerKind: "fake",
      model: "n/a",
      workflowFile,
      budgets: { steps: 0, wallclockMs: 60_000, tokens: 1_000_000, costUsd: 0 } // pauses before ever calling the model
    });
    expect(paused.status).toBe("PAUSED");
    expect(paused.workflowId).toBe("custom-readonly");
    expect(paused.workflowPlan).toEqual({ planMode: "never", readonly: true });

    // The declaration file that produced this plan no longer exists — resume must not need it.
    fs.rmSync(workflowFile);

    const finalState = await agent.resume(paused.runId, { extendSteps: 5 });

    expect(finalState.status).toBe("DONE");
    expect(finalState.verificationResults).toHaveLength(0); // still readonly — the persisted plan, not a re-read (nonexistent) file, drove this
  }, 30_000);
});

describe("Agent.run requires a git repo (§13.4)", () => {
  it("fails loudly and actionably instead of a raw git error, three calls deep", async () => {
    const dir = makeTempDir("clutchcode-agentapi-nongit-");
    const stateDir = makeTempDir("clutchcode-agentapi-state-");
    try {
      const agent = new Agent(dir, stateDir);
      await expect(agent.run({ task: "investigate", providerKind: "fake", model: "n/a" })).rejects.toThrow(/not a git repository/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("Agent sandbox Tier 1 (§12.5/§12.6) — real confinement, not just plumbing", () => {
  // This proves the *security property*, not just that fields get passed
  // around: a file outside the workspace is unreadable to the sandboxed
  // shell under Tier 1, and (deliberately, to show the contrast) readable
  // under the `policy.sandboxTier = "tier0"` escape hatch, which has no OS-
  // level confinement — only the policy engine, which doesn't gate a raw
  // `cat` of an absolute path the way it gates tool calls.
  const hasBwrap = detectBwrapOnPath();
  const maybeIt = hasBwrap ? it : it.skip;

  let repoPath: string;
  let stateDir: string;
  let leakPath: string;
  let server: ScriptedServer;

  function catLeakScript(): string[][] {
    return [
      [
        sseChunk({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "shell", arguments: JSON.stringify({ cmd: `cat ${leakPath}` }) } }] } }]
        }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ]
    ];
  }

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentapi-state-");
    markTrusted(repoPath);
    leakPath = path.join(makeTempDir("clutchcode-agentapi-leak-"), "outside-secret.txt");
    fs.writeFileSync(leakPath, "leaked outside workspace content marker", "utf8");
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(leakPath), { recursive: true, force: true });
    await server?.close();
  });

  maybeIt("Tier 1 (default): a file outside the workspace is unreadable to the sandboxed shell", async () => {
    server = await startScriptedServer(catLeakScript());
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({
      task: "investigate",
      providerKind: "openai-compatible",
      model: "gpt-test",
      baseUrl: server.baseUrl,
      budgets: { steps: 1 }
    });

    expect(state.status).toBe("PAUSED");
    expect(JSON.stringify(state.messages)).not.toContain("leaked outside workspace content marker");
    expect(JSON.stringify(state.toolCallLog)).toBeTruthy(); // sanity: the shell call actually happened
  }, 30_000);

  maybeIt("policy.sandboxTier = \"tier0\" is a real escape hatch: without OS confinement, the same file IS readable", async () => {
    const config = loadConfig(repoPath);
    saveConfig(repoPath, { ...config, policy: { ...config.policy, sandboxTier: "tier0" } });
    // Commit it — otherwise the default dirty-tree handling (§13.4) stashes
    // this uncommitted agent.toml away (`--include-untracked`) before the
    // run even starts, and the run would never see the override at all.
    execFileSync("git", ["add", "agent.toml"], { cwd: repoPath });
    execFileSync("git", ["commit", "-q", "-m", "tier0 override"], { cwd: repoPath });

    server = await startScriptedServer(catLeakScript());
    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({
      task: "investigate",
      providerKind: "openai-compatible",
      model: "gpt-test",
      baseUrl: server.baseUrl,
      budgets: { steps: 1 }
    });

    expect(state.status).toBe("PAUSED");
    expect(JSON.stringify(state.messages)).toContain("leaked outside workspace content marker");
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
