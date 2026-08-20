import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { makeTempDir, makeSampleRepo } from "./test-helpers.js";

/**
 * Spawns the *real*, compiled `clutchcode` CLI binary as an actual child
 * process — the same mechanism `apps/vscode/src/connection.test.ts` uses
 * for `serve`, applied here to argv-parsing behavior specifically (a
 * custom commander option parser, like the ones fixed below, only ever
 * actually runs through real argv parsing — calling the exported command
 * functions directly bypasses it entirely). Requires `apps/cli` to have
 * been built (`tsc -b`) first, same as the rest of this monorepo's test
 * run.
 */
const cliEntry = path.resolve(import.meta.dirname, "..", "dist", "cli.js");

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [cliEntry, ...args], { cwd, encoding: "utf8" });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status ?? 1 };
  }
}

describe.skipIf(!fs.existsSync(cliEntry))("clutchcode CLI argv parsing (spawns the real binary)", () => {
  it("rejects a malformed --max-steps value instead of silently disabling the step budget with NaN (real bug caught in round 3 of security review)", () => {
    const repoPath = makeSampleRepo();
    try {
      const result = runCli(["run", "investigate", "--repo", repoPath, "--provider", "fake", "--max-steps", "five"], repoPath);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not a valid integer/);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  it("rejects a malformed --cost-ceiling-usd value the same way", () => {
    const repoPath = makeSampleRepo();
    try {
      const result = runCli(["run", "investigate", "--repo", repoPath, "--provider", "fake", "--cost-ceiling-usd", "not-a-number"], repoPath);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not a valid number/);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  it("a well-formed --max-steps value is still accepted normally (not a false-positive rejection)", () => {
    const repoPath = makeSampleRepo();
    const stateDir = makeTempDir("clutchcode-cli-test-state-");
    try {
      const result = runCli(
        ["run", "investigate", "--repo", repoPath, "--state-dir", stateDir, "--provider", "fake", "--max-steps", "3", "--yes", "--json"],
        repoPath
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).status).toBe("DONE");
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("accepts --no-squash as a valid flag on `approve` instead of erroring with 'unknown option' (real bug caught in round 3 of security review — a plain --squash boolean defaulting to true had no --no-squash counterpart, so ApproveOptions.squash === false could never be reached from the CLI)", () => {
    const repoPath = makeSampleRepo();
    const stateDir = makeTempDir("clutchcode-cli-test-state-");
    try {
      const result = runCli(["approve", "no-such-run-id", "--repo", repoPath, "--state-dir", stateDir, "--no-squash", "--json"], repoPath);
      // The flag itself must parse cleanly — the command then fails for an
      // unrelated, expected reason (no such run), not "unknown option".
      expect(result.stderr).not.toMatch(/unknown option/i);
      expect(result.stdout + result.stderr).toMatch(/no such run/i);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }, 15_000);
});
