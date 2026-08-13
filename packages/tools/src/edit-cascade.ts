/**
 * SEARCH/REPLACE edit format + apply cascade (PROJECT_SPEC.md §4.4).
 *
 * Clean-room implementation (LICENSE_AND_REUSE_ANALYSIS.md §3 —
 * CLEAN-ROOM-REQUIRED: written from the spec's behavior contract, not from
 * any reference project's source).
 *
 * apply(edit):
 *   cascade:
 *     1. exact match (char-for-char)
 *     2. tolerate uniform leading-whitespace drift
 *     3. drop a spurious leading blank line, retry
 *     4. handle explicit "..." elision if present
 *   NO fuzzy edit-distance step (learned lesson, ADR-002).
 *   on miss: structured failure naming which block failed, with the
 *   nearest non-applied context shown.
 */

export interface EditBlock {
  search: string;
  replace: string;
}

export type ApplyStrategy = "exact" | "whitespace-tolerant" | "blank-line-drop" | "ellipsis-elision";

export interface ApplySuccess {
  ok: true;
  content: string;
  strategy: ApplyStrategy;
}

export interface ApplyFailure {
  ok: false;
  reason: string;
  /** The best-effort nearest non-applied context, to help a repair prompt (§4.4). */
  nearestContext?: string;
}

export type ApplyResult = ApplySuccess | ApplyFailure;

function splitLinesKeepEnds(text: string): string[] {
  // Split into lines but retain enough info to rejoin exactly. We operate on
  // plain '\n'-split lines and rejoin with '\n'; callers should normalize
  // CRLF before calling if needed.
  return text.split("\n");
}

function leadingWhitespace(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : "";
}

/**
 * Strategy 2: tolerate a uniform leading-whitespace drift between the
 * search block and the actual file content — i.e. every line differs from
 * the search by the *same* leading-whitespace prefix (a common artifact of
 * a model copying a snippet at the wrong indent level).
 */
function tryWhitespaceTolerant(
  contentLines: string[],
  searchLines: string[]
): { startLine: number; endLine: number; delta: string } | null {
  if (searchLines.length === 0) return null;

  outer: for (let start = 0; start <= contentLines.length - searchLines.length; start++) {
    let delta: string | null = null;
    for (let i = 0; i < searchLines.length; i++) {
      const cLine = contentLines[start + i] ?? "";
      const sLine = searchLines[i] ?? "";
      const cStripped = cLine.replace(/^[ \t]*/, "");
      const sStripped = sLine.replace(/^[ \t]*/, "");
      if (cStripped !== sStripped) continue outer;

      // Blank lines carry no whitespace-delta signal; skip them for delta inference.
      if (sStripped.length === 0) continue;

      const cWs = leadingWhitespace(cLine);
      const sWs = leadingWhitespace(sLine);
      // We require content's indent = search's indent + delta (delta may be "" for equal).
      if (!cWs.endsWith(sWs) && !sWs.endsWith(cWs)) {
        // Not a simple prefix relationship — treat as non-uniform, reject this window.
        continue outer;
      }
      const thisDelta = cWs.length >= sWs.length ? cWs.slice(0, cWs.length - sWs.length) : "";
      if (cWs.length < sWs.length) continue outer; // content less indented than search — not supported
      if (delta === null) delta = thisDelta;
      else if (delta !== thisDelta) continue outer;
    }
    if (delta === null) delta = "";
    return { startLine: start, endLine: start + searchLines.length, delta };
  }
  return null;
}

function applyDelta(lines: string[], delta: string): string[] {
  if (delta === "") return lines;
  return lines.map((l) => (l.length === 0 ? l : delta + l));
}

function nearestContext(content: string, search: string): string | undefined {
  // Best-effort: find the content line most similar (by shared prefix length)
  // to the first non-blank line of the search block, and show a small window
  // around it — cheap, deterministic, no fuzzy edit-distance scoring.
  const searchFirstLine = search.split("\n").find((l) => l.trim().length > 0);
  if (!searchFirstLine) return undefined;
  const needle = searchFirstLine.trim().slice(0, 20);
  if (needle.length < 3) return undefined;

  const contentLines = content.split("\n");
  const idx = contentLines.findIndex((l) => l.includes(needle));
  if (idx === -1) return undefined;

  const windowStart = Math.max(0, idx - 2);
  const windowEnd = Math.min(contentLines.length, idx + 3);
  return contentLines.slice(windowStart, windowEnd).join("\n");
}

/** Apply a single edit block against `content` using the full cascade. */
export function applyEditBlock(content: string, block: EditBlock): ApplyResult {
  // Strategy 1: exact.
  {
    const idx = content.indexOf(block.search);
    if (idx !== -1) {
      const next = content.slice(0, idx) + block.replace + content.slice(idx + block.search.length);
      return { ok: true, content: next, strategy: "exact" };
    }
  }

  // Strategy 4 first-checked-for-applicability: explicit "..." elision.
  // (Checked before whitespace-tolerant because an ellipsis block usually
  // fails whitespace matching outright — it's structurally different.)
  if (/^\s*\.\.\.\s*$/m.test(block.search)) {
    const result = tryEllipsisElision(content, block);
    if (result) return result;
  }

  // Strategy 3: drop a spurious leading blank line from the search block, retry 1 & 2.
  const searchLines = splitLinesKeepEnds(block.search);
  if (searchLines.length > 1 && searchLines[0]?.trim() === "") {
    const trimmedSearch = searchLines.slice(1).join("\n");
    const idx = content.indexOf(trimmedSearch);
    if (idx !== -1) {
      const next = content.slice(0, idx) + block.replace + content.slice(idx + trimmedSearch.length);
      return { ok: true, content: next, strategy: "blank-line-drop" };
    }
  }

  // Strategy 2: uniform leading-whitespace drift.
  {
    const contentLines = splitLinesKeepEnds(content);
    const match = tryWhitespaceTolerant(contentLines, searchLines);
    if (match) {
      const replaceLines = applyDelta(splitLinesKeepEnds(block.replace), match.delta);
      const before = contentLines.slice(0, match.startLine);
      const after = contentLines.slice(match.endLine);
      const next = [...before, ...replaceLines, ...after].join("\n");
      return { ok: true, content: next, strategy: "whitespace-tolerant" };
    }
  }

  return {
    ok: false,
    reason: `SEARCH block did not match (tried exact, whitespace-tolerant, blank-line-drop${
      /^\s*\.\.\.\s*$/m.test(block.search) ? ", ellipsis-elision" : ""
    })`,
    nearestContext: nearestContext(content, block.search)
  };
}

/**
 * Explicit "..." elision (§4.4 point 4): the SEARCH/REPLACE blocks are split
 * into segments by lines that are exactly "...". Each segment must match in
 * content, in order, without requiring the elided middle to match anything —
 * the elided content is passed through untouched from the original file.
 */
function tryEllipsisElision(content: string, block: EditBlock): ApplyResult | null {
  const isEllipsisLine = (l: string) => /^\s*\.\.\.\s*$/.test(l);
  const searchSegments = block.search.split("\n").reduce<string[][]>(
    (segs, line) => {
      if (isEllipsisLine(line)) segs.push([]);
      else segs[segs.length - 1]!.push(line);
      return segs;
    },
    [[]]
  );
  const replaceSegments = block.replace.split("\n").reduce<string[][]>(
    (segs, line) => {
      if (isEllipsisLine(line)) segs.push([]);
      else segs[segs.length - 1]!.push(line);
      return segs;
    },
    [[]]
  );

  if (searchSegments.length !== replaceSegments.length || searchSegments.length < 2) {
    return null; // shape mismatch — let the caller report a structured failure
  }

  return applyEllipsisSegments(content, searchSegments, replaceSegments);
}

function applyEllipsisSegments(
  content: string,
  searchSegments: string[][],
  replaceSegments: string[][]
): ApplyResult | null {
  let cursor = 0;
  let out = "";
  let firstMatchIdx = -1;

  for (let i = 0; i < searchSegments.length; i++) {
    const seg = searchSegments[i]!.join("\n");
    if (seg.length === 0) {
      out += replaceSegments[i]!.join("\n");
      continue;
    }
    const idx = content.indexOf(seg, cursor);
    if (idx === -1) return null;
    if (i === 0) firstMatchIdx = idx;
    else {
      // Preserve the elided gap between the previous segment's end and this one, untouched.
      out += content.slice(cursor, idx);
    }
    out += replaceSegments[i]!.join("\n");
    cursor = idx + seg.length;
  }

  if (firstMatchIdx === -1) return null;
  const next = content.slice(0, firstMatchIdx) + out + content.slice(cursor);
  return { ok: true, content: next, strategy: "ellipsis-elision" };
}

export interface ApplyAllFailure {
  blockIndex: number;
  reason: string;
  nearestContext?: string;
}

export type ApplyAllResult =
  | { ok: true; content: string; strategiesUsed: ApplyStrategy[] }
  | { ok: false; failure: ApplyAllFailure };

/** Apply a sequence of edit blocks to a file's content, in order. */
export function applyEdits(content: string, blocks: EditBlock[]): ApplyAllResult {
  let current = content;
  const strategiesUsed: ApplyStrategy[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const result = applyEditBlock(current, blocks[i]!);
    if (!result.ok) {
      return { ok: false, failure: { blockIndex: i, reason: result.reason, nearestContext: result.nearestContext } };
    }
    current = result.content;
    strategiesUsed.push(result.strategy);
  }
  return { ok: true, content: current, strategiesUsed };
}
