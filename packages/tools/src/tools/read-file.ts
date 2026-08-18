import fs from "node:fs";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { resolveInWorkspace } from "../workspace-path.js";
import { isLfsPointerContent, looksBinary, parseLfsPointer } from "../repo-edge-cases.js";

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
  /** §13.4: true when `content` is an LFS pointer stub, not the real (potentially huge) tracked file. */
  lfsPointer?: boolean;
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

    // §4.5/§13.4: "large binaries not read into context" — sniffed before
    // decoding, so a real (LFS-smudged or ordinary) binary under the size
    // cap is refused with a clear reason instead of dumped as mojibake.
    const buf = fs.readFileSync(abs);
    if (looksBinary(buf)) {
      return fail("binary-file", `${args.path} looks binary (NUL byte found) — read_file only handles text`);
    }
    const raw = buf.toString("utf8");

    // §13.4: an LFS pointer file's on-disk content is a small stand-in for
    // the real tracked object, not the file the model probably means to
    // read — say so plainly instead of returning the three-line pointer
    // stub as if it were real content.
    if (isLfsPointerContent(raw)) {
      const pointer = parseLfsPointer(raw);
      const sizeNote = pointer.size !== undefined ? `${pointer.size} bytes` : "unknown size";
      return ok({
        path: args.path,
        content: `[git-lfs pointer: ${args.path} is LFS-tracked (§13.4); the real content (${sizeNote}) is not checked out or is a binary this tool won't read. oid=${pointer.oid ?? "unknown"}]`,
        totalLines: raw.split("\n").length,
        windowed: false,
        lfsPointer: true
      });
    }

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
