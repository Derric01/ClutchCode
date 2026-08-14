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
    const matches = allTestFiles.filter((t) => {
      const tBase = baseNameNoExt(t);
      return tBase === base || tBase === `${base}.test` || tBase === `${base}.spec` || tBase === `test_${base}` || tBase === `${base}_test`;
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
