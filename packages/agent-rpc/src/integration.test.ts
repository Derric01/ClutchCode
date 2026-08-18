import fs from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRpcClient, type AgentRpcClient } from "./client.js";
import { serveAgentRpc, type AgentRpcServerHandle } from "./server.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";

/**
 * The whole point of this package: prove the client↔server round trip
 * actually works over a byte stream, driving a *real* `Agent` — not just
 * that the pieces compile. `toServer`/`toClient` are the same shape a
 * spawned child process's stdio pipes would be; nothing here is mocked
 * except the process boundary itself.
 */
describe("agent-rpc client↔server round trip (§18.1/§18.5)", () => {
  let repoPath: string;
  let stateDir: string;
  let client: AgentRpcClient;
  let server: AgentRpcServerHandle;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-agentrpc-state-");

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

  it("run over RPC reaches DONE, identical to the in-process Agent API", async () => {
    const result = await client.request<{ status: string; runId: string }>("run", {
      task: "investigate",
      providerKind: "fake",
      model: "n/a",
      yesMode: true
    });
    expect(result.status).toBe("DONE");
    expect(typeof result.runId).toBe("string");
  }, 30_000);

  it("streams RuntimeEvents as clutchcode/event notifications during a run", async () => {
    const events: Array<{ runId: string; event: { type: string } }> = [];
    client.onNotification((method, params) => {
      if (method === "clutchcode/event") events.push(params as { runId: string; event: { type: string } });
    });

    const result = await client.request<{ runId: string }>("run", { task: "investigate", providerKind: "fake", model: "n/a", yesMode: true });

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.runId === result.runId)).toBe(true);
    expect(events.some((e) => e.event.type === "run.end")).toBe(true);
  }, 30_000);

  it("status/diff/approve/reject/inspect/checkpoints all work over RPC", async () => {
    const run = await client.request<{ runId: string; status: string }>("run", { task: "investigate", providerKind: "fake", model: "n/a" });
    expect(run.status).toBe("AWAITING_APPROVAL");

    const status = await client.request<{ runId: string } | null>("status");
    expect(status?.runId).toBe(run.runId);

    const diff = await client.request<{ diff: string }>("diff", { runId: run.runId });
    expect(typeof diff.diff).toBe("string");

    const inspected = await client.request<{ state: { runId: string }; events: unknown[] }>("inspect", { runId: run.runId });
    expect(inspected.state.runId).toBe(run.runId);
    expect(Array.isArray(inspected.events)).toBe(true);

    const checkpoints = await client.request<unknown[]>("checkpoints", { runId: run.runId });
    expect(Array.isArray(checkpoints)).toBe(true);

    const approved = await client.request<{ status: string }>("approve", { runId: run.runId, squash: true });
    expect(approved.status).toBe("DONE");
  }, 30_000);

  it("reject over RPC moves a run to CANCELLED", async () => {
    const run = await client.request<{ runId: string }>("run", { task: "investigate", providerKind: "fake", model: "n/a" });
    const rejected = await client.request<{ status: string }>("reject", { runId: run.runId });
    expect(rejected.status).toBe("CANCELLED");
  }, 30_000);

  it("an Agent error (unknown run id) arrives as a rejected request, not a dropped connection", async () => {
    await expect(client.request("diff", { runId: "does-not-exist" })).rejects.toThrow(/no worktree metadata/);
    // The connection survives the error — a second, valid request still works.
    const status = await client.request("status");
    expect(status).toBeNull();
  }, 30_000);

  it("a missing runId param is a clear client-side error, not a crash", async () => {
    await expect(client.request("diff", {})).rejects.toThrow(/runId is required/);
  });

  it("an unknown method is a clear method-not-found error", async () => {
    await expect(client.request("no-such-method", {})).rejects.toThrow(/method not found/);
  });
});
