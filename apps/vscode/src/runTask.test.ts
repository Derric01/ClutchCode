import fs from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunState } from "@clutchcode/agent-api";
import { createAgentRpcClient, serveAgentRpc, type AgentRpcClient, type AgentRpcServerHandle } from "@clutchcode/agent-rpc";
import { pickRun, prTask, resumeTask, rollbackTask, runClutchCodeTask, type TaskUI } from "./runTask.js";
import { addBareOrigin, makeSampleRepo, makeTempDir, sseChunk, startScriptedServer } from "./test-helpers.js";

/**
 * Drives every task function in `runTask.ts` (the extension's actual
 * orchestration logic) against a *real* `AgentRpcClient` talking to a
 * *real* `Agent` over PassThrough streams — the same round trip a spawned
 * `clutchcode serve` process would give it, just without the process
 * boundary. Only the VS Code UI is faked, which is the one part that
 * genuinely can't run outside an extension host.
 */
function fakeUI(
  opts: { approveDecision?: "approve" | "reject" | "later"; pick?: (runs: RunState[]) => string | undefined } = {}
): TaskUI & {
  lines: string[];
  diffs: Array<{ runId: string; files: unknown[] }>;
  infos: string[];
  errors: string[];
  picks: RunState[][];
} {
  const lines: string[] = [];
  const diffs: Array<{ runId: string; files: unknown[] }> = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const picks: RunState[][] = [];
  return {
    lines,
    diffs,
    infos,
    errors,
    picks,
    showOutputLine: (line) => lines.push(line),
    showDiff: (runId, files) => diffs.push({ runId, files }),
    askApproveOrReject: async () => opts.approveDecision ?? "later",
    showInfo: (m) => infos.push(m),
    showError: (m) => errors.push(m),
    pickRun: async (runs) => {
      picks.push(runs);
      return opts.pick ? opts.pick(runs) : runs[0]?.runId;
    }
  };
}

describe("runClutchCodeTask (§18.5 UX, over a real AgentRpcClient/Agent)", () => {
  let repoPath: string;
  let stateDir: string;
  let client: AgentRpcClient;
  let server: AgentRpcServerHandle;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-vscode-state-");
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    server = serveAgentRpc({ repoPath, stateDir }, toServer, toClient);
    client = createAgentRpcClient(toServer, toClient);
  });

  afterEach(() => {
    client.close();
    server.close();
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("streams events, shows the diff, and approves on request", async () => {
    const ui = fakeUI({ approveDecision: "approve" });
    await runClutchCodeTask(client, { task: "investigate", providerKind: "fake", model: "n/a" }, ui);

    expect(ui.lines.length).toBeGreaterThan(0);
    expect(ui.diffs).toHaveLength(1);
    expect(ui.infos.some((m) => m.includes("approved and committed"))).toBe(true);
    expect(ui.errors).toHaveLength(0);

    const status = await client.request<{ status: string } | null>("status");
    expect(status?.status).toBe("DONE");
  }, 30_000);

  it("shows real per-file before/after content, not just a diff-call marker", async () => {
    const scripted = await startScriptedServer([
      [
        sseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "feature.txt", body: "v1\n" }) } }] } }] }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    try {
      const ui = fakeUI({ approveDecision: "later" });
      await runClutchCodeTask(client, { task: "add a feature", providerKind: "openai-compatible", model: "gpt-test", baseUrl: scripted.baseUrl }, ui);

      expect(ui.diffs).toHaveLength(1);
      const files = ui.diffs[0]!.files as { path: string; status: string; before?: string; after?: string }[];
      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("feature.txt");
      expect(files[0]!.status).toBe("added");
      expect(files[0]!.after).toBe("v1\n");
    } finally {
      await scripted.close();
    }
  }, 30_000);

  it("rejects on request", async () => {
    const ui = fakeUI({ approveDecision: "reject" });
    await runClutchCodeTask(client, { task: "investigate", providerKind: "fake", model: "n/a" }, ui);

    expect(ui.infos.some((m) => m.includes("rejected"))).toBe(true);
    const status = await client.request<{ status: string } | null>("status");
    expect(status?.status).toBe("CANCELLED");
  }, 30_000);

  it("leaves the run untouched when the user defers ('later')", async () => {
    const ui = fakeUI({ approveDecision: "later" });
    await runClutchCodeTask(client, { task: "investigate", providerKind: "fake", model: "n/a" }, ui);

    expect(ui.infos.some((m) => m.includes("awaiting your review"))).toBe(true);
    const status = await client.request<{ status: string } | null>("status");
    expect(status?.status).toBe("AWAITING_APPROVAL");
  }, 30_000);

  it("surfaces an Agent-level error through showError instead of throwing out of the orchestration", async () => {
    fs.rmSync(repoPath, { recursive: true, force: true }); // no longer a repo at all — Agent.run's own git-repo guard fires
    const ui = fakeUI();
    await runClutchCodeTask(client, { task: "investigate", providerKind: "fake", model: "n/a" }, ui);

    expect(ui.errors.some((m) => m.includes("not a git repository"))).toBe(true);
    fs.mkdirSync(repoPath, { recursive: true }); // afterEach expects it to still exist
  }, 30_000);
});

describe("resumeTask / rollbackTask / prTask / pickRun (§18.5 polish, over a real AgentRpcClient/Agent)", () => {
  let repoPath: string;
  let stateDir: string;
  let bareRemote: string;
  let client: AgentRpcClient;
  let server: AgentRpcServerHandle;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-vscode-state-");
    bareRemote = addBareOrigin(repoPath); // so prTask's push has somewhere real to push to
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    server = serveAgentRpc({ repoPath, stateDir }, toServer, toClient);
    client = createAgentRpcClient(toServer, toClient);
  });

  afterEach(() => {
    client.close();
    server.close();
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
  });

  it("resumeTask continues a PAUSED run to DONE, going through the same post-state handling as a fresh run", async () => {
    const paused = await client.request<RunState>("run", {
      task: "investigate",
      providerKind: "fake",
      model: "n/a",
      budgets: { steps: 0 } // pauses immediately, before ever reaching AWAITING_APPROVAL
    });
    expect(paused.status).toBe("PAUSED");

    const ui = fakeUI({ approveDecision: "approve" });
    await resumeTask(client, paused.runId, ui, { extendSteps: 20 });

    expect(ui.infos.some((m) => m.includes("approved and committed"))).toBe(true);
    const status = await client.request<{ status: string } | null>("status");
    expect(status?.status).toBe("DONE");
  }, 30_000);

  it("rollbackTask restores an earlier checkpoint through the real RPC boundary", async () => {
    // A real edit via the scripted-tool-call server, so there's a real checkpoint to roll back to.
    const scripted = await startScriptedServer([
      [
        sseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "f.txt", body: "v1\n" }) } }] } }] }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    try {
      const state = await client.request<RunState>("run", { task: "add a file", providerKind: "openai-compatible", model: "gpt-test", baseUrl: scripted.baseUrl });
      expect(state.status).toBe("AWAITING_APPROVAL");

      const checkpoints = await client.request<{ sha: string; message: string }[]>("checkpoints", { runId: state.runId });
      expect(checkpoints.length).toBeGreaterThan(0);

      const ui = fakeUI();
      await rollbackTask(client, state.runId, checkpoints[0]!.sha, ui);
      expect(ui.infos.some((m) => m.includes("rolled back"))).toBe(true);
      expect(ui.errors).toHaveLength(0);
    } finally {
      await scripted.close();
    }
  }, 30_000);

  it("prTask reports the manual-fallback outcome when gh/GitHub aren't available (mirrors the CLI's own pr test)", async () => {
    const state = await client.request<RunState>("run", { task: "investigate", providerKind: "fake", model: "n/a" });
    expect(state.status).toBe("AWAITING_APPROVAL");

    const ui = fakeUI();
    await prTask(client, state.runId, ui);
    expect(ui.errors).toHaveLength(0);
    expect(ui.infos.some((m) => m.includes(state.runId))).toBe(true);
  }, 30_000);

  it("pickRun fetches the real run list, filters it, and hands the filtered set to ui.pickRun", async () => {
    const done = await client.request<RunState>("run", { task: "investigate", providerKind: "fake", model: "n/a", yesMode: true });
    expect(done.status).toBe("DONE");
    const awaiting = await client.request<RunState>("run", { task: "investigate again", providerKind: "fake", model: "n/a" });
    expect(awaiting.status).toBe("AWAITING_APPROVAL");

    const ui = fakeUI({ pick: (runs) => runs[0]?.runId });
    const picked = await pickRun(client, ui, { placeholder: "pick one", filter: (s) => s.status === "AWAITING_APPROVAL" });

    expect(ui.picks).toHaveLength(1);
    expect(ui.picks[0]!.every((s) => s.status === "AWAITING_APPROVAL")).toBe(true);
    expect(picked).toBe(awaiting.runId);
  }, 30_000);

  it("pickRun reports 'no matching runs' and never calls ui.pickRun when the filter excludes everything", async () => {
    await client.request<RunState>("run", { task: "investigate", providerKind: "fake", model: "n/a", yesMode: true });

    const ui = fakeUI();
    const picked = await pickRun(client, ui, { placeholder: "pick one", filter: (s) => s.status === "PAUSED" });

    expect(picked).toBeUndefined();
    expect(ui.picks).toHaveLength(0);
    expect(ui.infos.some((m) => m.includes("no matching runs"))).toBe(true);
  }, 30_000);
});
