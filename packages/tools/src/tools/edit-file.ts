import fs from "node:fs";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { resolveInWorkspace } from "../workspace-path.js";
import { applyEdits, type EditBlock } from "../edit-cascade.js";
import { isInsideAnySubmodule, matchesLfsPattern } from "../repo-edge-cases.js";

export interface EditFileArgs {
  path: string;
  edits: EditBlock[];
}

export interface EditFileData {
  path: string;
  strategiesUsed: string[];
  /** §13.4: the path matches an LFS-tracked `.gitattributes` pattern — flagged so the model (and diff review) knows a SEARCH/REPLACE here is unusual. */
  lfsTracked: boolean;
}

export const editFileTool: Tool<EditFileArgs, EditFileData> = {
  name: "edit_file",
  description: "Apply one or more SEARCH/REPLACE edit blocks to an existing file (§4.4 apply cascade).",
  schema: {
    type: "object",
    required: ["path", "edits"],
    properties: {
      path: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          required: ["search", "replace"],
          properties: { search: { type: "string" }, replace: { type: "string" } }
        }
      }
    }
  },
  permissionClass: "WRITE",
  idempotent: false,

  validate(args) {
    if (typeof args !== "object" || args === null) {
      return { ok: false, error: { message: "args must be an object" } };
    }
    const a = args as { path?: unknown; edits?: unknown };
    if (typeof a.path !== "string" || !Array.isArray(a.edits) || a.edits.length === 0) {
      return { ok: false, error: { message: "path (string) and edits (non-empty array) are required" } };
    }
    for (const e of a.edits) {
      if (
        typeof e !== "object" ||
        e === null ||
        typeof (e as { search?: unknown }).search !== "string" ||
        typeof (e as { replace?: unknown }).replace !== "string"
      ) {
        return { ok: false, error: { message: "each edit needs string search/replace" } };
      }
    }
    return { ok: true, value: args as EditFileArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<EditFileData>> {
    const { abs, real, inside } = resolveInWorkspace(ctx.workspaceRoot, args.path);
    const submodule = inside && isInsideAnySubmodule(args.path, ctx.submodulePaths);

    const decision = ctx.policy.decide({
      permissionClass: "WRITE",
      commandClass: "edit_file",
      subject: abs,
      repoTrustMode: ctx.repoTrustMode,
      insideWorkspace: inside,
      submodule
    });
    if (decision.decision !== "ALLOW") {
      return fail(
        !inside ? "path-outside-workspace" : decision.decision === "ASK" ? "needs-approval" : "policy-denied",
        decision.reason
      );
    }
    // Denylist-check the *real*, symlink-resolved target — see write-file.ts.
    if (ctx.denylist.isDenied(real)) return fail("denylisted", `refusing to edit a denylisted path: ${args.path}`);
    if (!fs.existsSync(abs)) return fail("not-found", `no such file: ${args.path} (use write_file to create it)`);

    const original = fs.readFileSync(abs, "utf8");
    const result = applyEdits(original, args.edits);

    if (!result.ok) {
      return fail("edit-block-failed", `SEARCH block #${result.failure.blockIndex} failed: ${result.failure.reason}`, {
        blockIndex: result.failure.blockIndex,
        nearestContext: result.failure.nearestContext
      });
    }

    fs.writeFileSync(abs, result.content, "utf8");
    return ok({ path: args.path, strategiesUsed: result.strategiesUsed, lfsTracked: matchesLfsPattern(args.path, ctx.lfsPatterns) });
  }
};
