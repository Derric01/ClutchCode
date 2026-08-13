import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/**
 * The Phase 1 "first dogfooding milestone" (PROJECT_SPEC.md §25): fix a real
 * bug on a sample repo end-to-end — verified and committed — driven through
 * the actual SHIPPED `clutchcode` binary (spawned as a separate OS process,
 * not just its exported functions), against a scripted local
 * OpenAI-compatible server standing in for a real provider. This is the
 * cross-package integration test named in the repo structure (§20).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI_ENTRY = path.join(REPO_ROOT, "apps", "cli", "dist", "cli.js");

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeBuggyRepo(): string {
  const dir = makeTempDir("clutchcode-e2e-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "e2e@example.com"]);
  git(dir, ["config", "user.name", "E2E"]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "e2e-fixture", scripts: { test: "node math.test.js" } }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "math.js"), ["function add(a, b) {", "  return a - b;", "}", "module.exports = { add };", ""].join("\n"), "utf8");
  fs.writeFileSync(
    path.join(dir, "math.test.js"),
    ["const assert = require('assert');", "const { add } = require('./math.js');", "assert(add(2, 3) === 5, 'expected 5');", "console.log('PASS');", ""].join(
      "\n"
    ),
    "utf8"
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial buggy commit"]);
  return dir;
}

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** A local, scripted OpenAI-compatible server: turn 1 fixes the bug, turn 2 says it's done. */
function startFixItServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let call = 0;
  const fixArgs = JSON.stringify({ path: "math.js", edits: [{ search: "return a - b;", replace: "return a + b;" }] });
  const responses = [
    [
      sseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "edit_file", arguments: fixArgs } }] } }] }),
      sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 12, completion_tokens: 8 } }),
      "data: [DONE]\n\n"
    ],
    [sseChunk({ choices: [{ delta: { content: "Fixed add() to add instead of subtract." }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
  ];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const chunks = responses[Math.min(call, responses.length - 1)]!;
        call += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const c of chunks) res.write(c);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe("end-to-end: `clutchcode` CLI binary fixes a real bug on a sample repo", () => {
  let repoPath: string;
  let stateDir: string;
  let server: { baseUrl: string; close: () => Promise<void> };

  beforeAll(() => {
    // Ensure the shipped binary is up to date with the current source (fast, incremental).
    execFileSync("npx", ["tsc", "-b", "apps/cli"], { cwd: REPO_ROOT, stdio: "inherit" });
    expect(fs.existsSync(CLI_ENTRY)).toBe(true);
  }, 60_000);

  beforeEach(async () => {
    repoPath = makeBuggyRepo();
    stateDir = makeTempDir("clutchcode-e2e-state-");
    server = await startFixItServer();
  });

  afterEach(async () => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    await server.close();
  });

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execFileAsync("node", [CLI_ENTRY, ...args, "--repo", repoPath, "--json", "--state-dir", stateDir]);
      return { stdout, stderr, exitCode: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? 1 };
    }
  }

  it("init → run (fixes the bug, verified) → diff → approve → the repo has the fix committed", async () => {
    const init = await runCli(["init"]);
    expect(init.exitCode).toBe(0);
    expect(fs.existsSync(path.join(repoPath, "agent.toml"))).toBe(true);

    const run = await runCli(["run", "fix add() to add instead of subtract", "--provider", "openai-compatible", "--model", "gpt-test", "--base-url", server.baseUrl]);
    expect(run.exitCode).toBe(2); // AWAITING_APPROVAL (no --yes): §18.4 exit code 2 = escalated/needs-human
    const runState = JSON.parse(run.stdout) as { runId: string; status: string; verificationResults: Array<{ allGreen: boolean }> };
    expect(runState.status).toBe("AWAITING_APPROVAL");
    expect(runState.verificationResults[0]!.allGreen).toBe(true);

    // The fix is verified but not yet in the user's repo — worktree isolation (§13.1) held.
    expect(fs.readFileSync(path.join(repoPath, "math.js"), "utf8")).toContain("return a - b;");

    const diff = await runCli(["diff", runState.runId]);
    expect(diff.exitCode).toBe(0);
    const diffPayload = JSON.parse(diff.stdout) as { diff: string };
    expect(diffPayload.diff).toContain("-  return a - b;");
    expect(diffPayload.diff).toContain("+  return a + b;");

    const approve = await runCli(["approve", runState.runId]);
    expect(approve.exitCode).toBe(0);
    const approved = JSON.parse(approve.stdout) as { status: string };
    expect(approved.status).toBe("DONE");

    // Now the fix is really in the user's repo, committed.
    expect(fs.readFileSync(path.join(repoPath, "math.js"), "utf8")).toContain("return a + b;");
    const log = execFileSync("git", ["log", "--oneline", "-1"], { cwd: repoPath, encoding: "utf8" });
    expect(log.trim().length).toBeGreaterThan(0);
  }, 30_000);
});
