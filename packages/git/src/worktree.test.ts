import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir, makeTempRepo } from "./test-helpers.js";
import { git } from "./git-exec.js";
import {
  approveRun,
  checkpoint,
  createRunWorktree,
  diffAgainstBase,
  discardRun,
  listCheckpoints,
  rollbackTo,
  type RunWorktree
} from "./worktree.js";

function installHook(repoPath: string, script: string): void {
  const hookPath = path.join(repoPath, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hookPath, script, { mode: 0o755 });
}

function installRejectingHook(repoPath: string): void {
  installHook(repoPath, "#!/bin/sh\nexit 1\n");
}

describe("worktree isolation (§13.1)", () => {
  let repoPath: string;
  let stateDir: string;
  let run: RunWorktree;

  beforeEach(() => {
    repoPath = makeTempRepo();
    stateDir = makeTempDir("clutchcode-git-test-state-");
    run = createRunWorktree({ repoPath, stateDir, runId: "run12345678", slug: "fix the bug!" });
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("creates an isolated worktree on its own branch, never touching the main tree", () => {
    expect(fs.existsSync(run.worktreePath)).toBe(true);
    expect(run.branch).toMatch(/^clutchcode\/run-run12345-fix-the-bug$/);

    // Edit inside the worktree.
    fs.writeFileSync(path.join(run.worktreePath, "README.md"), "changed\n", "utf8");

    // Main tree is untouched.
    expect(fs.readFileSync(path.join(repoPath, "README.md"), "utf8")).toBe("hello\n");
  });

  it("checkpoints and lists them in order, diffing worktree vs base", () => {
    fs.writeFileSync(path.join(run.worktreePath, "a.txt"), "first\n", "utf8");
    const c1 = checkpoint(run, "add a.txt");
    expect(c1).not.toBeNull();

    fs.writeFileSync(path.join(run.worktreePath, "b.txt"), "second\n", "utf8");
    const c2 = checkpoint(run, "add b.txt");
    expect(c2).not.toBeNull();
    expect(c2).not.toBe(c1);

    const checkpoints = listCheckpoints(run);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]!.message).toContain("add a.txt");
    expect(checkpoints[1]!.message).toContain("add b.txt");

    const diff = diffAgainstBase(run);
    expect(diff).toContain("a.txt");
    expect(diff).toContain("b.txt");
  });

  it("checkpoint returns null when there is nothing to commit", () => {
    expect(checkpoint(run, "no-op")).toBeNull();
  });

  it("rolls back to an earlier checkpoint, including removing untracked files added after it", () => {
    fs.writeFileSync(path.join(run.worktreePath, "keep.txt"), "keep me\n", "utf8");
    const c1 = checkpoint(run, "checkpoint 1")!;

    fs.writeFileSync(path.join(run.worktreePath, "discard.txt"), "discard me\n", "utf8");
    // Leave discard.txt untracked (no checkpoint after it), simulating a
    // half-finished step the model wants rolled back.

    rollbackTo(run, c1);

    expect(fs.existsSync(path.join(run.worktreePath, "keep.txt"))).toBe(true);
    expect(fs.existsSync(path.join(run.worktreePath, "discard.txt"))).toBe(false);
  });

  it("discardRun removes the worktree and its branch entirely", () => {
    checkpoint(run, "some change");
    discardRun(run);

    expect(fs.existsSync(run.worktreePath)).toBe(false);
    const branches = git(["branch", "--list", run.branch], { cwd: repoPath });
    expect(branches.trim()).toBe("");
  });

  it("approveRun merges the run branch into the currently checked out branch", () => {
    fs.writeFileSync(path.join(run.worktreePath, "feature.txt"), "new feature\n", "utf8");
    checkpoint(run, "add feature");

    const { mergedSha } = approveRun(run);
    expect(mergedSha).toBeTruthy();
    expect(fs.readFileSync(path.join(repoPath, "feature.txt"), "utf8")).toBe("new feature\n");
    expect(fs.existsSync(run.worktreePath)).toBe(false);
  });

  it("approveRun with squash is a graceful no-op when the run made no changes", () => {
    const before = git(["rev-parse", "HEAD"], { cwd: repoPath }).trim();
    expect(() => approveRun(run, { squash: true })).not.toThrow();
    const after = git(["rev-parse", "HEAD"], { cwd: repoPath }).trim();
    expect(after).toBe(before); // nothing to commit, HEAD unchanged
    expect(fs.existsSync(run.worktreePath)).toBe(false);
  });

  it("checkpoint commits bypass the user's pre-commit hook (§13.4)", () => {
    installRejectingHook(repoPath);

    fs.writeFileSync(path.join(run.worktreePath, "a.txt"), "first\n", "utf8");
    // Worktrees share hooks with the main repo's .git dir — this would
    // fail if `checkpoint()` didn't pass `--no-verify`.
    expect(checkpoint(run, "add a.txt")).not.toBeNull();
  });

  it("approveRun's final squash commit runs the user's pre-commit hook and fails loudly if it rejects (§13.4)", () => {
    installRejectingHook(repoPath);

    fs.writeFileSync(path.join(run.worktreePath, "a.txt"), "first\n", "utf8");
    checkpoint(run, "add a.txt"); // succeeds — checkpoints bypass the hook

    expect(() => approveRun(run, { squash: true })).toThrow();
    // The worktree is still there — approval genuinely failed, nothing was silently accepted.
    expect(fs.existsSync(run.worktreePath)).toBe(true);
  });

  it("approveRun's final squash commit actually invokes the user's pre-commit hook when it passes", () => {
    const marker = path.join(repoPath, "hook-ran.marker");
    installHook(repoPath, `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);

    fs.writeFileSync(path.join(run.worktreePath, "a.txt"), "first\n", "utf8");
    checkpoint(run, "add a.txt");
    approveRun(run, { squash: true });

    expect(fs.existsSync(marker)).toBe(true);
  });

  it("approveRun with squash produces a single commit on the target branch", () => {
    fs.writeFileSync(path.join(run.worktreePath, "x.txt"), "x\n", "utf8");
    checkpoint(run, "checkpoint 1");
    fs.writeFileSync(path.join(run.worktreePath, "y.txt"), "y\n", "utf8");
    checkpoint(run, "checkpoint 2");

    const before = git(["rev-list", "--count", "HEAD"], { cwd: repoPath }).trim();
    approveRun(run, { squash: true, message: "squashed feature" });
    const after = git(["rev-list", "--count", "HEAD"], { cwd: repoPath }).trim();

    expect(Number(after)).toBe(Number(before) + 1);
    expect(fs.readFileSync(path.join(repoPath, "x.txt"), "utf8")).toBe("x\n");
    expect(fs.readFileSync(path.join(repoPath, "y.txt"), "utf8")).toBe("y\n");
  });
});

describe("dirty working tree handling (§13.4)", () => {
  let repoPath: string;
  let stateDir: string;

  beforeEach(() => {
    repoPath = makeTempRepo();
    stateDir = makeTempDir("clutchcode-git-test-state-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("default strategy stashes user changes and bases the worktree on HEAD", () => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "dirty change\n", "utf8");

    const run = createRunWorktree({ repoPath, stateDir, runId: "dirtyrun1", slug: "task" });

    expect(run.dirtyTreeResult.wasDirty).toBe(true);
    expect(run.dirtyTreeResult.strategyUsed).toBe("stash");
    // The worktree is based on HEAD (pre-dirty-change), not the dirty content.
    expect(fs.readFileSync(path.join(run.worktreePath, "README.md"), "utf8")).toBe("hello\n");

    discardRun(run);
    // Stash was restored — the user's dirty change is back.
    expect(fs.readFileSync(path.join(repoPath, "README.md"), "utf8")).toBe("dirty change\n");
  });

  it("abort strategy throws and leaves the user's tree untouched", () => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "dirty change\n", "utf8");
    expect(() =>
      createRunWorktree({ repoPath, stateDir, runId: "dirtyrun2", slug: "task", dirtyTreeStrategy: "abort" })
    ).toThrow();
    expect(fs.readFileSync(path.join(repoPath, "README.md"), "utf8")).toBe("dirty change\n");
  });

  it("temp-commit strategy bases the worktree on the dirty state but leaves the user's tree still dirty", () => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "dirty change\n", "utf8");
    const run = createRunWorktree({
      repoPath,
      stateDir,
      runId: "dirtyrun3",
      slug: "task",
      dirtyTreeStrategy: "temp-commit"
    });

    expect(run.dirtyTreeResult.strategyUsed).toBe("temp-commit");
    expect(fs.readFileSync(path.join(run.worktreePath, "README.md"), "utf8")).toBe("dirty change\n");
    // The user's branch is left exactly as before — still dirty, not committed.
    const status = git(["status", "--porcelain"], { cwd: repoPath });
    expect(status.trim()).not.toBe("");
    expect(fs.readFileSync(path.join(repoPath, "README.md"), "utf8")).toBe("dirty change\n");
  });
});
