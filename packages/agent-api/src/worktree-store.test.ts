import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveRunBackend, loadRunBackendState } from "./worktree-store.js";
import type { RunBackendState } from "@clutchcode/runtime";

function fakeGitBackendState(runId: string): RunBackendState {
  return {
    kind: "git-worktree",
    runId,
    branch: "clutchcode/run-x",
    baseCommit: "deadbeef",
    worktreePath: "/tmp/nonexistent",
    repoPath: "/tmp/nonexistent-repo",
    dirtyTreeResult: { strategyUsed: "none" }
  } as RunBackendState;
}

function fakeSnapshotBackendState(runId: string): RunBackendState {
  return { kind: "snapshot", runId, workspaceRoot: "/tmp/nonexistent-ws", backupDir: "/tmp/nonexistent-backup" };
}

describe("worktree-store", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-worktree-store-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("round-trips a saved git-worktree RunBackendState", () => {
    saveRunBackend(stateDir, fakeGitBackendState("r1"));
    const loaded = loadRunBackendState(stateDir, "r1");
    expect(loaded?.kind).toBe("git-worktree");
    expect(loaded && "branch" in loaded ? loaded.branch : undefined).toBe("clutchcode/run-x");
  });

  it("round-trips a saved snapshot RunBackendState (§13.4)", () => {
    saveRunBackend(stateDir, fakeSnapshotBackendState("r2"));
    const loaded = loadRunBackendState(stateDir, "r2");
    expect(loaded?.kind).toBe("snapshot");
    expect(loaded && "workspaceRoot" in loaded ? loaded.workspaceRoot : undefined).toBe("/tmp/nonexistent-ws");
  });

  it("returns null when nothing was saved for that runId", () => {
    expect(loadRunBackendState(stateDir, "nope")).toBeNull();
  });

  it("rejects a path-traversal runId on save/load instead of writing/reading outside stateDir (real gap caught in round 3 of security review — this is the exact entry point `approve`/`reject`/`rollback`/`pr` resolve a caller-supplied runId through into real, sometimes destructive git/snapshot operations)", () => {
    const evil = "../../../../../../tmp/clutchcode-worktree-store-poc";
    expect(() => saveRunBackend(stateDir, fakeGitBackendState(evil))).toThrow(/invalid runId/);
    expect(() => loadRunBackendState(stateDir, evil)).toThrow(/invalid runId/);
    expect(fs.existsSync("/tmp/clutchcode-worktree-store-poc")).toBe(false);
  });
});
