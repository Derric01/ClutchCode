import type { PermissionClass, PolicyEngine } from "@clutchcode/sandbox";
import type { Denylist, Redactor } from "@clutchcode/sandbox";

/**
 * Unified tool interface (PROJECT_SPEC.md §11.1).
 *
 * ```
 * interface Tool<Args, Result> {
 *   name; description; schema: JSONSchema<Args>;
 *   permissionClass: READ | WRITE | EXECUTE | NETWORK;
 *   idempotent: boolean;
 *   validate(args): Result<Args, ValidationError>;
 *   run(args, ctx): Promise<ToolResult>;
 *   truncate(output): { shown, full_ref }
 * }
 * ```
 */

/** Loose JSON-Schema representation — enough to drive native tool-calling and text-protocol grammars (§4.8). */
export type JSONSchema = Record<string, unknown>;

export interface ValidationError {
  message: string;
  path?: string;
}

export type ValidateResult<Args> = { ok: true; value: Args } | { ok: false; error: ValidationError };

export interface ToolError {
  code: string;
  message: string;
  detail?: unknown;
}

export interface ToolResult<Data = unknown> {
  ok: boolean;
  data?: Data;
  error?: ToolError;
  truncated?: boolean;
  /** Reference to the full untruncated output on disk (§11.3), retrievable via read_file windowing. */
  evidenceRef?: string;
}

/** ctx = sandboxed workspace handle (§11.1). */
export interface ToolContext {
  /** Absolute path to the run's worktree root (§13) — all fs tools are confined here. */
  workspaceRoot: string;
  /** Absolute path for evidence files (untruncated tool output, §11.3). */
  evidenceDir: string;
  policy: PolicyEngine;
  denylist: Denylist;
  redactor: Redactor;
  repoTrustMode: "trusted" | "untrusted";
  /** Extra hosts allowed to receive network egress (§12.2), empty by default. */
  networkAllowlist: string[];
  /**
   * §12.6: "tier0" (default, process isolation + policy engine only) or
   * "tier1" (adds OS-level confinement — bubblewrap on Linux, §12.5). Tier 1
   * is a no-op fallback to Tier 0 when the platform's sandbox tool isn't
   * installed, so it's always safe to request.
   */
  sandboxTier?: "tier0" | "tier1";
  /** Cooperative cancellation (§6.6). */
  signal?: AbortSignal;
}

export interface TruncatedOutput {
  shown: string;
  fullRef?: string;
  truncated: boolean;
}

export interface Tool<Args, Data> {
  name: string;
  description: string;
  schema: JSONSchema;
  permissionClass: PermissionClass;
  idempotent: boolean;
  validate(args: unknown): ValidateResult<Args>;
  run(args: Args, ctx: ToolContext): Promise<ToolResult<Data>>;
}

export function ok<Data>(data: Data, extra: Partial<ToolResult<Data>> = {}): ToolResult<Data> {
  return { ok: true, data, ...extra };
}

export function fail(code: string, message: string, detail?: unknown): ToolResult<never> {
  return { ok: false, error: { code, message, detail } };
}
