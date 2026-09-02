import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Repo hygiene: no tracked text source may contain a raw NUL byte, which makes
 * the file read as *binary* to ordinary tooling.
 *
 * Found for real, twice, and only because `grep` refused to print a match:
 * `evals/src/ab.ts` and `packages/runtime/src/tool-result-pruning.ts` each
 * embedded a literal NUL (0x00) inside a template literal as a composite-key
 * separator.
 *
 * The *runtime* behavior was correct and is unchanged. NUL is a sound
 * separator in both places, because `JSON.stringify` escapes NUL as a six-
 * character sequence, so a raw NUL can never appear inside `argsJson`. The
 * defect was in the source encoding, not the logic: a literal 0x00 makes git,
 * grep and diff viewers classify the file as binary, so grep answers "binary
 * file matches" instead of showing the line, and review of that file silently
 * degrades. Writing the same character as a unicode escape is byte-identical
 * at runtime and keeps the file text.
 *
 * This is the discriminating test for that fix: it fails against the pre-fix
 * tree (two offenders) and passes after. A behavioral test could not
 * discriminate, because the behavior is deliberately identical.
 */
describe("source hygiene", () => {
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs", "*.json", "*.md", "*.yml", "*.yaml"],
    { cwd: repoRoot, encoding: "buffer", maxBuffer: 50_000_000 }
  )
    .toString("utf8")
    .split("\u0000")
    .filter(Boolean);

  it("tracks a non-trivial number of text files (guards against the glob silently matching nothing)", () => {
    expect(tracked.length).toBeGreaterThan(100);
  });

  it("contains no raw NUL byte in any tracked text source - use a unicode escape instead", () => {
    const offenders: string[] = [];
    for (const rel of tracked) {
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs)) continue; // deleted-but-staged
      if (fs.readFileSync(abs).includes(0x00)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
