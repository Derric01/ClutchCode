import fs from "node:fs";
import path from "node:path";

/**
 * Test-file discovery for §14.4 test selection. Deliberately simple
 * (directory walk + name-pattern match, no external glob dependency) —
 * this only needs to answer "which files in the repo look like tests" so
 * `selectImpactedTests` has something to map changed files onto.
 */

const TEST_NAME_RE = /(\.test\.|\.spec\.)[^/]+$|(^|\/)test_[^/]+\.py$|_test\.go$/i;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".venv", "venv", "__pycache__", "target"]);

export interface FindTestFilesOptions {
  maxFiles?: number;
}

/** Returns test-file paths relative to `root`. */
export function findTestFiles(root: string, opts: FindTestFilesOptions = {}): string[] {
  const maxFiles = opts.maxFiles ?? 5000;
  const results: string[] = [];

  function walk(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
      } else if (entry.isFile() && TEST_NAME_RE.test(entry.name)) {
        results.push(path.relative(root, abs));
      }
    }
  }

  walk(root);
  return results;
}
