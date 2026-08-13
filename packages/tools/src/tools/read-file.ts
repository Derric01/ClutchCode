import fs from "node:fs";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { resolveInWorkspace } from "../workspace-path.js";

export interface ReadFileArgs {
  path: string;
  /** Optional window (1-indexed, inclusive) so the agent reads windows, not whole files (§4.5 file-window discipline). */
  window?: { startLine: number; endLine: number };
}

export interface ReadFileData {
  path: string;
  content: string;
  totalLines: number;
  windowed: boolean;
}

const MAX_BYTES = 2_000_000;

export const readFileTool: Tool<ReadFileArgs, ReadFileData> = {
  name: "read_file",
  description: "Read a file, optionally windowed by line range, confined to the workspace.",
  schema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
      window: {
        type: "object",
        properties: { startLine: { type: "number" }, endLine: { type: "number" } }
      }
    }
  },
  permissionClass: "READ",
  idempotent: true,

  validate(args) {
    if (typeof args !== "object" || args === null || !("path" in args) || typeof (args as { path: unknown }).path !== "string") {
      return { ok: false, error: { message: "path is required and must be a string" } };
    }
    return { ok: true, value: args as ReadFileArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<ReadFileData>> {
    const { abs, inside } = resolveInWorkspace(ctx.workspaceRoot, args.path);
    if (!inside) return fail("path-outside-workspace", `refusing to read outside the workspace: ${args.path}`);
    if (ctx.denylist.isDenied(abs)) return fail("denylisted", `path is on the secrets denylist: ${args.path}`);

    const decision = ctx.policy.decide({
      permissionClass: "READ",
      commandClass: "read_file",
      subject: abs,
      repoTrustMode: ctx.repoTrustMode,
      denylisted: false
    });
    if (decision.decision === "DENY") return fail("policy-denied", decision.reason);

    if (!fs.existsSync(abs)) return fail("not-found", `no such file: ${args.path}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return fail("not-a-file", `not a regular file: ${args.path}`);
    if (stat.size > MAX_BYTES) {
      return fail("too-large", `file exceeds ${MAX_BYTES} bytes; request a window instead`);
    }

    const raw = fs.readFileSync(abs, "utf8");
    const lines = raw.split("\n");

    // §5.2: every string crossing the tool-output-ingestion boundary is
    // scrubbed before it can reach model context — a secret accidentally
    // committed to a file the agent reads must not leak through.
    if (!args.window) {
      return ok({ path: args.path, content: ctx.redactor.scrub(raw).text, totalLines: lines.length, windowed: false });
    }

    const start = Math.max(1, args.window.startLine);
    const end = Math.min(lines.length, args.window.endLine);
    if (start > end) return fail("bad-window", `invalid window ${start}-${end} for ${lines.length} lines`);

    const windowed = lines.slice(start - 1, end).join("\n");
    return ok({ path: args.path, content: ctx.redactor.scrub(windowed).text, totalLines: lines.length, windowed: true });
  }
};
