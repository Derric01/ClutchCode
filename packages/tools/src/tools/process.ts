import { spawnSync } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";

export interface ProcessArgs {
  op: "list" | "kill";
  pid?: number;
  signal?: NodeJS.Signals;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
  elapsed: string;
}

export type ProcessData = { op: "list"; rows: ProcessRow[] } | { op: "kill"; pid: number; signaled: boolean };

export const processTool: Tool<ProcessArgs, ProcessData> = {
  name: "process",
  description: "List or kill processes visible to this session (table for list, no-such-process error for kill).",
  schema: {
    type: "object",
    required: ["op"],
    properties: {
      op: { type: "string", enum: ["list", "kill"] },
      pid: { type: "number" },
      signal: { type: "string" }
    }
  },
  permissionClass: "EXECUTE",
  idempotent: true,

  validate(args) {
    const a = args as { op?: unknown; pid?: unknown };
    if (a.op !== "list" && a.op !== "kill") return { ok: false, error: { message: 'op must be "list" or "kill"' } };
    if (a.op === "kill" && typeof a.pid !== "number") {
      return { ok: false, error: { message: "pid is required for kill" } };
    }
    return { ok: true, value: args as ProcessArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<ProcessData>> {
    // Note: killing a process is EXECUTE-gated like any other command, but
    // is not flagged §12.1-destructive — that pattern list targets
    // data-loss shell commands (rm -rf, force-push, …); a SIGTERM to a
    // single pid is bounded and, per §11.1, this tool is idempotent (safe
    // to retry against an already-dead process, see no-such-process below).
    const decision = ctx.policy.decide({
      permissionClass: "EXECUTE",
      commandClass: `process ${args.op}`,
      subject: args.op,
      repoTrustMode: ctx.repoTrustMode,
      destructive: false
    });
    if (decision.decision !== "ALLOW") {
      return fail(decision.decision === "ASK" ? "needs-approval" : "policy-denied", decision.reason);
    }

    if (args.op === "list") {
      const proc = spawnSync("ps", ["-eo", "pid,ppid,comm,etime"], { encoding: "utf8" });
      if (proc.error || proc.status !== 0) {
        return fail("exec-error", proc.error ? String(proc.error) : proc.stderr);
      }
      const lines = proc.stdout.trim().split("\n").slice(1);
      const rows: ProcessRow[] = lines
        .map((line) => {
          const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
          if (!m) return null;
          return { pid: Number(m[1]), ppid: Number(m[2]), command: m[3]!, elapsed: m[4]! };
        })
        .filter((r): r is ProcessRow => r !== null);
      return ok({ op: "list", rows });
    }

    // kill
    try {
      process.kill(args.pid!, args.signal ?? "SIGTERM");
      return ok({ op: "kill", pid: args.pid!, signaled: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ESRCH") return fail("no-such-process", `no such process: ${args.pid}`);
      return fail("kill-failed", String(err));
    }
  }
};
