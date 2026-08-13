import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { resolveInWorkspace } from "../workspace-path.js";

export interface WriteFileArgs {
  path: string;
  body: string;
}

export interface WriteFileData {
  path: string;
  bytesWritten: number;
  created: boolean;
}

const MAX_BYTES = 5_000_000;

export const writeFileTool: Tool<WriteFileArgs, WriteFileData> = {
  name: "write_file",
  description: "Write (create or overwrite) a file's full contents, confined to the workspace.",
  schema: {
    type: "object",
    required: ["path", "body"],
    properties: { path: { type: "string" }, body: { type: "string" } }
  },
  permissionClass: "WRITE",
  idempotent: false,

  validate(args) {
    if (
      typeof args !== "object" ||
      args === null ||
      typeof (args as { path?: unknown }).path !== "string" ||
      typeof (args as { body?: unknown }).body !== "string"
    ) {
      return { ok: false, error: { message: "path and body are required strings" } };
    }
    return { ok: true, value: args as WriteFileArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<WriteFileData>> {
    const { abs, inside } = resolveInWorkspace(ctx.workspaceRoot, args.path);

    const decision = ctx.policy.decide({
      permissionClass: "WRITE",
      commandClass: "write_file",
      subject: abs,
      repoTrustMode: ctx.repoTrustMode,
      insideWorkspace: inside
    });
    if (decision.decision !== "ALLOW") {
      return fail(inside ? "policy-denied" : "path-outside-workspace", decision.reason);
    }
    if (ctx.denylist.isDenied(abs)) {
      return fail("denylisted", `refusing to write a denylisted path: ${args.path}`);
    }

    const bodyBytes = Buffer.byteLength(args.body, "utf8");
    if (bodyBytes > MAX_BYTES) return fail("would-exceed-cap", `write exceeds ${MAX_BYTES} bytes`);

    const created = !fs.existsSync(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, args.body, "utf8");

    return ok({ path: args.path, bytesWritten: bodyBytes, created });
  }
};
