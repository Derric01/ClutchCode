import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Denylist, PolicyEngine, Redactor } from "@clutchcode/sandbox";
import { nativeToolSet, type Tool, type ToolContext } from "@clutchcode/tools";
import { createRunWorktree, type RunWorktree } from "@clutchcode/git";
import { detectToolchain, type ToolchainCommands } from "@clutchcode/verification";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A tiny, deliberately buggy Node "project" used across AgentLoop tests: a
 * source file with a one-line bug and a test that catches it via a real
 * `assert()` call, wired up with `npm test` so the verification pipeline
 * (§14) exercises real subprocess execution, not a mock.
 */
export function makeBuggyNodeRepo(): string {
  const dir = makeTempDir("clutchcode-agentloop-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node math.test.js" } }, null, 2), "utf8");
  fs.writeFileSync(
    path.join(dir, "math.js"),
    ["// TODO: fix the implementation", "function add(a, b) {", "  return a - b;", "}", "module.exports = { add };", ""].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "math.test.js"),
    ["const assert = require('assert');", "const { add } = require('./math.js');", "", "assert(add(2, 3) === 5, 'expected 5');", "console.log('PASS');", ""].join(
      "\n"
    ),
    "utf8"
  );

  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial buggy commit"]);
  return dir;
}

export interface AgentLoopTestFixture {
  repoPath: string;
  stateDir: string;
  run: RunWorktree;
  tools: Map<string, Tool<unknown, unknown>>;
  toolContext: ToolContext;
  toolchainCommands: ToolchainCommands;
  evidenceDir: string;
  cleanup(): void;
}

export function setupAgentLoopFixture(runId = "run00000001"): AgentLoopTestFixture {
  const repoPath = makeBuggyNodeRepo();
  const stateDir = makeTempDir("clutchcode-agentloop-state-");
  const evidenceDir = makeTempDir("clutchcode-agentloop-evidence-");

  const run = createRunWorktree({ repoPath, stateDir, runId, slug: "fix-add" });
  const toolchainCommands = detectToolchain(run.worktreePath);

  const toolContext: ToolContext = {
    workspaceRoot: run.worktreePath,
    evidenceDir,
    policy: new PolicyEngine(),
    denylist: new Denylist(),
    redactor: new Redactor(),
    repoTrustMode: "trusted",
    networkAllowlist: [],
    submodulePaths: [],
    lfsPatterns: []
  };

  return {
    repoPath,
    stateDir,
    run,
    tools: nativeToolSet(),
    toolContext,
    toolchainCommands,
    evidenceDir,
    cleanup() {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  };
}
