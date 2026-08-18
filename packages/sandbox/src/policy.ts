import type { Decision, PolicyDecisionRecord, PolicyRequest } from "./types.js";

/**
 * Permission policy engine (PROJECT_SPEC.md §12.2).
 *
 * for each tool call → decision ∈ { ALLOW, ASK, DENY }
 *   keyed by (permissionClass, specific-args, repo-trust-mode, sandbox-tier)
 *
 * Defaults (untrusted repo):
 *   READ  (workspace, non-denylisted)      → ALLOW
 *   WRITE (workspace)                      → ALLOW ; WRITE (outside workspace) → DENY
 *   EXECUTE (non-destructive, sandboxed)   → ASK (first time per command-class), then remembered
 *   EXECUTE (destructive pattern)          → ASK, always (never remembered)
 *   NETWORK                                → DENY unless host ∈ allowlist → ASK
 *
 * Approval fatigue (§18.3): non-destructive EXECUTE/ASK decisions are
 * remembered per command-class **for the lifetime of this engine instance**
 * (one run), not asked every time.
 */
export class PolicyEngine {
  private readonly log: PolicyDecisionRecord[] = [];
  private readonly remembered = new Map<string, Decision>();

  decide(request: PolicyRequest): PolicyDecisionRecord {
    const decision = this.computeDecision(request);
    const record: PolicyDecisionRecord = {
      request,
      decision: decision.decision,
      reason: decision.reason,
      ts: Date.now()
    };
    this.log.push(record);
    return record;
  }

  /** Record a human's answer to a remembered ASK so subsequent calls in this run skip the prompt. */
  remember(commandClass: string, decision: Decision): void {
    this.remembered.set(commandClass, decision);
  }

  /** Full decision log for this run, for §15 observability. */
  getLog(): readonly PolicyDecisionRecord[] {
    return this.log;
  }

  private computeDecision(req: PolicyRequest): { decision: Decision; reason: string } {
    const remembered = this.remembered.get(req.commandClass);

    switch (req.permissionClass) {
      case "READ": {
        if (req.denylisted) return { decision: "DENY", reason: "path is on the §5.3 secrets denylist" };
        return { decision: "ALLOW", reason: "read of a non-denylisted path" };
      }

      case "WRITE": {
        if (req.insideWorkspace === false) {
          return { decision: "DENY", reason: "write path is outside the run worktree" };
        }
        if (req.submodule) {
          // Always ask, never remembered (unlike ordinary EXECUTE ASKs) — a
          // submodule is a separate repo, so this write needs a separate,
          // explicit commit inside it (§13.4), not silent inclusion in the
          // run's own checkpoint/squash commits.
          return { decision: "ASK", reason: "write path is inside a git submodule (§13.4) — needs its own separate commit" };
        }
        return { decision: "ALLOW", reason: "write inside the run worktree (§13)" };
      }

      case "EXECUTE": {
        if (req.destructive) {
          // Destructive commands always ask, even in trusted repos, even if
          // previously remembered — this decision is never cached (§12.4).
          return { decision: "ASK", reason: "matches a destructive-command pattern (§12.1)" };
        }
        if (remembered) {
          return { decision: remembered, reason: `remembered decision for command-class "${req.commandClass}"` };
        }
        if (req.repoTrustMode === "trusted") {
          return { decision: "ALLOW", reason: "trusted repo (§12.4), non-destructive execute" };
        }
        return { decision: "ASK", reason: "first use of this command-class this run (§18.3)" };
      }

      case "NETWORK": {
        if (req.networkAllowlisted) {
          return { decision: "ASK", reason: "host is allowlisted but network defaults to ASK, not silent ALLOW" };
        }
        return { decision: "DENY", reason: "network egress default-deny (ADR-019); host not on allowlist" };
      }

      default: {
        const exhaustive: never = req.permissionClass;
        throw new Error(`unknown permission class: ${exhaustive as string}`);
      }
    }
  }
}
