/**
 * §13.1: `runId` becomes a path segment (`<stateDir>/wt/<runId>`,
 * `<stateDir>/runs/<runId>/...`) at multiple, independently-reachable
 * read/write boundaries — not just worktree creation.
 *
 * A real gap caught in round 3 of security review: round 2 validated
 * `runId` only inside `createRunWorktree` (the *create* path, reached
 * from the JSON-RPC `run` method). Three independent audits of this
 * round converged on the same finding: `RunStateStore` (`@clutchcode/
 * runtime`), `worktree-store.ts` and `events.ts` (`@clutchcode/
 * agent-api`), and `agent-methods.ts`'s `requireRunId` (`@clutchcode/
 * agent-rpc`) all build a path from a caller-supplied `runId` with no
 * validation of their own — and every one of them is reachable with a
 * client-supplied `runId` straight from the untrusted JSON-RPC/CLI
 * boundary via `diff`, `diffFiles`, `approve`, `reject`, `resume`,
 * `inspect`, `checkpoints`, `rollback`, and `pr`. Several of those chain
 * into real, destructive `git` operations (`git reset --hard`,
 * `git clean -fd`, `git worktree remove --force`) using fields loaded
 * from whatever file happens to exist at the traversed path — confirmed
 * reachable end-to-end, not just at the storage-layer unit level.
 *
 * One shared validator, used at every one of those boundaries, so they
 * can never independently drift out of sync with each other again the
 * way this gap happened in the first place.
 */
export const SAFE_RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isSafeRunId(runId: string): boolean {
  return SAFE_RUN_ID_RE.test(runId);
}

export function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) {
    throw new Error(`invalid runId "${runId}" — must match ${SAFE_RUN_ID_RE} (no path separators or "..")`);
  }
}
