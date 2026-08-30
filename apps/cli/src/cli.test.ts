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

function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [cliEntry, ...args], { cwd, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env });
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

  // `agent workflow` (§18.2). The variadic `[files...]` argument and the
  // subcommand wiring only ever run through real argv parsing — calling
  // cmdWorkflowList/Validate directly bypasses commander entirely, so
  // these spawn the real binary the way the --max-steps tests above do.
  it("`workflow list` lists the built-ins through real argv parsing", () => {
    const repoPath = makeSampleRepo();
    try {
      const result = runCli(["workflow", "list", "--repo", repoPath, "--json"], repoPath);
      expect(result.status).toBe(0);
      const entries = JSON.parse(result.stdout) as { id: string; kind: string }[];
      expect(entries.map((e) => e.id)).toEqual(["default", "quickfix", "review-only"]);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  it("`workflow` with no subcommand lists too, rather than erroring", () => {
    const repoPath = makeSampleRepo();
    try {
      const result = runCli(["workflow", "--repo", repoPath, "--json"], repoPath);
      expect(result.status).toBe(0);
      expect((JSON.parse(result.stdout) as { id: string }[]).map((e) => e.id)).toContain("review-only");
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  it("`workflow list <file>...` accepts variadic declaration paths and folds them into the listing", () => {
    const repoPath = makeSampleRepo();
    try {
      const a = path.join(repoPath, "a.json");
      const b = path.join(repoPath, "b.json");
      fs.writeFileSync(a, JSON.stringify({ apiVersion: "clutchcode/v1", id: "cust-a", name: "A", stages: [{ id: "i", uses: "implement", params: { readonly: true } }] }), "utf8");
      fs.writeFileSync(b, JSON.stringify({ apiVersion: "clutchcode/v1", id: "cust-b", name: "B", stages: [{ id: "i", uses: "implement" }, { id: "v", uses: "verify" }] }), "utf8");

      const result = runCli(["workflow", "list", a, b, "--repo", repoPath, "--json"], repoPath);
      expect(result.status).toBe(0);
      const entries = JSON.parse(result.stdout) as { id: string; kind: string }[];
      expect(entries.map((e) => e.id)).toEqual(["default", "quickfix", "review-only", "cust-a", "cust-b"]);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  it("`workflow validate` exits 4 on an invalid file and 0 on a valid one (§18.4 exit codes, through the real binary)", () => {
    const repoPath = makeSampleRepo();
    try {
      const bad = path.join(repoPath, "bad.json");
      fs.writeFileSync(bad, JSON.stringify({ apiVersion: "clutchcode/v1", id: "bad", name: "Bad", stages: [{ id: "i", uses: "implement" }] }), "utf8");
      const badResult = runCli(["workflow", "validate", bad, "--repo", repoPath], repoPath);
      expect(badResult.status).toBe(4);
      expect(badResult.stderr).toMatch(/needs a "verify" stage too/);

      const good = path.join(repoPath, "good.json");
      fs.writeFileSync(good, JSON.stringify({ apiVersion: "clutchcode/v1", id: "good", name: "Good", stages: [{ id: "i", uses: "implement", params: { readonly: true } }] }), "utf8");
      const goodResult = runCli(["workflow", "validate", good, "--repo", repoPath], repoPath);
      expect(goodResult.status).toBe(0);
      expect(goodResult.stdout).toMatch(/planMode=never readonly=true/);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  }, 15_000);

  /**
   * Real bug, reproduced against this binary before it was fixed: a
   * subcommand that re-declares an option its parent also declares never
   * sees the parsed value — commander (v15) stores it on the parent, and
   * the subcommand's `opts()` keeps its declared default. Every
   * `memory`/`providers` subcommand did exactly that.
   *
   * `--repo` is the damaging half: `memory correct` wrote the corrected
   * fact into the *current directory's* repo instead of the one named,
   * and reported success. `--json` is the contract half (§18.4). Both are
   * pinned here through the real binary, because this only manifests
   * through real argv parsing.
   *
   * `HOME` is redirected per-run so the memory store (`~/.config/
   * clutchcode/memory`) is a throwaway dir rather than the developer's.
   */
  it("`memory correct --repo <other>` writes to the repo named, not the cwd repo (real bug: a subcommand's option shadowed by its parent's)", () => {
    const cwdRepo = makeSampleRepo();
    const targetRepo = makeSampleRepo();
    const fakeHome = makeTempDir("clutchcode-cli-home-");
    const env = { HOME: fakeHome };
    try {
      const corrected = runCli(["memory", "correct", "test", "vitest run", "--repo", targetRepo], cwdRepo, env);
      expect(corrected.status).toBe(0);

      // The named repo got it...
      const target = runCli(["memory", "--repo", targetRepo, "--json"], cwdRepo, env);
      expect(JSON.parse(target.stdout).facts.test.value).toBe("vitest run");

      // ...and the cwd repo did not. Pre-fix this was inverted: the fact
      // landed here and `targetRepo` came back `null`.
      const cwdMemory = runCli(["memory", "--repo", cwdRepo, "--json"], cwdRepo, env);
      const parsed = JSON.parse(cwdMemory.stdout) as { facts?: Record<string, unknown> } | null;
      expect(parsed?.facts?.test).toBeUndefined();
    } finally {
      for (const d of [cwdRepo, targetRepo, fakeHome]) fs.rmSync(d, { recursive: true, force: true });
    }
  }, 20_000);

  it("`memory list --json` emits JSON, not prose (§18.4: --json always prints machine-readable output)", () => {
    const repoPath = makeSampleRepo();
    const fakeHome = makeTempDir("clutchcode-cli-home-");
    const env = { HOME: fakeHome };
    try {
      runCli(["memory", "correct", "build", "npm run build", "--repo", repoPath], repoPath, env);
      const listed = runCli(["memory", "list", "--repo", repoPath, "--json"], repoPath, env);
      expect(listed.status).toBe(0);
      // Pre-fix this printed "manifest hash: …" prose and JSON.parse threw.
      expect(JSON.parse(listed.stdout).facts.build.value).toBe("npm run build");
    } finally {
      for (const d of [repoPath, fakeHome]) fs.rmSync(d, { recursive: true, force: true });
    }
  }, 20_000);
});
