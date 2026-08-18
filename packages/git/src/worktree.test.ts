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
  diffFilesAgainstBase,
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

describe("diffFilesAgainstBase (§18.5 native two-sided diff view data layer)", () => {
  let repoPath: string;
  let stateDir: string;
  let run: RunWorktree;

  beforeEach(() => {
    repoPath = makeTempRepo();
    stateDir = makeTempDir("clutchcode-git-test-state-");
    run = createRunWorktree({ repoPath, stateDir, runId: "run87654321", slug: "diff files" });
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("returns [] when nothing changed", () => {
    expect(diffFilesAgainstBase(run)).toEqual([]);
  });

  it("reports an added file with only 'after' content", () => {
    fs.writeFileSync(path.join(run.worktreePath, "new.txt"), "brand new\n", "utf8");
    const files = diffFilesAgainstBase(run);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ path: "new.txt", status: "added", oldPath: undefined, before: undefined, after: "brand new\n", binary: false });
  });

  it("reports a modified file with both 'before' and 'after' content", () => {
    fs.writeFileSync(path.join(run.worktreePath, "README.md"), "hello, edited\n", "utf8");
    const files = diffFilesAgainstBase(run);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("modified");
    expect(files[0]!.before).toBe("hello\n");
    expect(files[0]!.after).toBe("hello, edited\n");
    expect(files[0]!.binary).toBe(false);
  });

  it("reports a deleted file with only 'before' content", () => {
    fs.rmSync(path.join(run.worktreePath, "README.md"));
    const files = diffFilesAgainstBase(run);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ path: "README.md", status: "deleted", oldPath: undefined, before: "hello\n", after: undefined, binary: false });
  });

  it("reports a rename with oldPath set and content read from the new location", () => {
    fs.renameSync(path.join(run.worktreePath, "README.md"), path.join(run.worktreePath, "RENAMED.md"));
    const files = diffFilesAgainstBase(run);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("renamed");
    expect(files[0]!.oldPath).toBe("README.md");
    expect(files[0]!.path).toBe("RENAMED.md");
    expect(files[0]!.before).toBe("hello\n");
    expect(files[0]!.after).toBe("hello\n");
  });

  it("flags a renamed binary file as binary too — numstat combines the two paths into one string for a rename, which must not defeat the binary check", () => {
    // The binary file must already be part of the *base* commit (not added
    // mid-run) — diffFilesAgainstBase always diffs against run.baseCommit,
    // so a file that never existed at base can only ever look "added",
    // never "renamed", no matter what happens to it afterward.
    const binRepoPath = makeTempRepo();
    const binStateDir = makeTempDir("clutchcode-git-test-state-");
    const original = Buffer.alloc(1000, 0);
    original[0] = 0x00;
    original[1] = 0xff;
    fs.writeFileSync(path.join(binRepoPath, "logo.png"), original);
    git(["add", "-A"], { cwd: binRepoPath });
    git(["commit", "-q", "-m", "add binary"], { cwd: binRepoPath });

    const binRun = createRunWorktree({ repoPath: binRepoPath, stateDir: binStateDir, runId: "run11111111", slug: "rename binary" });
    try {
      // A handful of changed bytes (not a full rewrite) keeps git's
      // rename-similarity heuristic above its default threshold, so this
      // is still detected as a rename — not an unrelated delete+add pair —
      // while still having a real (binary) content diff to flag.
      fs.renameSync(path.join(binRun.worktreePath, "logo.png"), path.join(binRun.worktreePath, "logo2.png"));
      const changed = Buffer.from(original);
      changed[500] = 0x42;
      fs.writeFileSync(path.join(binRun.worktreePath, "logo2.png"), changed);

      const files = diffFilesAgainstBase(binRun);
      expect(files).toHaveLength(1);
      expect(files[0]!.status).toBe("renamed");
      expect(files[0]!.oldPath).toBe("logo.png");
      expect(files[0]!.path).toBe("logo2.png");
      expect(files[0]!.binary).toBe(true);
      expect(files[0]!.before).toBeUndefined();
      expect(files[0]!.after).toBeUndefined();
    } finally {
      fs.rmSync(binRepoPath, { recursive: true, force: true });
      fs.rmSync(binStateDir, { recursive: true, force: true });
    }
  });

  it("flags a binary file and omits its before/after content instead of returning mojibake", () => {
    // A null byte is git's own signal for "treat as binary" — the same
    // thing that makes `git diff` print "Binary files differ" instead of a
    // text hunk.
    fs.writeFileSync(path.join(run.worktreePath, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const files = diffFilesAgainstBase(run);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("blob.bin");
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.binary).toBe(true);
    expect(files[0]!.before).toBeUndefined();
    expect(files[0]!.after).toBeUndefined();
  });

  it("reports multiple changed files together, and pathScope filters to a subdir", () => {
    fs.mkdirSync(path.join(run.worktreePath, "sub"), { recursive: true });
    fs.writeFileSync(path.join(run.worktreePath, "sub", "in-scope.txt"), "in scope\n", "utf8");
    fs.writeFileSync(path.join(run.worktreePath, "out-of-scope.txt"), "out of scope\n", "utf8");

    const all = diffFilesAgainstBase(run);
    expect(all.map((f) => f.path).sort()).toEqual(["out-of-scope.txt", "sub/in-scope.txt"]);

    const scoped = diffFilesAgainstBase(run, "sub");
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.path).toBe("sub/in-scope.txt");
  });
});
