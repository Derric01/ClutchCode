import fs from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRpcClient, serveAgentRpc, type AgentRpcClient, type AgentRpcServerHandle } from "@clutchcode/agent-rpc";
import { runClutchCodeTask, type TaskUI } from "./runTask.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";

/**
 * Drives `runClutchCodeTask` (the extension's actual orchestration logic)
 * against a *real* `AgentRpcClient` talking to a *real* `Agent` over
 * PassThrough streams — the same round trip a spawned `clutchcode serve`
 * process would give it, just without the process boundary. Only the
 * VS Code UI is faked, which is the one part that genuinely can't run
 * outside an extension host.
 */
function fakeUI(approveDecision: "approve" | "reject" | "later" = "later"): TaskUI & {
  lines: string[];
  diffs: Array<{ runId: string; diffText: string }>;
  infos: string[];
  errors: string[];
} {
  const lines: string[] = [];
  const diffs: Array<{ runId: string; diffText: string }> = [];
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    diffs,
    infos,
    errors,
    showOutputLine: (line) => lines.push(line),
    showDiff: (runId, diffText) => diffs.push({ runId, diffText }),
    askApproveOrReject: async () => approveDecision,
    showInfo: (m) => infos.push(m),
    showError: (m) => errors.push(m)
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
    const ui = fakeUI("approve");
    await runClutchCodeTask(client, { task: "investigate", providerKind: "fake", model: "n/a" }, ui);

    expect(ui.lines.length).toBeGreaterThan(0);
    expect(ui.diffs).toHaveLength(1);
    expect(ui.infos.some((m) => m.includes("approved and committed"))).toBe(true);
    expect(ui.errors).toHaveLength(0);

    const status = await client.request<{ status: string } | null>("status");
    expect(status?.status).toBe("DONE");
  }, 30_000);

  it("rejects on request", async () => {
    const ui = fakeUI("reject");
    await runClutchCodeTask(client, { task: "investigate", providerKind: "fake", model: "n/a" }, ui);

    expect(ui.infos.some((m) => m.includes("rejected"))).toBe(true);
    const status = await client.request<{ status: string } | null>("status");
    expect(status?.status).toBe("CANCELLED");
  }, 30_000);

  it("leaves the run untouched when the user defers ('later')", async () => {
    const ui = fakeUI("later");
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
