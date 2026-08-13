import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent } from "./agent.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";
import { initRepo } from "./scaffold.js";

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

describe("AGENTS.md prose reaches the model (§10.1)", () => {
  function sseChunk(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  function startCapturingServer(): Promise<{ baseUrl: string; requests: string[]; close: () => Promise<void> }> {
    const requests: string[] = [];
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          requests.push(body);
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(sseChunk({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }));
          res.end("data: [DONE]\n\n");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
      });
    });
  }

  it("includes AGENTS.md conventions in the first request's system message", async () => {
    const repoPath = makeSampleRepo();
    const stateDir = makeTempDir("clutchcode-agentapi-memory-state-");
    const server = await startCapturingServer();
    try {
      fs.writeFileSync(path.join(repoPath, "AGENTS.md"), "## Conventions\n- this project uses tabs, not spaces\n", "utf8");
      execFileSync("git", ["add", "AGENTS.md"], { cwd: repoPath });
      execFileSync("git", ["commit", "-q", "-m", "add AGENTS.md"], { cwd: repoPath });

      const agent = new Agent(repoPath, stateDir);
      await agent.run({ task: "investigate", providerKind: "openai-compatible", model: "gpt-test", baseUrl: server.baseUrl, yesMode: true });

      expect(server.requests.length).toBeGreaterThan(0);
      const sent = JSON.parse(server.requests[0]!) as { messages: Array<{ role: string; content: string }> };
      expect(sent.messages[0]!.role).toBe("system");
      expect(sent.messages[0]!.content).toContain("this project uses tabs, not spaces");
    } finally {
      await server.close();
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("capability probe wiring (§4.9)", () => {
  function sseChunk(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  /** Always returns the same unhelpful reply — a deliberately "weak" model, which keeps the probe's context-probe stage to a single call (fails immediately). */
  function startDumbServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(sseChunk({ choices: [{ delta: { content: "I don't know." }, finish_reason: "stop" }] }));
          res.end("data: [DONE]\n\n");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
      });
    });
  }

  it("getCapabilityProfile is null before any probe has run", () => {
    const repoPath = makeSampleRepo();
    const stateDir = makeTempDir("clutchcode-agentapi-cap-state-");
    const configDir = makeTempDir("clutchcode-agentapi-cap-config-");
    try {
      const agent = new Agent(repoPath, stateDir, configDir);
      expect(agent.getCapabilityProfile("openai-compatible", "gpt-test")).toBeNull();
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("probeModel runs the probe, persists the profile, and getCapabilityProfile then finds it", async () => {
    const repoPath = makeSampleRepo();
    const stateDir = makeTempDir("clutchcode-agentapi-cap-state-");
    const configDir = makeTempDir("clutchcode-agentapi-cap-config-");
    const server = await startDumbServer();
    try {
      const agent = new Agent(repoPath, stateDir, configDir);
      const profile = await agent.probeModel(
        { providerKind: "openai-compatible", model: "dumb-model", baseUrl: server.baseUrl },
        { trials: 1 }
      );

      expect(profile.toolTransport).toBe("emulation"); // never emitted a native tool call or valid JSON
      expect(profile.diffAcc).toBe(0);

      const loaded = agent.getCapabilityProfile("openai-compatible", "dumb-model");
      expect(loaded).toEqual(profile);
    } finally {
      await server.close();
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  }, 30_000);
});
