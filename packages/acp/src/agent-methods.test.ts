import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client as buildTestClientApp, AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, type SessionUpdate, type StopReason } from "@agentclientprotocol/sdk";
import { buildAcpApp } from "./agent-methods.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";

/**
 * The real point of this file: drive `buildAcpApp` (a real `@clutchcode/agent-api`
 * `Agent`, a real temp git repo, a real `npm test`) through an ACP protocol
 * conformance client, in-process (`ClientApp.connectWith(agentApp, ...)` — no
 * transport needed to exercise real ACP request/response/notification
 * semantics; `server.test.ts` separately proves the actual stdio byte-stream
 * wiring). `FakeProvider` (via the `_meta["clutchcode/provider"]` override,
 * §18.1) is the one thing stubbed — everything else (worktree, verification
 * pipeline, RunState machine) is real, per this repo's testing philosophy.
 */
describe("buildAcpApp (§18.1/§20/§26 ACP binding)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-acp-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("initialize advertises no auth, ACP v1, and only the baseline text prompt capability", async () => {
    const agentApp = buildAcpApp({ stateDir });
    const result = await buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
      return ctx.request(AGENT_METHODS.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    });
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.authMethods).toEqual([]);
    expect(result.agentCapabilities?.loadSession).toBe(false);
    expect(result.agentCapabilities?.promptCapabilities).toEqual({ image: false, audio: false, embeddedContext: false });
    expect(result.agentInfo?.name).toBe("clutchcode");
  });

  it("session/new rejects a non-absolute cwd", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, (ctx) => ctx.request(AGENT_METHODS.session_new, { cwd: "relative/path", mcpServers: [] }))
    ).rejects.toThrow(/absolute/);
  });

  it("session/new rejects a cwd that doesn't exist", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, (ctx) => ctx.request(AGENT_METHODS.session_new, { cwd: path.join(repoPath, "does-not-exist"), mcpServers: [] }))
    ).rejects.toThrow(/does not exist/);
  });

  it("session/new reads agent.toml from the real cwd and reports a config error through the real loadConfig path", async () => {
    fs.writeFileSync(path.join(repoPath, "agent.toml"), 'apiVersion = "clutchcode/v1"\ndefaultProvider = "ghost"\n', "utf8");
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, (ctx) => ctx.request(AGENT_METHODS.session_new, { cwd: repoPath, mcpServers: [] }))
    ).rejects.toThrow(/defaultProvider "ghost"/);
  });

  it("session/new rejects when no defaultProvider is configured and no _meta override is sent", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, (ctx) => ctx.request(AGENT_METHODS.session_new, { cwd: repoPath, mcpServers: [] }))
    ).rejects.toThrow(/no defaultProvider configured/);
  });

  it("runs a full prompt turn: session/new (via _meta override) → session/prompt → streamed session/update → AWAITING_APPROVAL → clutchcode/approve → DONE", async () => {
    const agentApp = buildAcpApp({ stateDir });
    const updates: SessionUpdate[] = [];

    const outcome = await buildTestClientApp({ name: "test-client" })
      .onNotification(CLIENT_METHODS.session_update, (ctx) => {
        updates.push(ctx.params.update);
      })
      .connectWith(agentApp, async (ctx) => {
        await ctx.request(AGENT_METHODS.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });

        const session = await ctx.request(AGENT_METHODS.session_new, {
          cwd: repoPath,
          mcpServers: [],
          _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
        });
        expect(typeof session.sessionId).toBe("string");

        const promptResult = await ctx.request(AGENT_METHODS.session_prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "investigate the repo" }]
        });

        const status = (await ctx.request("clutchcode/status", { sessionId: session.sessionId })) as { state: { status: string; runId: string } };
        expect(status.state.status).toBe("AWAITING_APPROVAL");

        const diff = (await ctx.request("clutchcode/diff", { sessionId: session.sessionId })) as { runId: string; diff: string };
        expect(diff.runId).toBe(status.state.runId);
        expect(typeof diff.diff).toBe("string");

        const diffFiles = (await ctx.request("clutchcode/diffFiles", { sessionId: session.sessionId })) as { files: unknown[] };
        expect(Array.isArray(diffFiles.files)).toBe(true);

        const inspected = (await ctx.request("clutchcode/inspect", { sessionId: session.sessionId })) as { state: { runId: string }; events: unknown[] };
        expect(inspected.state.runId).toBe(status.state.runId);
        expect(Array.isArray(inspected.events)).toBe(true);

        const checkpoints = (await ctx.request("clutchcode/checkpoints", { sessionId: session.sessionId })) as unknown[];
        expect(Array.isArray(checkpoints)).toBe(true);

        const runs = (await ctx.request("clutchcode/listRuns", { sessionId: session.sessionId })) as { runs: unknown[] };
        expect(runs.runs.length).toBe(1);

        const approved = (await ctx.request("clutchcode/approve", { sessionId: session.sessionId, squash: true })) as { status: string };

        return { stopReason: promptResult.stopReason as StopReason, approvedStatus: approved.status };
      });

    expect(outcome.stopReason).toBe("end_turn");
    expect(outcome.approvedStatus).toBe("DONE");

    // Real streaming, not just a final response: at least one message chunk
    // (the fake provider's canned response and/or the run.end summary) and
    // at least one verify-stage tool_call (the sample repo's real `npm
    // test` actually ran through the real verification pipeline).
    expect(updates.some((u) => u.sessionUpdate === "agent_message_chunk")).toBe(true);
    expect(updates.some((u) => u.sessionUpdate === "tool_call" && "title" in u && u.title.startsWith("verify:"))).toBe(true);
  }, 30_000);

  it("a second session/prompt in the same session starts a new run (task-based, not conversational)", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
      const session = await ctx.request(AGENT_METHODS.session_new, {
        cwd: repoPath,
        mcpServers: [],
        _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
      });

      await ctx.request(AGENT_METHODS.session_prompt, { sessionId: session.sessionId, prompt: [{ type: "text", text: "first task" }] });
      const firstStatus = (await ctx.request("clutchcode/status", { sessionId: session.sessionId })) as { lastRunId: string };

      await ctx.request(AGENT_METHODS.session_prompt, { sessionId: session.sessionId, prompt: [{ type: "text", text: "second task" }] });
      const secondStatus = (await ctx.request("clutchcode/status", { sessionId: session.sessionId })) as { lastRunId: string };

      expect(secondStatus.lastRunId).not.toBe(firstStatus.lastRunId);

      const runs = (await ctx.request("clutchcode/listRuns", { sessionId: session.sessionId })) as { runs: unknown[] };
      expect(runs.runs.length).toBe(2);
    });
  }, 30_000);

  it("clutchcode/reject moves an AWAITING_APPROVAL run to CANCELLED", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
      const session = await ctx.request(AGENT_METHODS.session_new, {
        cwd: repoPath,
        mcpServers: [],
        _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
      });
      await ctx.request(AGENT_METHODS.session_prompt, { sessionId: session.sessionId, prompt: [{ type: "text", text: "investigate" }] });
      const rejected = (await ctx.request("clutchcode/reject", { sessionId: session.sessionId })) as { status: string };
      expect(rejected.status).toBe("CANCELLED");
    });
  }, 30_000);

  it("session/prompt rejects an empty/whitespace-only prompt instead of starting a run", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
        const session = await ctx.request(AGENT_METHODS.session_new, {
          cwd: repoPath,
          mcpServers: [],
          _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
        });
        return ctx.request(AGENT_METHODS.session_prompt, { sessionId: session.sessionId, prompt: [{ type: "text", text: "   " }] });
      })
    ).rejects.toThrow(/non-empty text content block/);
  });

  it("session/prompt rejects an unknown sessionId", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, (ctx) =>
        ctx.request(AGENT_METHODS.session_prompt, { sessionId: "not-a-real-session", prompt: [{ type: "text", text: "x" }] })
      )
    ).rejects.toThrow(/unknown sessionId/);
  });

  it("clutchcode/* extension methods reject an unknown sessionId", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, (ctx) => ctx.request("clutchcode/diff", { sessionId: "ghost" }))
    ).rejects.toThrow(/unknown sessionId/);
  });

  it("clutchcode/diff without a prior run rejects (no runId to default to)", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
        const session = await ctx.request(AGENT_METHODS.session_new, {
          cwd: repoPath,
          mcpServers: [],
          _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
        });
        return ctx.request("clutchcode/diff", { sessionId: session.sessionId });
      })
    ).rejects.toThrow(/no run has started/);
  });

  it("session/cancel is recorded honestly (not preemptive — see buildAcpApp's header comment) and observable via clutchcode/status", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
      const session = await ctx.request(AGENT_METHODS.session_new, {
        cwd: repoPath,
        mcpServers: [],
        _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
      });

      const before = (await ctx.request("clutchcode/status", { sessionId: session.sessionId })) as { cancelRequested: boolean };
      expect(before.cancelRequested).toBe(false);

      await ctx.notify(AGENT_METHODS.session_cancel, { sessionId: session.sessionId });

      const after = (await ctx.request("clutchcode/status", { sessionId: session.sessionId })) as { cancelRequested: boolean };
      expect(after.cancelRequested).toBe(true);
    });
  });

  it("clutchcode/rollback requires params.sha", async () => {
    const agentApp = buildAcpApp({ stateDir });
    await expect(
      buildTestClientApp({ name: "test-client" }).connectWith(agentApp, async (ctx) => {
        const session = await ctx.request(AGENT_METHODS.session_new, {
          cwd: repoPath,
          mcpServers: [],
          _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
        });
        await ctx.request(AGENT_METHODS.session_prompt, { sessionId: session.sessionId, prompt: [{ type: "text", text: "x" }] });
        return ctx.request("clutchcode/rollback", { sessionId: session.sessionId });
      })
    ).rejects.toThrow(/params\.sha is required/);
  }, 30_000);
});
