import fs from "node:fs";
import { extractSymbols, languageForPath } from "@clutchcode/repo-intel";
import type { CodeSymbol } from "@clutchcode/repo-intel";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { resolveInWorkspace } from "../workspace-path.js";

export interface SymbolsArgs {
  path: string;
}

export interface SymbolsData {
  path: string;
  language: string;
  symbols: CodeSymbol[];
}

const MAX_BYTES = 2_000_000;

/**
 * Repo intelligence, Tier 0 (§9): on-demand tree-sitter symbol extraction —
 * "what's defined in this file", without a persistent index. JS/TS/TSX
 * only for now (see packages/repo-intel for the peer-dependency reasoning
 * behind not yet shipping Python/Go/Rust grammars).
 */
export const symbolsTool: Tool<SymbolsArgs, SymbolsData> = {
  name: "symbols",
  description: "List top-level functions, classes, methods, interfaces, types, enums, and variables defined in a JS/TS/TSX file.",
  schema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" }
    }
  },
  permissionClass: "READ",
  idempotent: true,

  validate(args) {
    if (typeof args !== "object" || args === null || !("path" in args) || typeof (args as { path: unknown }).path !== "string") {
      return { ok: false, error: { message: "path is required and must be a string" } };
    }
    return { ok: true, value: args as SymbolsArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<SymbolsData>> {
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

    const language = languageForPath(args.path);
    if (!language) {
      return fail("unsupported-language", `no symbol extractor for ${args.path} (supported: .js, .jsx, .mjs, .cjs, .ts, .mts, .cts, .tsx)`);
    }

    if (!fs.existsSync(abs)) return fail("not-found", `no such file: ${args.path}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return fail("not-a-file", `not a regular file: ${args.path}`);
    if (stat.size > MAX_BYTES) {
      return fail("too-large", `file exceeds ${MAX_BYTES} bytes`);
    }

    const content = fs.readFileSync(abs, "utf8");
    let symbols: CodeSymbol[];
    try {
      symbols = extractSymbols(content, language);
    } catch (err) {
      return fail("parse-error", `failed to parse ${args.path}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Symbol names/spans are derived from source structure, not content, but
    // scrub anyway (§5.2) — a secret embedded in an identifier name is a
    // pathological but possible case, and every ingestion boundary scrubs.
    const redactedSymbols = symbols.map((s) => ({ ...s, name: ctx.redactor.scrub(s.name).text }));

    return ok({ path: args.path, language, symbols: redactedSymbols });
  }
};
