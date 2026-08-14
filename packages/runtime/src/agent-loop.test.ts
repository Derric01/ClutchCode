import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeProvider, textTurn, toolCallTurn } from "@clutchcode/providers";
import type { CapabilityProfile } from "@clutchcode/capability";
import { AgentLoop } from "./agent-loop.js";
import { commitApprovedRun } from "./approve.js";
import { createRunState } from "./run-state.js";
import { setupAgentLoopFixture } from "./test-helpers.js";
import type { RuntimeEvent } from "./agent-loop.js";

const FIX_EDIT = JSON.stringify({ path: "math.js", edits: [{ search: "return a - b;", replace: "return a + b;" }] });

function sampleProfile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    modelId: "probed-model",
    providerId: "fake",
    probedAt: "2026-08-14T00:00:00.000Z",
    probeDurationMs: 100,
    trials: 3,
    diffApplicationAccuracy: 0.4,
    instructionFidelity: 0.7,
    longPromptInstructionFidelity: "medium",
    toolTransport: "native",
    structuredOutputScore: 0.7,
    structuredOutputReliability: "medium",
    effectiveContext: 8000,
    loopCheckPassed: true,
    supportsParallelTools: false,
    constrainedDecodeAvailable: false,
    notes: [],
    ...overrides
  };
}

describe("AgentLoop (end-to-end with a real worktree + FakeProvider)", () => {
  it("fixes the bug, verifies green, and auto-commits in --yes mode", async () => {
    const fx = setupAgentLoopFixture("run00000001");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed the add() bug.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add() to add instead of subtract", provider: "fake", model: "fake" });

      const events: RuntimeEvent[] = [];
      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true, onEvent: (e) => events.push(e) }
      );

      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(finalState.verificationResults).toHaveLength(1);
      expect(finalState.verificationResults[0]!.allGreen).toBe(true);
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a + b;");
      expect(events.some((e) => e.type === "verify.stage" && e.stage === "test" && e.passed)).toBe(true);
      expect(events.some((e) => e.type === "run.end" && e.status === "DONE")).toBe(true);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("repairs after a failed verification and eventually succeeds", async () => {
    const fx = setupAgentLoopFixture("run00000002");
    try {
      const harmlessEdit = JSON.stringify({ path: "math.js", edits: [{ search: "// TODO: fix the implementation", replace: "// noted, investigating" }] });
      const provider = new FakeProvider([
        toolCallTurn("c1", "edit_file", harmlessEdit),
        textTurn("Made an initial change."),
        toolCallTurn("c2", "edit_file", FIX_EDIT),
        textTurn("Now actually fixed.")
      ]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(finalState.repairIterations).toBe(1);
      expect(finalState.verificationResults).toHaveLength(2);
      expect(finalState.verificationResults[0]!.allGreen).toBe(false);
      expect(finalState.verificationResults[1]!.allGreen).toBe(true);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("stops at AWAITING_APPROVAL without --yes, and commitApprovedRun finishes it", async () => {
    const fx = setupAgentLoopFixture("run00000003");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir
      });
      const afterRun = await loop.run();
      expect(afterRun.status).toBe("AWAITING_APPROVAL");
      // Not yet merged into the user's repo.
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a - b;");

      const finalState = commitApprovedRun(state, fx.run, { squash: true, message: "approved fix" });
      expect(finalState.status).toBe("DONE");
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a + b;");
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("escalates instead of completing when the diff trips cheat detection", async () => {
    const fx = setupAgentLoopFixture("run00000004");
    try {
      const cheatEdit = JSON.stringify({ path: "math.test.js", body: "console.log('PASS');\n" });
      const provider = new FakeProvider([toolCallTurn("c1", "write_file", cheatEdit), textTurn("Tests should pass now.")]);
      const state = createRunState({ runId: fx.run.runId, task: "make the tests pass", provider: "fake", model: "fake" });

      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true } // even --yes cannot auto-complete past a cheat flag
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("ESCALATED");
      expect(finalState.escalationReason).toMatch(/cheat detection/);
      expect(finalState.verificationResults[0]!.cheatFlagCount).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("pauses when the step budget is exhausted", async () => {
    const fx = setupAgentLoopFixture("run00000005");
    try {
      const provider = new FakeProvider([
        toolCallTurn("c1", "read_file", JSON.stringify({ path: "math.js" })),
        toolCallTurn("c2", "read_file", JSON.stringify({ path: "math.test.js" }))
      ]);
      const state = createRunState({
        runId: fx.run.runId,
        task: "investigate",
        provider: "fake",
        model: "fake",
        budgets: { steps: 2, wallclockMs: 60_000, tokens: 1_000_000, costUsd: 0 }
      });

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir
      });
      const finalState = await loop.run();

      expect(finalState.status).toBe("PAUSED");
      expect(finalState.escalationReason).toMatch(/budget exceeded: steps/);
      expect(provider.remaining()).toBe(0);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("escalates on a repeated identical tool call (loop detection)", async () => {
    const fx = setupAgentLoopFixture("run00000006");
    try {
      const sameArgs = JSON.stringify({ path: "math.js" });
      const provider = new FakeProvider([
        toolCallTurn("c1", "read_file", sameArgs),
        toolCallTurn("c2", "read_file", sameArgs),
        toolCallTurn("c3", "read_file", sameArgs),
        toolCallTurn("c4", "read_file", sameArgs)
      ]);
      const state = createRunState({ runId: fx.run.runId, task: "stuck task", provider: "fake", model: "fake" });

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir
      });
      const finalState = await loop.run();

      expect(finalState.status).toBe("ESCALATED");
      expect(finalState.escalationReason).toMatch(/loop detected: repeated-call/);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("with a capability profile: derives a context budget, caps output tokens, and adds adaptation guidance (§4.2/§4.5)", async () => {
    const fx = setupAgentLoopFixture("run00000007");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed the add() bug.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "probed-model" });
      const profile = sampleProfile();

      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir, capabilityProfile: profile },
        { yesMode: true }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(finalState.contextBudget).toEqual({
        effectiveContext: 8000,
        systemAndTools: 1200,
        repoMapRetrieval: 1600,
        openFileWindows: 2400,
        conversationHistory: 2000,
        reservedOutput: 800
      });

      // Every request the model saw was capped at the budget's reserved-output share.
      for (const req of provider.requestLog) expect(req.maxOutputTokens).toBe(800);

      // The adaptation note (low diff-accuracy -> prefer write_file) is its own system message.
      const systemMessages = provider.requestLog[0]!.messages.filter((m) => m.role === "system");
      expect(systemMessages).toHaveLength(2);
      expect(systemMessages[1]!.content).toContain("write_file");
      expect(systemMessages[1]!.content).toContain("40%");
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("with a capability profile that has no usable effective context: skips the budget without crashing", async () => {
    const fx = setupAgentLoopFixture("run00000008");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "unmeasurable-model" });
      const profile = sampleProfile({ effectiveContext: 0, notes: ["context recall failed at every rung"] });

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir,
        capabilityProfile: profile
      });
      const finalState = await loop.run();

      expect(finalState.status).toBe("AWAITING_APPROVAL");
      expect(finalState.contextBudget).toBeUndefined();
      expect(provider.requestLog[0]!.maxOutputTokens).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("without a capability profile: behaves exactly as before (no budget, no extra system message)", async () => {
    const fx = setupAgentLoopFixture("run00000009");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(finalState.contextBudget).toBeUndefined();
      expect(provider.requestLog[0]!.maxOutputTokens).toBeUndefined();
      expect(provider.requestLog[0]!.messages.filter((m) => m.role === "system")).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  }, 30_000);
});
