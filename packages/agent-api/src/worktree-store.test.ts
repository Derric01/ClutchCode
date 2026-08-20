import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRunWorktree, saveRunWorktree } from "./worktree-store.js";
import type { RunWorktree } from "@clutchcode/git";

function fakeRunWorktree(runId: string): RunWorktree {
  return {
    runId,
    branch: "clutchcode/run-x",
    baseCommit: "deadbeef",
    worktreePath: "/tmp/nonexistent",
    repoPath: "/tmp/nonexistent-repo",
    dirtyTreeResult: { strategyUsed: "none" }
  } as RunWorktree;
}

describe("worktree-store", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-worktree-store-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("round-trips a saved RunWorktree", () => {
    saveRunWorktree(stateDir, fakeRunWorktree("r1"));
    const loaded = loadRunWorktree(stateDir, "r1");
    expect(loaded?.branch).toBe("clutchcode/run-x");
  });

  it("returns null when nothing was saved for that runId", () => {
    expect(loadRunWorktree(stateDir, "nope")).toBeNull();
  });

  it("rejects a path-traversal runId on save/load instead of writing/reading outside stateDir (real gap caught in round 3 of security review — this is the exact entry point `approve`/`reject`/`rollback`/`pr` resolve a caller-supplied runId through into real, sometimes destructive git operations)", () => {
    const evil = "../../../../../../tmp/clutchcode-worktree-store-poc";
    expect(() => saveRunWorktree(stateDir, fakeRunWorktree(evil))).toThrow(/invalid runId/);
    expect(() => loadRunWorktree(stateDir, evil)).toThrow(/invalid runId/);
    expect(fs.existsSync("/tmp/clutchcode-worktree-store-poc")).toBe(false);
  });
});
