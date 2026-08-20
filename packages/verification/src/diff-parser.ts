/** A minimal unified-diff parser — just enough for the cheat detectors (§14.6) to see added/removed lines per file. */

export interface FileDiff {
  path: string;
  addedLines: string[];
  removedLines: string[];
}

export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  // Real gap caught in round 3 of security review: `line.startsWith("+++")`
  // /`"---"` was meant to skip only the two genuine `+++ b/path`/`--- a/path`
  // filename-header lines that appear once per file, but it matched on
  // *content* too — an added line whose real text happens to start with
  // `++` (renders as `+++x; ...`) or a removed line starting with `--`
  // (renders as `---x; ...`) was silently dropped before any cheat check
  // ever saw it. Those header lines only ever appear *before* the first
  // hunk of a file; once a `@@ ... @@` hunk header is seen, a `+`/`-`
  // prefixed line is unambiguously real diff content, never a header.
  let inHunk = false;

  for (const line of diffText.split("\n")) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (headerMatch) {
      current = { path: headerMatch[2]!, addedLines: [], removedLines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("+++") || line.startsWith("---"))) continue;
    if (line.startsWith("+")) current.addedLines.push(line.slice(1));
    else if (line.startsWith("-")) current.removedLines.push(line.slice(1));
  }

  return files;
}
