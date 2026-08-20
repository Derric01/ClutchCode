import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff-parser.js";

function rawDiff(path: string, hunkLines: string[]): string {
  return [`diff --git a/${path} b/${path}`, "index 0000000..1111111 100644", `--- a/${path}`, `+++ b/${path}`, "@@ -1,1 +1,1 @@", ...hunkLines].join(
    "\n"
  );
}

describe("parseUnifiedDiff", () => {
  it("collects added and removed content lines, skipping the file-header +++ /--- lines", () => {
    const files = parseUnifiedDiff(rawDiff("src/a.ts", ["-old line", "+new line"]));
    expect(files).toHaveLength(1);
    expect(files[0]!.addedLines).toEqual(["new line"]);
    expect(files[0]!.removedLines).toEqual(["old line"]);
  });

  it("does not drop an added line whose real content starts with '++' — renders as '+++x...' (real gap caught in round 3 of security review: the old header-skip matched on any line starting with +++ /---, not just the genuine file-header lines)", () => {
    const files = parseUnifiedDiff(rawDiff("src/a.ts", ["+++x; it.skip('flaky', () => {});"]));
    expect(files[0]!.addedLines).toEqual(["++x; it.skip('flaky', () => {});"]);
  });

  it("does not drop a removed line whose real content starts with '--' — renders as '---x...'", () => {
    const files = parseUnifiedDiff(rawDiff("src/a.ts", ["---x = 1;"]));
    expect(files[0]!.removedLines).toEqual(["--x = 1;"]);
  });

  it("still correctly skips the genuine +++ /--- filename-header lines even when a second file follows", () => {
    const diff = [rawDiff("src/a.ts", ["+first file content"]), rawDiff("src/b.ts", ["+second file content"])].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0]!.addedLines).toEqual(["first file content"]);
    expect(files[1]!.addedLines).toEqual(["second file content"]);
  });
});
