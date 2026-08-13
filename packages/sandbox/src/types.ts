/**
 * Shared types for the sandbox/security layer (PROJECT_SPEC.md §5, §12).
 */

/** §11.1 permission classes that drive the policy engine. */
export type PermissionClass = "READ" | "WRITE" | "EXECUTE" | "NETWORK";

/** §12.2 policy engine decision. */
export type Decision = "ALLOW" | "ASK" | "DENY";

/** §12.4 trusted vs untrusted repo modes. */
export type RepoTrustMode = "trusted" | "untrusted";

export interface PolicyRequest {
  permissionClass: PermissionClass;
  /** A stable class key for "remember per command-class per run", e.g. tool name + normalized command verb. */
  commandClass: string;
  /** The literal path (for READ/WRITE) or command (for EXECUTE) or host (for NETWORK), for logging/matching. */
  subject: string;
  repoTrustMode: RepoTrustMode;
  /** True if this specific args tuple matches a known-destructive pattern (§12.1). */
  destructive?: boolean;
  /** READ/WRITE: is the path inside the run's worktree/workspace? */
  insideWorkspace?: boolean;
  /** READ: is the path on the §5.3 denylist? */
  denylisted?: boolean;
  /** NETWORK: is the host on the configured allowlist? */
  networkAllowlisted?: boolean;
}

export interface PolicyDecisionRecord {
  request: PolicyRequest;
  decision: Decision;
  reason: string;
  ts: number;
}
