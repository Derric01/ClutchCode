import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git, GitError, isGitRepo } from "./git-exec.js";

/**
 * Real bug, found while capturing genuine CLI output for the README: on any
 * repo without an `AGENTS.md`, `git(["show", "<sha>:AGENTS.md"], {
 * allowFailure: true })` printed `fatal: path 'AGENTS.md' does not exist in
 * '<sha>'` straight to the console — the literal first thing a new user saw
 * running `clutchcode run`. Root cause: `execFileSync`'s documented quirk
 * that stderr is forwarded live to the parent process's stderr unless
 * `stdio` is passed as an *explicit* array, even though the default `stdio`
 * value is itself `'pipe'` — the same gotcha already fixed for the keychain
 * wrappers (`keychain-linux.ts`). Fixed by explicitly piping stderr (still
 * captured into `err.stderr` for `GitError`'s message, unchanged) instead of
 * leaving it on the implicit default that also echoes it live.
 */
describe("git()", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-git-exec-test-"));
    execFileSync("git", ["init", "-q", "."], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("allowFailure:true swallows a real git error and returns an empty string", () => {
    const out = git(["show", "HEAD:NOPE.md"], { cwd: repo, allowFailure: true });
    expect(out).toBe("");
  });

  it("without allowFailure, a real git error still throws GitError with the full stderr captured (the fix must not blind error reporting for every other caller)", () => {
    expect(() => git(["show", "HEAD:NOPE.md"], { cwd: repo })).toThrow(GitError);
    try {
      git(["show", "HEAD:NOPE.md"], { cwd: repo });
      expect.unreachable("git() should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GitError);
      const err = e as GitError;
      expect(err.stderr).toContain("NOPE.md");
      expect(err.stderr.length).toBeGreaterThan(0);
    }
  });

  it("a successful git command still returns real stdout", () => {
    const out = git(["log", "--oneline", "-1"], { cwd: repo });
    expect(out).toContain("init");
  });

  it("isGitRepo reports true for a real repo and false for a non-repo dir", () => {
    expect(isGitRepo(repo)).toBe(true);
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-not-a-repo-"));
    try {
      expect(isGitRepo(notARepo)).toBe(false);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

// The actual discriminating proof for the console-leak fix lives in
// apps/cli/src/cli.test.ts's "`run` on a repo without AGENTS.md prints no
// raw git error to the console" test, which spawns the real compiled CLI
// binary and asserts its stderr directly. An earlier version of this file
// tried to prove the same thing here via a doubly-nested child process (this
// test's own child, itself spawning `git` as a grandchild), asserting the
// child's captured stderr was empty. It did not actually discriminate — it
// passed identically against both the pre-fix and post-fix code — most
// likely because the grandchild's stderr-forwarding target resolves
// differently once already inside a spawned `node -e` process than it does
// from a normal test process. Rather than ship a test that would pass either
// way (this project's own stated worse-than-no-test case), it was removed
// in favor of the CLI-level test, which was verified with the full
// stash/revert cycle to actually fail pre-fix and pass post-fix.
