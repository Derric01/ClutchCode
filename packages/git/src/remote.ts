import { git } from "./git-exec.js";
import type { RunWorktree } from "./worktree.js";

/**
 * PR preparation (PROJECT_SPEC.md §13.5): "push + open a PR with a body
 * summarizing the task, diff stats, and verification results — never
 * auto-pushes without explicit command." This module is the git-level half
 * (push, remote inspection, GitHub URL construction); `agent pr`'s PR body
 * and `gh` CLI invocation live in `@clutchcode/agent-api`, which is where
 * the task/diff/verification summary actually comes together.
 */

export function remoteUrl(repoPath: string, remote = "origin"): string | null {
  const out = git(["remote", "get-url", remote], { cwd: repoPath, allowFailure: true }).trim();
  return out || null;
}

/** Explicit, one call = one push (§13.5's "never auto-pushes" — this function IS the explicit command, not a side effect of anything else). */
export function pushBranch(run: RunWorktree, remote = "origin"): void {
  git(["push", "-u", remote, run.branch], { cwd: run.worktreePath });
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/** Parses a GitHub remote URL (https or ssh form) into `{owner, repo}` — `null` for anything else (self-hosted, GitLab, Bitbucket, ...), which callers treat as "no compare-URL fallback available", not an error. */
export function parseGitHubRemote(url: string): GitHubRepoRef | null {
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (https) return { owner: https[1]!, repo: https[2]! };
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  return null;
}

/** A real, well-known GitHub URL scheme — used as a fallback when the `gh` CLI isn't available to open the PR directly. */
export function githubCompareUrl(ref: GitHubRepoRef, base: string, head: string): string {
  return `https://github.com/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
}
