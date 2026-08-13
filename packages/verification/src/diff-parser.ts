/** A minimal unified-diff parser — just enough for the cheat detectors (§14.6) to see added/removed lines per file. */

export interface FileDiff {
  path: string;
  addedLines: string[];
  removedLines: string[];
}

export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;

  for (const line of diffText.split("\n")) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (headerMatch) {
      current = { path: headerMatch[2]!, addedLines: [], removedLines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) current.addedLines.push(line.slice(1));
    else if (line.startsWith("-")) current.removedLines.push(line.slice(1));
  }

  return files;
}
