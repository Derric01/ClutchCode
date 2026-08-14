import type { CollectedResponse } from "@clutchcode/providers";
import type { EditBlock } from "@clutchcode/tools";
import type { ReliabilityTier, ToolTransport } from "./types.js";

/**
 * Pure, directly-testable scoring helpers for the capability probe (§4.9).
 * Deliberately separated from probe.ts (which does the network I/O) so each
 * scoring rule is model-stubbable without a Provider at all — same
 * philosophy as the runtime's loop-detector (§6.4).
 */

export function tier(score: number): ReliabilityTier {
  if (score >= 0.85) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/** Check 2 (§4.9): did the model stop exactly when told, or ramble? */
export function scoreStopObedience(rawText: string): number {
  const trimmed = rawText.trim();
  if (trimmed === "DONE") return 1;
  if (/^DONE[.!]?$/.test(trimmed)) return 0.75; // trivial punctuation drift
  if (/\bDONE\b/.test(trimmed)) return trimmed.length <= 40 ? 0.4 : 0.1; // said it, but rambled
  return 0;
}

/** Check 4 (§4.9): does the model emit exactly the requested JSON shape? */
export function scoreStructuredOutput(rawText: string): number {
  const trimmed = rawText.trim();
  const isWellFormed = (obj: Record<string, unknown>): boolean => obj.status === "ok" && Number.isInteger(obj.count);

  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    return isWellFormed(obj) ? 1 : 0.3; // valid JSON, wrong shape
  } catch {
    // Salvage: a JSON object embedded in surrounding prose (json-mode-only behavior).
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) return 0;
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      return isWellFormed(obj) ? 0.6 : 0.15;
    } catch {
      return 0;
    }
  }
}

function tryParseEditsArgs(raw: string): EditBlock[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const edits = (parsed as { edits?: unknown } | null)?.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;

  const blocks: EditBlock[] = [];
  for (const e of edits) {
    if (typeof e !== "object" || e === null) return null;
    const { search, replace } = e as { search?: unknown; replace?: unknown };
    if (typeof search !== "string" || typeof replace !== "string") return null;
    blocks.push({ search, replace });
  }
  return blocks;
}

export interface ExtractedEdits {
  edits: EditBlock[];
  source: Extract<ToolTransport, "native" | "json-mode-only">;
}

/**
 * Pulls an edit-block array out of a model response, trying native tool
 * calling first, then a JSON object embedded in free text (json-mode-only
 * behavior, §4.1). Returns null if neither transport produced anything
 * parseable — the model needs text-protocol emulation (§4.8).
 */
export function extractEditBlocks(res: CollectedResponse, toolName: string): ExtractedEdits | null {
  const call = res.toolCalls.find((c) => c.name === toolName);
  if (call) {
    const edits = tryParseEditsArgs(call.argsJson);
    if (edits) return { edits, source: "native" };
  }

  const match = /\{[\s\S]*"edits"[\s\S]*\}/.exec(res.text);
  if (match) {
    const edits = tryParseEditsArgs(match[0]);
    if (edits) return { edits, source: "json-mode-only" };
  }

  return null;
}

/** Majority vote over per-trial transports, defaulting to "none" when nothing parsed at all. */
export function deriveToolTransport(sources: Array<ToolTransport>): ToolTransport {
  const counts: Record<ToolTransport, number> = { native: 0, "json-mode-only": 0, none: 0 };
  for (const s of sources) counts[s]++;
  if (counts.native === 0 && counts["json-mode-only"] === 0) return "none";
  return counts.native >= counts["json-mode-only"] ? "native" : "json-mode-only";
}
