import { spawnSync } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { truncate } from "../truncate.js";

export type GitOp = "status" | "diff" | "log";

export interface GitArgs {
  op: GitOp;
  /** For `log`: how many entries. For `diff`: an optional path scope. */
  arg?: string;
}

export interface GitData {
  op: GitOp;
  output: string;
}

const ALLOWED_OPS: GitOp[] = ["status", "diff", "log"];
const OUTPUT_BUDGET = 20_000;

/**
 * §12.2: `arg` for `log` is documented as "how many entries" — a plain
 * count, nothing else. Real vulnerability caught in security review: the
 * old code built the argv token as `` `-${args.arg ?? "10"}` ``, so an
 * `arg` beginning with its own `-` (e.g. `"-output=/tmp/pwned"`, model/
 * LLM-controlled) produced a genuine `--output=...` long option — `git
 * log` writes its output straight to that path, an arbitrary-file-write
 * primitive completely outside the workspace, confirmed against a real
 * git binary. Validating here means the count can never contain anything
 * but digits, so it can never be interpreted as a flag no matter how the
 * argv token is assembled.
 */
function parseLogCount(arg: string | undefined): string {
  return arg !== undefined && /^\d+$/.test(arg) ? arg : "10";
}

/**
 * A deliberately narrow read-only `git` tool for the agent to inspect repo
 * state (status/diff/log). Worktree creation, checkpoint commits, and
 * rollback are runtime-orchestrated (packages/git), not agent-invokable —
 * this keeps the destructive git surface out of the model's hands (§13).
 * Anything beyond this small allowlist should go through `shell`, which is
 * separately policy-gated and destructive-command-checked.
 */
export const gitTool: Tool<GitArgs, GitData> = {
  name: "git",
  description: "Read-only git inspection: status, diff, log.",
  schema: {
    type: "object",
    required: ["op"],
    properties: {
      op: { type: "string", enum: ALLOWED_OPS },
      arg: { type: "string" }
    }
  },
  permissionClass: "EXECUTE",
  idempotent: true,

  validate(args) {
    const a = args as { op?: unknown; arg?: unknown };
    if (typeof a.op !== "string" || !ALLOWED_OPS.includes(a.op as GitOp)) {
      return { ok: false, error: { message: `op must be one of ${ALLOWED_OPS.join(", ")}` } };
    }
    return { ok: true, value: args as GitArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<GitData>> {
    const decision = ctx.policy.decide({
      permissionClass: "EXECUTE",
      commandClass: `git ${args.op}`,
      subject: `git ${args.op}`,
      repoTrustMode: ctx.repoTrustMode,
      destructive: false
    });
    if (decision.decision === "DENY") return fail("policy-denied", decision.reason);

    const cliArgs =
      args.op === "log"
        ? ["log", "-n", parseLogCount(args.arg), "--oneline"]
        : args.op === "diff"
          ? args.arg
            ? ["diff", "--", args.arg]
            : ["diff"]
          : ["status", "--porcelain=v1", "-b"];

    const proc = spawnSync("git", cliArgs, { cwd: ctx.workspaceRoot, encoding: "utf8", maxBuffer: 20_000_000 });
    if (proc.error) return fail("exec-error", String(proc.error));
    if (proc.status !== 0) {
      const stderr = proc.stderr || "";
      if (/not a git repository/i.test(stderr)) return fail("not-a-repo", stderr);
      return fail("git-error", stderr || `git ${args.op} exited with ${proc.status}`);
    }

    const { shown, truncated } = truncate(proc.stdout, {
      budget: OUTPUT_BUDGET,
      kind: "log",
      evidenceDir: ctx.evidenceDir,
      label: `git-${args.op}`
    });
    // §5.2: a `git diff` can surface a secret a prior commit introduced — scrub before it reaches context.
    return ok({ op: args.op, output: ctx.redactor.scrub(shown).text }, { truncated });
  }
};
