import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { TruncatedOutput } from "./types.js";

/**
 * Output truncation (PROJECT_SPEC.md §11.3).
 *
 * "A 50k-line test log must not destroy the context window." Truncation
 * happens at tool-output ingestion, before the text ever reaches context.
 * The full output is always saved to evidenceDir so the model can request a
 * specific window instead of re-running an expensive command.
 */

const FAILURE_LINE_RE = /\b(fail(ed|ure)?|error|✗|✘|assert(ion)?\s*error|exception|traceback)\b/i;

export interface TruncateOptions {
  /** Character budget (a simple proxy for token budget). */
  budget: number;
  kind: "test" | "log" | "search";
  evidenceDir: string;
  /** Stable label used in the evidence filename, e.g. the tool name. */
  label: string;
  headLines?: number;
  tailLines?: number;
}

function writeEvidence(evidenceDir: string, label: string, full: string): string {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const hash = crypto.createHash("sha256").update(full).digest("hex").slice(0, 12);
  const file = path.join(evidenceDir, `${label}-${hash}.log`);
  fs.writeFileSync(file, full, "utf8");
  return file;
}

function truncateGeneric(text: string, budget: number, headLines: number, tailLines: number): string {
  const lines = text.split("\n");
  if (text.length <= budget && lines.length <= headLines + tailLines) return text;

  const head = lines.slice(0, headLines);
  const tail = lines.slice(Math.max(headLines, lines.length - tailLines));
  const skipped = Math.max(0, lines.length - head.length - tail.length);

  return [...head, `... ${skipped} lines skipped ...`, ...tail].join("\n");
}

function truncateTestLog(text: string, budget: number, headLines: number, tailLines: number): string {
  const lines = text.split("\n");
  const failureLineCount = lines.filter((l) => FAILURE_LINE_RE.test(l)).length;

  if (text.length <= budget) return text;

  const headCount = Math.min(headLines, lines.length);
  const tailStart = Math.max(0, lines.length - tailLines);
  const head = lines.slice(0, headCount);
  const tail = lines.slice(tailStart);
  // Real bug caught in round 3 of security review: dedup used to be a
  // Set of shown-line *text*, so a failure signature that also happens to
  // appear verbatim in the shown head/tail (e.g. a common error string
  // like "Error: connect ECONNREFUSED 127.0.0.1:5432" repeating across
  // many distinct failures — very typical in a real CI log) got filtered
  // out of `extraFailures` for every OTHER, genuinely-omitted occurrence
  // too, since string equality can't tell two identical-looking lines
  // apart. Now dedup by *position*: a line is "shown" only if its index
  // falls inside the actual head/tail window, matching the slices above.
  const extraFailures = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => FAILURE_LINE_RE.test(l) && !(i < headCount || i >= tailStart))
    .map(({ l }) => l)
    .slice(0, 50);

  const parts = [
    `Showing ${head.length + tail.length} of ${lines.length} lines; ${failureLineCount} failure signature(s) detected.`,
    ...head,
    "... (passing middle omitted) ...",
    ...tail
  ];
  if (extraFailures.length > 0) {
    parts.push("--- failure signatures found in the omitted region ---", ...extraFailures);
  }
  return parts.join("\n");
}

/**
 * ALWAYS: the model is told it was truncated and how to get more (bounded),
 * so it can request a specific window instead of re-running the suite.
 */
export function truncate(text: string, opts: TruncateOptions): TruncatedOutput {
  const headLines = opts.headLines ?? 40;
  const tailLines = opts.tailLines ?? 40;

  if (text.length <= opts.budget) {
    return { shown: text, truncated: false };
  }

  const fullRef = writeEvidence(opts.evidenceDir, opts.label, text);

  let shown: string;
  if (opts.kind === "test") {
    shown = truncateTestLog(text, opts.budget, headLines, tailLines);
  } else {
    shown = truncateGeneric(text, opts.budget, headLines, tailLines);
  }

  shown += `\n\n[truncated: full output saved; read_file("${fullRef}", window) to see more]`;

  return { shown, fullRef, truncated: true };
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/** search: top-K matches + count (§11.3). */
export function truncateSearchResults(
  matches: SearchMatch[],
  topK: number
): { shown: SearchMatch[]; totalCount: number; truncated: boolean } {
  return {
    shown: matches.slice(0, topK),
    totalCount: matches.length,
    truncated: matches.length > topK
  };
}
