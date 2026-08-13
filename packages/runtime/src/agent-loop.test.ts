import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeProvider, textTurn, toolCallTurn } from "@clutchcode/providers";
import { unprobedProfile, type CapabilityProfile } from "@clutchcode/capability";
import { AgentLoop } from "./agent-loop.js";
import { commitApprovedRun } from "./approve.js";
import { createRunState } from "./run-state.js";
import { setupAgentLoopFixture } from "./test-helpers.js";
import type { RuntimeEvent } from "./agent-loop.js";

function emulationProfile(): CapabilityProfile {
  return { ...unprobedProfile("fake", "fake"), toolTransport: "emulation" };
}

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

  it("folds projectMemory (AGENTS.md) into the first model request's system message (§10.1)", async () => {
    const fx = setupAgentLoopFixture("run0000000a");
    try {
      const provider = new FakeProvider([toolCallTurn("c1", "edit_file", FIX_EDIT), textTurn("Fixed.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(
        state,
        {
          provider,
          tools: fx.tools,
          toolContext: fx.toolContext,
          run: fx.run,
          toolchainCommands: fx.toolchainCommands,
          evidenceDir: fx.evidenceDir,
          projectMemory: "## Conventions\n- this project uses tabs, not spaces"
        },
        { yesMode: true }
      );
      await loop.run();

      const firstRequest = provider.requestLog[0]!;
      expect(firstRequest.messages[0]!.role).toBe("system");
      expect(firstRequest.messages[0]!.content).toContain("this project uses tabs, not spaces");
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

  it("drives a full fix through the §4.8 text protocol when the capability profile says the model needs emulation", async () => {
    const fx = setupAgentLoopFixture("run0000000b");
    try {
      const toolCallText = [
        '<tool name="edit_file">',
        '<arg name="path">math.js</arg>',
        '<arg name="edits">[{"search":"return a - b;","replace":"return a + b;"}]</arg>',
        "</tool>"
      ].join("\n");
      const provider = new FakeProvider([textTurn(toolCallText), textTurn("Fixed the add() bug.")]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(
        state,
        {
          provider,
          tools: fx.tools,
          toolContext: fx.toolContext,
          run: fx.run,
          toolchainCommands: fx.toolchainCommands,
          evidenceDir: fx.evidenceDir,
          capabilityProfile: emulationProfile()
        },
        { yesMode: true }
      );

      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(finalState.toolCallLog).toHaveLength(1);
      expect(finalState.toolCallLog[0]!.tool).toBe("edit_file");
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a + b;");

      // No native `tools` schema was offered to the provider — the instructions went in the system prompt instead.
      expect(provider.requestLog[0]!.tools).toBeUndefined();
      expect(provider.requestLog[0]!.messages[0]!.content).toContain("Tool-calling protocol");
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("re-prompts on a malformed text-protocol block, then escalates after MAX_TOOL_PARSE_RETRIES", async () => {
    const fx = setupAgentLoopFixture("run0000000c");
    try {
      const malformed = '<tool name="edit_file"></tool><tool name="write_file"></tool>'; // two top-level blocks -> parse error
      const provider = new FakeProvider([textTurn(malformed), textTurn(malformed), textTurn(malformed)]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(state, {
        provider,
        tools: fx.tools,
        toolContext: fx.toolContext,
        run: fx.run,
        toolchainCommands: fx.toolchainCommands,
        evidenceDir: fx.evidenceDir,
        capabilityProfile: emulationProfile()
      });

      const finalState = await loop.run();

      expect(finalState.status).toBe("ESCALATED");
      expect(finalState.escalationReason).toMatch(/tool-call text protocol parse failed repeatedly/);
      expect(finalState.toolCallLog).toHaveLength(0); // never got a valid call to execute
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("downgrades to write_file after MAX_EDIT_RETRIES failed edit_file attempts on the same file (§4.4)", async () => {
    const fx = setupAgentLoopFixture("run0000000d");
    try {
      const badEdit = JSON.stringify({ path: "math.js", edits: [{ search: "this text does not exist in the file", replace: "x" }] });
      const goodWrite = JSON.stringify({
        path: "math.js",
        body: "// TODO: fix the implementation\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n"
      });
      const provider = new FakeProvider([
        toolCallTurn("c1", "edit_file", badEdit),
        toolCallTurn("c2", "edit_file", badEdit),
        toolCallTurn("c3", "edit_file", badEdit), // 3rd failure crosses MAX_EDIT_RETRIES (2) -> nudge injected
        toolCallTurn("c4", "write_file", goodWrite),
        textTurn("Rewrote the file.")
      ]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });

      const loop = new AgentLoop(
        state,
        { provider, tools: fx.tools, toolContext: fx.toolContext, run: fx.run, toolchainCommands: fx.toolchainCommands, evidenceDir: fx.evidenceDir },
        { yesMode: true }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(fs.readFileSync(path.join(fx.repoPath, "math.js"), "utf8")).toContain("return a + b;");

      // The 4th request (index 3, sent right after the 3rd edit_file failure) carries the downgrade nudge.
      const nudgedRequest = provider.requestLog[3]!;
      const nudgeMessage = nudgedRequest.messages.find((m) => m.content.includes("switch to write_file"));
      expect(nudgeMessage).toBeDefined();
    } finally {
      fx.cleanup();
    }
  }, 30_000);

  it("compacts conversation history mid-run for a tiny-effective-context profile (§4.5)", async () => {
    const fx = setupAgentLoopFixture("run0000000e");
    try {
      // Several read_file round-trips first (padding the transcript), then the real fix.
      const readMath = JSON.stringify({ path: "math.js" });
      const readTest = JSON.stringify({ path: "math.test.js" });
      const provider = new FakeProvider([
        toolCallTurn("c1", "read_file", readMath),
        toolCallTurn("c2", "read_file", readTest),
        toolCallTurn("c3", "read_file", readMath),
        toolCallTurn("c4", "edit_file", FIX_EDIT),
        textTurn("Fixed.")
      ]);
      const state = createRunState({ runId: fx.run.runId, task: "fix add()", provider: "fake", model: "fake" });
      const tinyProfile: CapabilityProfile = { ...unprobedProfile("fake", "fake"), toolTransport: "native", effectiveContext: 400 };

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
          capabilityProfile: tinyProfile
        },
        { yesMode: true, onEvent: (e) => events.push(e) }
      );
      const finalState = await loop.run();

      expect(finalState.status).toBe("DONE");
      expect(events.some((e) => e.type === "context.compacted")).toBe(true);

      // The last request's message list is bounded — not one entry per turn/tool-result piled up forever.
      const lastRequest = provider.requestLog[provider.requestLog.length - 1]!;
      expect(lastRequest.messages.some((m) => m.content.includes("compacted"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  }, 30_000);
});
