import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeProvider, textTurn, toolCallTurn } from "@clutchcode/providers";
import { computeContextBudget, type EffectiveCapability } from "@clutchcode/capability";
import { AgentLoop } from "./agent-loop.js";
import { commitApprovedRun } from "./approve.js";
import { createRunState } from "./run-state.js";
import { setupAgentLoopFixture } from "./test-helpers.js";
import type { RuntimeEvent } from "./agent-loop.js";

const FIX_EDIT = JSON.stringify({ path: "math.js", edits: [{ search: "return a - b;", replace: "return a + b;" }] });

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
});

describe("AgentLoop capability wiring (§4.2/§4.4/§4.5)", () => {
  it("with no explicit capability, derives maxOutputTokens from the provider's own CapabilityDefaults", async () => {
    const fx = setupAgentLoopFixture("run00000010");
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
      await loop.run();

      const expectedReserved = computeContextBudget(provider.capabilityDefaults.approxEffectiveContext).reservedOutput;
      expect(provider.requestLog.length).toBeGreaterThan(0);
      for (const req of provider.requestLog) {
        expect(req.maxOutputTokens).toBe(expectedReserved);
      }
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("embeds edit-format guidance from an explicit capability profile into the system prompt", async () => {
    const fx = setupAgentLoopFixture("run00000011");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });
      const capability: EffectiveCapability = { effectiveContext: 8000, diffApplicationAccuracy: 0.2, constrainedDecodeAvailable: false, probed: true };

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir,
        capability
      });
      await loop.run();

      expect(provider.requestLog[0]!.messages[0]!.content).toContain("write_file (whole-file rewrite)");
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("compacts history and emits context.compacted once the effective-context budget is exceeded, without breaking the run", async () => {
    const fx = setupAgentLoopFixture("run00000012");
    try {
      const bigBody = (n: number) => "z".repeat(400) + n;
      // A step budget of 4 stops the run deterministically after 4 model turns — well
      // short of verification (irrelevant here) and short of any loop-detector escalation.
      const turns = Array.from({ length: 5 }, (_, i) => toolCallTurn(`c${i}`, "write_file", JSON.stringify({ path: "scratch.txt", body: bigBody(i) })));
      const provider = new FakeProvider(turns);
      const state = createRunState({
        runId: fx.run.runId,
        task: "scratch work",
        provider: "fake",
        model: "fake",
        budgets: { steps: 4, wallclockMs: 60_000, tokens: 1_000_000, costUsd: 0 }
      });
      // Tiny effective context so the folded history+repo-map+open-file budget is crossed in a couple of turns.
      const capability: EffectiveCapability = { effectiveContext: 200, diffApplicationAccuracy: 0.75, constrainedDecodeAvailable: false, probed: true };

      const events: RuntimeEvent[] = [];
      const loop = new AgentLoop(
        state,
        {
          provider,
          tools: fx.tools,
          toolContext: fx.toolContext,
          run: fx.run,
          toolchainCommands: fx.toolchainCommands,
          evidenceDir: fx.evidenceDir,
          capability
        },
        { yesMode: true, onEvent: (e) => events.push(e) }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("PAUSED");
      const compactionEvents = events.filter((e): e is Extract<RuntimeEvent, { type: "context.compacted" }> => e.type === "context.compacted");
      expect(compactionEvents.length).toBeGreaterThan(0);
      expect(compactionEvents[0]!.droppedCount).toBeGreaterThan(0);
      // The task message is always pinned, even after aggressive compaction.
      expect(provider.requestLog.at(-1)!.messages[1]).toEqual({ role: "user", content: "scratch work" });
    } finally {
      fx.cleanup();
    }
  }, 30_000);
});

describe("AgentLoop resume + transcript redaction (§5.2/§6.2/§6.3)", () => {
  const CANARY = "sk-ant-canaryLeakDoNotPersist1234567890";

  it("persists a redacted transcript: the live conversation carries a secret a tool just produced, RunState.messages never does", async () => {
    const fx = setupAgentLoopFixture("run00000020");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "shell", JSON.stringify({ cmd: `echo ${CANARY}` }))]);
      const state = createRunState({
        runId: fx.run.runId,
        task: "print the canary",
        provider: "fake",
        model: "fake",
        // Pauses right after the one tool call, well before verification would ever run.
        budgets: { steps: 1, wallclockMs: 60_000, tokens: 1_000_000, costUsd: 0 }
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
      // Sanity: the run actually executed the shell tool (otherwise this proves nothing).
      expect(finalState.toolCallLog.some((t) => t.tool === "shell")).toBe(true);

      expect(JSON.stringify(finalState.messages)).not.toContain(CANARY);
      expect(JSON.stringify(finalState.messages)).toContain("«REDACTED:");
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("resume() continues a run reloaded from a JSON round-trip (simulating a real disk reload) and reaches DONE", async () => {
    const fx = setupAgentLoopFixture("run00000021");
    try {
      const provider = new FakeProvider([
        toolCallTurn("c1", "shell", JSON.stringify({ cmd: `echo ${CANARY}` })),
        toolCallTurn("c2", "edit_file", FIX_EDIT),
        textTurn("Fixed, after printing the canary.")
      ]);
      const state = createRunState({
        runId: fx.run.runId,
        task: "print the canary, then fix add()",
        provider: "fake",
        model: "fake",
        budgets: { steps: 1, wallclockMs: 60_000, tokens: 1_000_000, costUsd: 0 }
      });

      const firstLoop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir
      });
      const pausedState = await firstLoop.run();
      expect(pausedState.status).toBe("PAUSED");

      // Simulate a real crash/restart: serialize to JSON and back, exactly what RunStateStore does.
      const reloaded = JSON.parse(JSON.stringify(pausedState)) as typeof pausedState;
      expect(JSON.stringify(reloaded)).not.toContain(CANARY);
      reloaded.budgets.steps += 10; // the extension a caller must apply before resuming (§6.3 "ask to extend/stop")

      const resumedLoop = new AgentLoop(
        reloaded,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true }
      );
      const finalState = await resumedLoop.resume();

      expect(finalState.status).toBe("DONE");
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a + b;");
      // The pre-resume secret still never surfaces in the persisted transcript.
      expect(JSON.stringify(finalState.messages)).not.toContain(CANARY);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("resume() rejects a run that isn't PAUSED", async () => {
    const fx = setupAgentLoopFixture("run00000022");
    try {
      const provider = new FakeProvider([textTurn("noop")]);
      const state = createRunState({ runId: fx.run.runId, task: "t", provider: "fake", model: "fake" });
      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir
      });

      await expect(loop.resume()).rejects.toThrow(/requires a PAUSED run/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("Workflow engine (§8.2: default / quickfix / review-only)", () => {
  // Trips the planning heuristic's AMBIGUITY_MARKERS ("refactor", "across", "multiple") —
  // same task description used for both scenarios below so the only variable is workflowId.
  const AMBIGUOUS_TASK = "refactor the math module across multiple files";

  it("default: the planning heuristic still triggers PLANNING for an ambiguous task (unchanged baseline)", async () => {
    const fx = setupAgentLoopFixture("run00000040");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: AMBIGUOUS_TASK, provider: "fake", model: "fake" });

      const events: RuntimeEvent[] = [];
      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true, onEvent: (e) => events.push(e) }
      );
      const finalState = await loop.run();

      expect(finalState.workflowId).toBe("default");
      expect(finalState.plan).toHaveLength(1);
      expect(events.some((e) => e.type === "state.transition" && e.to === "PLANNING")).toBe(true);
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("quickfix: skips planning unconditionally, even for the exact same ambiguous task", async () => {
    const fx = setupAgentLoopFixture("run00000041");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: AMBIGUOUS_TASK, workflowId: "quickfix", provider: "fake", model: "fake" });

      const events: RuntimeEvent[] = [];
      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true, onEvent: (e) => events.push(e) }
      );
      const finalState = await loop.run();

      expect(finalState.plan).toHaveLength(0);
      expect(events.some((e) => e.type === "state.transition" && e.to === "PLANNING")).toBe(false);
      // Skipping planning doesn't skip anything else — quickfix still reaches the same DONE outcome.
      expect(finalState.status).toBe("DONE");
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("review-only: withholds write_file/edit_file from the schema the model actually sees", async () => {
    const fx = setupAgentLoopFixture("run00000042");
    try {
      const provider = new FakeProvider([textTurn("No issues found in math.js.")]);
      const state = createRunState({ runId: fx.run.runId, task: "review the repo", workflowId: "review-only", provider: "fake", model: "fake" });

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir
      });
      await loop.run();

      const toolNames = provider.requestLog[0]!.tools?.map((t) => t.name) ?? [];
      expect(toolNames).not.toContain("write_file");
      expect(toolNames).not.toContain("edit_file");
      expect(toolNames).toContain("read_file"); // still allowed to inspect
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("review-only: an edit attempt is refused as unknown-tool (defense in depth, not just a hidden schema), and the run still finishes as a report with no verify/approve/commit", async () => {
    const fx = setupAgentLoopFixture("run00000043");
    try {
      // The model tries to edit anyway — proves the block is enforced at dispatch, not just by omission from the schema.
      const provider = new FakeProvider([
        toolCallTurn("c1", "edit_file", FIX_EDIT),
        textTurn("math.js's add() subtracts instead of adding; recommend swapping the operator.")
      ]);
      const state = createRunState({ runId: fx.run.runId, task: "review add()", workflowId: "review-only", provider: "fake", model: "fake" });

      const events: RuntimeEvent[] = [];
      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true, onEvent: (e) => events.push(e) }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      // Never touched the working tree — the attempted edit was refused, not executed.
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a - b;");
      expect(finalState.toolCallLog.some((t) => t.tool === "edit_file" && !t.ok && t.errorCode === "unknown-tool")).toBe(true);
      // No verify/approve/commit stage exists for this workflow.
      expect(finalState.verificationResults).toHaveLength(0);
      expect(
        events.some((e) => e.type === "state.transition" && (e.to === "VERIFYING" || e.to === "AWAITING_APPROVAL" || e.to === "COMMITTING"))
      ).toBe(false);
      // The model's final reply is captured as the report.
      expect(finalState.summaryCheckpoints).toHaveLength(1);
      expect(finalState.summaryCheckpoints[0]).toContain("recommend swapping the operator");
    } finally {
      fx.cleanup();
    }
  }, 30_000);
});
