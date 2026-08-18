import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir, makeTempRepo } from "./test-helpers.js";
import { git } from "./git-exec.js";
import { createRunWorktree, type RunWorktree } from "./worktree.js";
import { githubCompareUrl, parseGitHubRemote, pushBranch, remoteUrl } from "./remote.js";

describe("parseGitHubRemote", () => {
  it("parses an https GitHub remote", () => {
    expect(parseGitHubRemote("https://github.com/Derric01/ClutchCode.git")).toEqual({ owner: "Derric01", repo: "ClutchCode" });
    expect(parseGitHubRemote("https://github.com/Derric01/ClutchCode")).toEqual({ owner: "Derric01", repo: "ClutchCode" });
  });

  it("parses an ssh GitHub remote", () => {
    expect(parseGitHubRemote("git@github.com:Derric01/ClutchCode.git")).toEqual({ owner: "Derric01", repo: "ClutchCode" });
  });

  it("returns null for a non-GitHub remote", () => {
    expect(parseGitHubRemote("https://gitlab.com/someone/somewhere.git")).toBeNull();
    expect(parseGitHubRemote("git@bitbucket.org:someone/somewhere.git")).toBeNull();
  });
});

describe("githubCompareUrl", () => {
  it("builds a real GitHub compare URL", () => {
    expect(githubCompareUrl({ owner: "Derric01", repo: "ClutchCode" }, "main", "clutchcode/run-abc123-fix")).toBe(
      "https://github.com/Derric01/ClutchCode/compare/main...clutchcode%2Frun-abc123-fix?expand=1"
    );
  });
});

describe("remoteUrl + pushBranch (against a real local bare remote)", () => {
  let repoPath: string;
  let bareRemotePath: string;
  let stateDir: string;
  let run: RunWorktree;

  beforeEach(() => {
    repoPath = makeTempRepo();
    bareRemotePath = makeTempDir("clutchcode-git-bare-remote-");
    git(["init", "-q", "--bare", "-b", "main", bareRemotePath], { cwd: repoPath });
    git(["remote", "add", "origin", bareRemotePath], { cwd: repoPath });
    stateDir = makeTempDir("clutchcode-git-test-state-");
    run = createRunWorktree({ repoPath, stateDir, runId: "run12345678", slug: "add feature" });
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(bareRemotePath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("remoteUrl reads the configured origin", () => {
    expect(remoteUrl(repoPath)).toBe(bareRemotePath);
  });

  it("remoteUrl returns null when the remote doesn't exist", () => {
    expect(remoteUrl(repoPath, "nope")).toBeNull();
  });

  it("pushBranch pushes the run's branch to the remote, retrievable from a fresh clone", () => {
    fs.writeFileSync(`${run.worktreePath}/feature.txt`, "new feature\n", "utf8");
    git(["add", "-A"], { cwd: run.worktreePath });
    git(["commit", "-q", "-m", "add feature"], { cwd: run.worktreePath });

    pushBranch(run);

    const branches = git(["branch", "--list", run.branch], { cwd: bareRemotePath });
    expect(branches.trim()).not.toBe("");

    const clonePath = makeTempDir("clutchcode-git-clone-");
    try {
      git(["clone", "-q", "--branch", run.branch, bareRemotePath, clonePath], { cwd: repoPath });
      expect(fs.readFileSync(`${clonePath}/feature.txt`, "utf8")).toBe("new feature\n");
    } finally {
      fs.rmSync(clonePath, { recursive: true, force: true });
    }
  });

  it("createRunWorktree records the checked-out base branch", () => {
    expect(run.baseBranch).toBe("main");
  });

  it("rejects a remote value shaped like a URL or a remote-helper spec instead of a plain configured name (real vulnerability caught in security review: an unvalidated remote could redirect a push off-host, or on some git configs run a local command via ext::)", () => {
    expect(() => pushBranch(run, "ext::sh -c 'touch /tmp/should-not-run'")).toThrow(/invalid remote name/);
    expect(() => pushBranch(run, "https://attacker.example/evil.git")).toThrow(/invalid remote name/);
    expect(() => pushBranch(run, "git@attacker.example:evil/repo.git")).toThrow(/invalid remote name/);
    expect(() => remoteUrl(repoPath, "ext::sh -c 'touch /tmp/should-not-run'")).toThrow(/invalid remote name/);
    // A plain, legitimately-configured name is unaffected.
    expect(() => remoteUrl(repoPath, "origin")).not.toThrow();
  });
});
