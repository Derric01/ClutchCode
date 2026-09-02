import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { loadSuite } from "./eval-task.js";
import { selectTasks } from "./eval-cli.js";
import { readScoreboardHistory } from "./scoreboard-store.js";
import { makeTempDir } from "./fixture-repo.js";

/**
 * Spawns the *real*, compiled `clutchcode-eval` binary as an actual child
 * process — same convention as `apps/cli/src/cli.test.ts`, and for the
 * same reason: a commander tree's argv parsing, defaults and `--json`
 * contract only ever really run through real argv parsing. Requires
 * `evals` to have been built (`tsc -b`), like the rest of this monorepo's
 * test run.
 */
const evalEntry = path.resolve(import.meta.dirname, "..", "dist", "eval-bin.js");

function runEvalCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  try {
    // Explicit `stdio` array, per this repo's own documented gotcha:
    // `execFileSync` forwards the child's stderr to the parent console
    // unless told otherwise, so a test that *expects* a failure would
    // print its error message into every test run. `err.stderr` is still
    // fully populated with the array form.
    const stdout = execFileSync("node", [evalEntry, ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 20_000_000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status ?? 1 };
  }
}

describe("selectTasks", () => {
  const all = loadSuite();

  it("returns the whole suite when no ids are given", () => {
    expect(selectTasks(all, [])).toHaveLength(all.length);
  });

  it("returns the named tasks in the order asked for", () => {
    expect(selectTasks(all, ["node-feature-slugify", "node-bugfix-duration"]).map((t) => t.id)).toEqual([
      "node-feature-slugify",
      "node-bugfix-duration"
    ]);
  });

  it("fails loudly on an unknown task id instead of silently running fewer tasks", () => {
    expect(() => selectTasks(all, ["no-such-task"])).toThrow(/no such eval task/);
  });
});

describe.skipIf(!fs.existsSync(evalEntry))("clutchcode-eval CLI (spawns the real binary)", () => {
  it("lists the suite as JSON", () => {
    const result = runEvalCli(["list", "--json"], process.cwd());
    expect(result.status).toBe(0);
    const listed = JSON.parse(result.stdout) as Array<{ id: string; category: string }>;
    expect(listed.map((t) => t.id)).toContain("node-bugfix-duration");
    expect(listed.every((t) => typeof t.category === "string")).toBe(true);
  }, 30_000);

  it("runs a task end to end, prints the board, and appends to the JSONL history", () => {
    // `--provider fake` is the built-in no-op provider (`buildProvider`
    // returns a single "dry run" text turn), so this is a real, fully
    // deterministic end-to-end pass with no network and no model: the
    // agent changes nothing, the already-green fixture's gate passes, and
    // the held-out oracle correctly refuses to call that a solution. A
    // board that scored this 100% would be broken.
    const out = makeTempDir("clutchcode-eval-cli-out-");
    try {
      const result = runEvalCli(["run", "--provider", "fake", "--task", "node-feature-slugify", "--out", out, "--json"], process.cwd());
      expect(result.status).toBe(0);

      const board = JSON.parse(result.stdout) as { vtcr: number; taskCount: number; claimedDoneRate: number; falseCompletionRate: number };
      expect(board.taskCount).toBe(1);
      expect(board.vtcr).toBe(0);
      expect(board.falseCompletionRate).toBe(1);

      const history = readScoreboardHistory(out);
      expect(history).toHaveLength(1);
      expect(history[0]!.vtcr).toBe(0);
      expect(fs.existsSync(path.join(out, history[0]!.file))).toBe(true);

      const printed = runEvalCli(["history", out], process.cwd());
      expect(printed.status).toBe(0);
      expect(printed.stdout).toMatch(/VTCR 0\.0%/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("fails loudly on an unknown --task instead of scoring an empty board", () => {
    const result = runEvalCli(["run", "--task", "not-a-real-task", "--provider", "fake"], process.cwd());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no such eval task/);
  }, 30_000);
});
