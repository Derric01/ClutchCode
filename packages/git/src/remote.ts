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

/**
 * `git push`/`git remote get-url`'s "repository" argument accepts either a
 * configured remote *name* or a full transport URL/remote-helper spec
 * (`ext::<command>`, `https://...`, `git@...`, ...) — `git` doesn't
 * distinguish them syntactically. `remote` here is meant to always be the
 * former (a name already configured via `git remote add`), but reaches
 * both functions below from callers that in turn take it straight from
 * external input with no validation of their own (`PrOptions.remote` via
 * `agent-rpc`'s `pr` RPC method: `agent.pr(requireRunId(params), params as
 * PrOptions)`, a bare type assertion). Real gap caught in security review:
 * an unvalidated value could redirect a push to an attacker-chosen URL
 * (source-code exfiltration to a server the caller doesn't control) — and,
 * on a system where `protocol.ext.allow` has been configured away from
 * git's own hardened default of `never` for that specific protocol,
 * `ext::<command>` would run an arbitrary local command. Validate against
 * an allow-list of legal git remote *name* characters before either
 * function ever passes the value to `git`, closing both regardless of the
 * host's own git config.
 */
const SAFE_REMOTE_NAME_RE = /^[A-Za-z0-9_.-]+$/;

function requireSafeRemoteName(remote: string): string {
  if (!SAFE_REMOTE_NAME_RE.test(remote)) {
    throw new Error(`invalid remote name "${remote}" — expected a plain configured remote name (e.g. "origin"), not a URL`);
  }
  return remote;
}

export function remoteUrl(repoPath: string, remote = "origin"): string | null {
  const out = git(["remote", "get-url", requireSafeRemoteName(remote)], { cwd: repoPath, allowFailure: true }).trim();
  return out || null;
}

/** Explicit, one call = one push (§13.5's "never auto-pushes" — this function IS the explicit command, not a side effect of anything else). */
export function pushBranch(run: RunWorktree, remote = "origin"): void {
  git(["push", "-u", requireSafeRemoteName(remote), run.branch], { cwd: run.worktreePath });
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
