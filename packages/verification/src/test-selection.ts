import path from "node:path";

/**
 * Test selection (PROJECT_SPEC.md §14.4) — "don't run 20 min on a 1-line
 * change." Phase 1 heuristic: map changed files to test files by naming
 * convention (path+import heuristics, per the spec's own admission that
 * impact-mapping is language-dependent and starts simple, §14.4 note).
 * Falls back to the full suite whenever any changed file can't be
 * confidently mapped, rather than risk skipping a real regression.
 */

export interface SelectedTests {
  selected: string[];
  runFullSuite: boolean;
}

function baseNameNoExt(file: string): string {
  return path.basename(file).replace(/\.[^./]+$/, "");
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

function baseNameOfDir(dir: string): string {
  const idx = dir.lastIndexOf("/");
  return idx === -1 ? dir : dir.slice(idx + 1);
}

const TEST_DIR_NAME_RE = /^(__tests__|tests?|specs?)$/i;

/**
 * Are two directories a plausible "changed file" / "its test" pairing?
 * Real gap caught in round 3 of security review: the basename match below
 * had no directory/relatedness check at all, so an unrelated same-named
 * test file *anywhere else in the repo* satisfied the "this file was
 * mapped" condition — e.g. changing `src/moduleA/helpers.ts` (whose real
 * coverage is `src/moduleA/moduleA.test.ts`, a different basename) could
 * find an unrelated `src/moduleB/helpers.test.ts` via basename alone,
 * `anyUnmapped` never fires, and `moduleA.test.ts` — the test that would
 * actually catch a regression — never runs.
 *
 * Deliberately conservative: same directory; a conventionally-named test
 * subdirectory (`__tests__`/`test`/`tests`/`spec`/`specs`) directly under
 * the other; or sibling directories at the same level where *one* of the
 * two directory names is itself conventionally test-shaped (a top-level
 * `src/` + `test/` split). Two same-parent directories with otherwise
 * unrelated names (`src/moduleA` vs. `src/moduleB`) do NOT count — that's
 * exactly the false-positive case above.
 */
function relatedDirs(changedDir: string, testDir: string): boolean {
  if (changedDir === testDir) return true;
  if (dirOf(testDir) === changedDir && TEST_DIR_NAME_RE.test(baseNameOfDir(testDir))) return true;
  if (dirOf(changedDir) === testDir && TEST_DIR_NAME_RE.test(baseNameOfDir(changedDir))) return true;
  return (
    dirOf(changedDir) === dirOf(testDir) &&
    (TEST_DIR_NAME_RE.test(baseNameOfDir(changedDir)) || TEST_DIR_NAME_RE.test(baseNameOfDir(testDir)))
  );
}

export function selectImpactedTests(changedFiles: string[], allTestFiles: string[]): SelectedTests {
  if (changedFiles.length === 0) return { selected: [], runFullSuite: false };

  const selected = new Set<string>();
  let anyUnmapped = false;

  for (const file of changedFiles) {
    // A test file changing directly always maps to itself.
    if (/(\.test\.|\.spec\.)/i.test(file) || /(^|\/)test_[^/]+\.py$/i.test(file) || /_test\.go$/i.test(file)) {
      selected.add(file);
      continue;
    }

    const base = baseNameNoExt(file);
    const changedDir = dirOf(file);
    const matches = allTestFiles.filter((t) => {
      const tBase = baseNameNoExt(t);
      const nameMatches = tBase === base || tBase === `${base}.test` || tBase === `${base}.spec` || tBase === `test_${base}` || tBase === `${base}_test`;
      return nameMatches && relatedDirs(changedDir, dirOf(t));
    });

    if (matches.length === 0) {
      anyUnmapped = true;
      continue;
    }
    for (const m of matches) selected.add(m);
  }

  if (anyUnmapped || selected.size === 0) return { selected: [], runFullSuite: true };
  return { selected: [...selected], runFullSuite: false };
}
