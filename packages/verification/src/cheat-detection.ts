import { parseUnifiedDiff, type FileDiff } from "./diff-parser.js";

/**
 * Cheating detection (PROJECT_SPEC.md §14.6) — deterministic, diff-based,
 * never model-judgment. Any flag forces human review and blocks
 * DONE-SUCCESS regardless of green tests (§14.7). This is the single most
 * valuable, most-neglected verification feature per the spec's competitive
 * analysis (§23.2) — no reference project studied for this repo has it.
 */

export type CheatRule =
  | "removed-test-assertions"
  | "weakened-assertion"
  | "added-skip-marker"
  | "swallowed-error"
  | "unexplained-snapshot-edit"
  | "possible-hardcoded-output";

export interface CheatFlag {
  rule: CheatRule;
  file: string;
  message: string;
  evidence: string[];
}

const TEST_FILE_RE = /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/|(^|\/)test_[^/]+\.py$|_test\.go$)/i;
const ASSERTION_OR_TEST_DECL_RE =
  /\b(it|test|describe)\s*\(|(^|\s)assert(_equal|equal)?\s*\(|expect\s*\(|self\.assert\w+\s*\(/;
const TRIVIAL_ASSERTION_RE =
  /assert\s+true\b|assert\s+1\s*==\s*1|expect\(true\)\.toBe\(true\)|\.toBeDefined\(\)\s*;?\s*$|assertTrue\(true\)/i;
const SKIP_MARKER_RE = /\.skip\s*\(|\.only\s*\(|\bxit\s*\(|\bxdescribe\s*\(|@pytest\.mark\.(skip|xfail)|\bt\.Skip\s*\(/;
// Matches both a same-line `except: pass` / `catch (e) {}` and Python's
// usual two-line `except:` / `    pass` shape (checked against the whole
// added-lines block joined by newlines, not line-by-line).
const SWALLOWED_ERROR_RE = /except\s*(\w+\s*)?:\s*\n?\s*pass\b|catch\s*\([^)]*\)\s*\{\s*\}/;
const SNAPSHOT_FILE_RE = /(^|\/)__snapshots__\/|\.snap$/i;

function countMatches(lines: string[], re: RegExp): string[] {
  return lines.filter((l) => re.test(l));
}

function checkRemovedTestAssertions(file: FileDiff): CheatFlag | null {
  if (!TEST_FILE_RE.test(file.path)) return null;
  const removedAssertions = countMatches(file.removedLines, ASSERTION_OR_TEST_DECL_RE);
  const addedAssertions = countMatches(file.addedLines, ASSERTION_OR_TEST_DECL_RE);
  if (removedAssertions.length > 0 && removedAssertions.length > addedAssertions.length) {
    return {
      rule: "removed-test-assertions",
      file: file.path,
      message: "a test file lost more assertions/test cases than it gained — possible test deletion to force green",
      evidence: removedAssertions.slice(0, 10)
    };
  }
  return null;
}

function checkWeakenedAssertion(file: FileDiff): CheatFlag | null {
  const trivialAdded = countMatches(file.addedLines, TRIVIAL_ASSERTION_RE);
  if (trivialAdded.length === 0) return null;
  // Only meaningful in test files, or files that clearly contained assertions before.
  if (!TEST_FILE_RE.test(file.path) && countMatches(file.removedLines, ASSERTION_OR_TEST_DECL_RE).length === 0) {
    return null;
  }
  return {
    rule: "weakened-assertion",
    file: file.path,
    message: "an assertion was replaced with a trivially-true check",
    evidence: trivialAdded.slice(0, 10)
  };
}

function checkSkipMarker(file: FileDiff): CheatFlag | null {
  const added = countMatches(file.addedLines, SKIP_MARKER_RE);
  if (added.length === 0) return null;
  return {
    rule: "added-skip-marker",
    file: file.path,
    message: "a skip/xfail/.only marker was added, which can hide a failing test instead of fixing it",
    evidence: added.slice(0, 10)
  };
}

function checkSwallowedError(file: FileDiff): CheatFlag | null {
  // Checked against the joined block, not line-by-line, so a Python
  // `except:` / `    pass` pair spanning two added lines is still caught.
  const addedText = file.addedLines.join("\n");
  const match = SWALLOWED_ERROR_RE.exec(addedText);
  if (!match) return null;
  return {
    rule: "swallowed-error",
    file: file.path,
    message: "a bare except/empty catch was added around what may be the failing path",
    evidence: [match[0]]
  };
}

function checkHardcodedOutput(file: FileDiff): CheatFlag | null {
  // Heuristic, deliberately conservative (§14.6 is explicit this is a
  // heuristic flag): a function body that had substantial logic removed and
  // replaced by a single bare `return <literal>;` is worth a human's eyes,
  // not proof of cheating.
  const removedLogicLines = file.removedLines.filter((l) => l.trim().length > 0 && !/^\s*(\/\/|#|\*)/.test(l));
  const addedReturnLiteral = file.addedLines.filter((l) => /^\s*return\s+(['"`].*['"`]|-?\d+(\.\d+)?|true|false)\s*;?\s*$/.test(l));
  if (removedLogicLines.length >= 3 && addedReturnLiteral.length >= 1 && file.addedLines.filter((l) => l.trim()).length <= 2) {
    return {
      rule: "possible-hardcoded-output",
      file: file.path,
      message: "substantial logic was removed and replaced by a bare literal return — verify this isn't hardcoding the expected test output",
      evidence: addedReturnLiteral.slice(0, 5)
    };
  }
  return null;
}

function checkSnapshotEdit(files: FileDiff[]): CheatFlag[] {
  const snapshotFiles = files.filter((f) => SNAPSHOT_FILE_RE.test(f.path));
  if (snapshotFiles.length === 0) return [];

  const nonTestNonSnapshotFiles = files.filter((f) => !SNAPSHOT_FILE_RE.test(f.path) && !TEST_FILE_RE.test(f.path));
  if (nonTestNonSnapshotFiles.length > 0) return []; // there's a source-code rationale for the snapshot change

  return snapshotFiles.map((f) => ({
    rule: "unexplained-snapshot-edit" as const,
    file: f.path,
    message: "a snapshot/golden file changed with no corresponding non-test source change in the same diff",
    evidence: [`${f.addedLines.length} line(s) added, ${f.removedLines.length} line(s) removed`]
  }));
}

/** Analyze a unified diff (e.g. `git diff base..HEAD`) for the §14.6 cheat patterns. */
export function detectCheats(diffText: string): CheatFlag[] {
  const files = parseUnifiedDiff(diffText);
  const flags: CheatFlag[] = [];

  for (const file of files) {
    const perFileChecks = [checkRemovedTestAssertions, checkWeakenedAssertion, checkSkipMarker, checkSwallowedError, checkHardcodedOutput];
    for (const check of perFileChecks) {
      const flag = check(file);
      if (flag) flags.push(flag);
    }
  }

  flags.push(...checkSnapshotEdit(files));

  return flags;
}
