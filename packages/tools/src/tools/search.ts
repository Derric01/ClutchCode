import { spawnSync } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { truncateSearchResults, type SearchMatch } from "../truncate.js";

export interface SearchArgs {
  pattern: string;
  glob?: string;
  topK?: number;
}

export interface SearchData {
  matches: SearchMatch[];
  totalCount: number;
  truncated: boolean;
}

const DEFAULT_TOP_K = 50;

interface RgJsonMatch {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

/**
 * ripgrep + filesystem retrieval, Tier 0 of §9 (no persistent index, no
 * vector DB — "the simplest thing that works").
 */
export const searchTool: Tool<SearchArgs, SearchData> = {
  name: "search",
  description: "Search the workspace by regex pattern (ripgrep), optionally scoped by glob.",
  schema: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: { type: "string" },
      glob: { type: "string" },
      topK: { type: "number" }
    }
  },
  permissionClass: "READ",
  idempotent: true,

  validate(args) {
    if (typeof args !== "object" || args === null || typeof (args as { pattern?: unknown }).pattern !== "string") {
      return { ok: false, error: { message: "pattern is required and must be a string" } };
    }
    return { ok: true, value: args as SearchArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<SearchData>> {
    const decision = ctx.policy.decide({
      permissionClass: "READ",
      commandClass: "search",
      subject: args.pattern,
      repoTrustMode: ctx.repoTrustMode
    });
    if (decision.decision === "DENY") return fail("policy-denied", decision.reason);

    const rgArgs = ["--json", "--max-count", "200", "--"];
    if (args.glob) rgArgs.unshift("--glob", args.glob);
    rgArgs.push(args.pattern, ctx.workspaceRoot);

    let proc;
    try {
      proc = spawnSync("rg", rgArgs, { encoding: "utf8", maxBuffer: 50_000_000 });
    } catch (e) {
      return fail("search-backend-unavailable", "ripgrep is not available", e);
    }
    if (proc.error) return fail("search-backend-unavailable", "ripgrep is not available", proc.error);
    if (proc.status !== 0 && proc.status !== 1) {
      // rg exit code 1 == "no matches", which is a valid empty result, not an error.
      return fail("bad-regex", proc.stderr || `ripgrep exited with status ${proc.status}`);
    }

    const matches: SearchMatch[] = [];
    for (const line of proc.stdout.split("\n")) {
      if (!line.trim()) continue;
      let parsed: RgJsonMatch;
      try {
        parsed = JSON.parse(line) as RgJsonMatch;
      } catch {
        continue;
      }
      if (parsed.type !== "match") continue;
      const file = parsed.data?.path?.text;
      const lineNumber = parsed.data?.line_number;
      const text = parsed.data?.lines?.text;
      if (!file || lineNumber === undefined || text === undefined) continue;
      // §5.2: scrub matched line text before it can reach model context.
      matches.push({ file, line: lineNumber, text: ctx.redactor.scrub(text.replace(/\n$/, "")).text });
    }

    const { shown, totalCount, truncated } = truncateSearchResults(matches, args.topK ?? DEFAULT_TOP_K);
    return ok({ matches: shown, totalCount, truncated }, { truncated });
  }
};
