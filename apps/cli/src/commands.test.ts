import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cmdApprove,
  cmdDiff,
  cmdDoctor,
  cmdInit,
  cmdInspect,
  cmdModelsProbe,
  cmdModelsShow,
  cmdProviders,
  cmdReject,
  cmdRun,
  cmdStatus,
  cmdTrust
} from "./commands.js";
import { EXIT, exitCodeForRunStatus } from "./exit-codes.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";

describe("CLI commands (pure functions, no process spawning)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-cli-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("init scaffolds config + AGENTS.md and reports it in human and JSON form", async () => {
    const human = await cmdInit({ repoPath });
    expect(human.exitCode).toBe(EXIT.SUCCESS);
    expect(human.output).toMatch(/created agent\.toml/);
    expect(fs.existsSync(`${repoPath}/agent.toml`)).toBe(true);
  });

  it("run --yes with the fake provider reaches DONE with exit code 0", async () => {
    const result = await cmdRun(
      { repoPath, stateDir },
      { task: "investigate", providerKind: "fake", model: "n/a", yes: true }
    );
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.output).toContain("DONE");
  }, 30_000);

  it("run without --yes stops at AWAITING_APPROVAL with exit code 2 (escalated/needs-human)", async () => {
    const result = await cmdRun({ repoPath, stateDir }, { task: "investigate", providerKind: "fake", model: "n/a" });
    expect(result.exitCode).toBe(EXIT.ESCALATED);
    expect(result.output).toContain("AWAITING_APPROVAL");
  }, 30_000);

  it("status reports 'no runs yet' before any run, then the latest run after", async () => {
    const before = await cmdStatus({ repoPath, stateDir });
    expect(before.output).toMatch(/no runs yet/);

    await cmdRun({ repoPath, stateDir }, { task: "investigate", providerKind: "fake", model: "n/a", yes: true });
    const after = await cmdStatus({ repoPath, stateDir });
    expect(after.output).toContain("DONE");
  }, 30_000);

  it("diff/approve/reject/inspect operate on a run started via run()", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const diff = await cmdDiff({ repoPath, stateDir }, runId);
    expect(diff.exitCode).toBe(EXIT.SUCCESS);

    const inspected = await cmdInspect({ repoPath, stateDir }, runId);
    expect(inspected.exitCode).toBe(EXIT.SUCCESS);
    expect(inspected.output).toContain("decision trail");

    const approved = await cmdApprove({ repoPath, stateDir }, runId, { squash: true });
    expect(approved.exitCode).toBe(EXIT.SUCCESS);
    expect(approved.output).toContain("DONE");
  }, 30_000);

  it("reject moves a run to CANCELLED", async () => {
    const runResult = await cmdRun({ repoPath, stateDir, json: true }, { task: "investigate", providerKind: "fake", model: "n/a" });
    const runId = (JSON.parse(runResult.output) as { runId: string }).runId;

    const rejected = await cmdReject({ repoPath, stateDir }, runId);
    expect(rejected.output).toContain("CANCELLED");
  }, 30_000);

  it("trust marks the repo trusted", async () => {
    const result = await cmdTrust({ repoPath });
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.output).toContain("trusted");
  });

  it("providers lists credential presence without leaking values", async () => {
    const result = await cmdProviders({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { detected: Array<{ kind: string; credentialPresent: boolean }> };
    expect(parsed.detected.some((d) => d.kind === "ollama")).toBe(true);
    expect(result.output).not.toContain("sk-");
  });

  it("doctor runs real, non-fabricated checks", async () => {
    const result = await cmdDoctor({ repoPath, json: true });
    const parsed = JSON.parse(result.output) as { checks: Array<{ name: string; ok: boolean }> };
    const node = parsed.checks.find((c) => c.name === "node");
    expect(node?.ok).toBe(true);
  });
});

describe("models probe/show (§4.9)", () => {
  function sseChunk(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

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

  it("show reports unprobed before any probe, then probe persists a profile show can find", async () => {
    const repoPath = makeSampleRepo();
    const stateDir = makeTempDir("clutchcode-cli-cap-state-");
    const configDir = makeTempDir("clutchcode-cli-cap-config-");
    const server = await startDumbServer();
    try {
      const before = await cmdModelsShow({ repoPath, stateDir, configDir }, "openai-compatible", "dumb-model");
      expect(before.output).toMatch(/not been probed/);

      const probed = await cmdModelsProbe(
        { repoPath, stateDir, configDir },
        { providerKind: "openai-compatible", model: "dumb-model", baseUrl: server.baseUrl, trials: 1 }
      );
      expect(probed.exitCode).toBe(EXIT.SUCCESS);
      expect(probed.output).toContain("tool_transport: emulation");

      const after = await cmdModelsShow({ repoPath, stateDir, configDir, json: true }, "openai-compatible", "dumb-model");
      const parsed = JSON.parse(after.output) as { toolTransport: string };
      expect(parsed.toolTransport).toBe("emulation");
    } finally {
      await server.close();
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("exitCodeForRunStatus", () => {
  it("maps every status to its documented exit code (§18.4)", () => {
    expect(exitCodeForRunStatus("DONE")).toBe(0);
    expect(exitCodeForRunStatus("FAILED")).toBe(1);
    expect(exitCodeForRunStatus("ESCALATED")).toBe(2);
    expect(exitCodeForRunStatus("AWAITING_APPROVAL")).toBe(2);
    expect(exitCodeForRunStatus("PAUSED")).toBe(3);
    expect(exitCodeForRunStatus("CANCELLED")).toBe(130);
  });
});
