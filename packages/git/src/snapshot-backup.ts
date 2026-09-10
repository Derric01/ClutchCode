import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertContainedIn, assertSafeRelPath } from "./rel-path.js";
import type { FileDiff } from "./worktree.js";

/**
 * Non-git fallback (PROJECT_SPEC.md §13.4, "Not a git repo at all"):
 *
 * > Fallback: a snapshot backup of touched files to the state dir before
 * > first edit; "diff" is snapshot-vs-current; `agent rollback` restores
 * > snapshots. Worktree isolation is unavailable, so the destructive-gate +
 * > backups carry more weight.
 */

const ABSENT_MARKER = ".__absent__";

export interface SnapshotBackupOptions {
  /** Where backups are stored, e.g. `~/.local/state/clutchcode/runs/<run_id>/snapshots`. */
  backupDir: string;
}

export interface SnapshotDiffEntry {
  path: string;
  before: string | null; // null = file did not exist before this run
  after: string | null; // null = file no longer exists
}

export class SnapshotBackup {
  private readonly backupDir: string;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string, opts: SnapshotBackupOptions) {
    this.workspaceRoot = workspaceRoot;
    this.backupDir = opts.backupDir;
  }

  /**
   * Snapshot a file's pre-edit state, once, before its first edit this run.
   *
   * "Already snapshotted" is checked against **disk**, not an in-memory
   * set — real bug, caught by a real cross-process-shaped test (not this
   * file's own single-instance test suite, which never exercised it): a
   * `SnapshotRunBackend` is routinely reconstructed in a *different*
   * `SnapshotBackup` instance than the one that took the original
   * snapshots — `agent-api`'s `reviveRunBackend()` builds a fresh one from
   * persisted `{runId, workspaceRoot, backupDir}` data for every separate
   * `agent diff`/`approve`/`reject`/`resume` CLI invocation, exactly as
   * `worktree-store.ts`'s own doc comment says routinely happens. An
   * in-memory `Set` that only the *original* instance ever populated meant
   * every one of those later calls saw `touchedPaths() === []` — an empty
   * diff, zero checkpoints, and (worse than just "empty") a `reject()`
   * that silently restored nothing at all despite the file having
   * genuinely been overwritten on disk. Checking disk directly fixes both
   * `touchedPaths()` *and* a subtler correctness issue this same check
   * gates: without it, a `resume()` in a new process that re-edits a path
   * already backed up in an earlier partial run would re-run this method,
   * see an empty (fresh) in-memory set, and back up the file *again* —
   * capturing the already-mutated mid-run content as if it were the
   * original, corrupting the one safety net §13.4 promises.
   */
  snapshotBeforeFirstEdit(relPath: string): void {
    assertSafeRelPath(relPath);

    const src = path.join(this.workspaceRoot, relPath);
    const dest = path.join(this.backupDir, relPath);
    // Defense in depth: `assertSafeRelPath` already rejects any `..`
    // segment (the only way `path.join` can escape a root here), but
    // re-check the actual joined destinations too, the same
    // belt-and-suspenders pattern used for `runId` elsewhere in this
    // package — so a future change to the shape check alone can't quietly
    // reopen this class of bug.
    assertContainedIn(this.workspaceRoot, src);
    assertContainedIn(this.backupDir, dest);

    if (fs.existsSync(dest) || fs.existsSync(dest + ABSENT_MARKER)) return; // already backed up — this call, an earlier one, or an earlier process/instance entirely

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      fs.writeFileSync(dest + ABSENT_MARKER, "");
    }
  }

  /**
   * Every path snapshotted so far this run — derived from what's actually
   * on disk under `backupDir`, not an in-memory record (see
   * `snapshotBeforeFirstEdit`'s doc comment for why that distinction is
   * load-bearing, not stylistic).
   */
  touchedPaths(): string[] {
    if (!fs.existsSync(this.backupDir)) return [];
    const found = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        const rel = path.relative(this.backupDir, full);
        found.add(rel.endsWith(ABSENT_MARKER) ? rel.slice(0, -ABSENT_MARKER.length) : rel);
      }
    };
    walk(this.backupDir);
    return [...found];
  }

  /** "diff" is snapshot-vs-current (§13.4) — no git diff is available without a repo. */
  diff(): SnapshotDiffEntry[] {
    return this.touchedPaths().map((relPath) => {
      const backupPath = path.join(this.backupDir, relPath);
      const currentPath = path.join(this.workspaceRoot, relPath);
      const before = fs.existsSync(backupPath) ? fs.readFileSync(backupPath, "utf8") : null;
      const after = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, "utf8") : null;
      return { path: relPath, before, after };
    });
  }

  /** `agent rollback` without git: restore every snapshotted file to its pre-run state. */
  rollback(): void {
    for (const relPath of this.touchedPaths()) {
      const dest = path.join(this.workspaceRoot, relPath);
      const backupPath = path.join(this.backupDir, relPath);
      const absentMarker = backupPath + ABSENT_MARKER;

      if (fs.existsSync(backupPath)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(backupPath, dest);
      } else if (fs.existsSync(absentMarker)) {
        if (fs.existsSync(dest)) fs.rmSync(dest);
      }
    }
  }

  /**
   * `agent diff`'s text form, without a repo to `git diff` against (§13.4,
   * used for the non-git `RunBackend` in `@clutchcode/runtime`). Built on
   * real `git diff --no-index` — a documented git feature that compares two
   * arbitrary files/paths with **no repository required at all** (verified
   * empirically against a real non-git temp dir before relying on it: it
   * produces the exact same `diff --git a/… b/…` / `@@ …@@` unified-diff
   * format a real in-repo `git diff` does, including correct binary
   * detection and `/dev/null` add/delete markers) — so this output is
   * byte-for-byte compatible with what `detectCheats`'s `parseUnifiedDiff`
   * (§14.6) and every other consumer of `diffAgainstBase`'s text already
   * expect, with zero format-detection branching needed anywhere upstream.
   * Unchanged files (before === after) are omitted, exactly like a real
   * `git diff` reports nothing for a path with no changes.
   */
  diffText(pathScope?: string): string {
    return this.diffEntries(pathScope)
      .map((e) => e.text)
      .filter(Boolean)
      .join("");
  }

  /** Per-file before/after content (§18.5) — the snapshot-backend analogue of `diffFilesAgainstBase`. */
  diffFiles(pathScope?: string): FileDiff[] {
    return this.diffEntries(pathScope).map((e) => e.fileDiff);
  }

  private diffEntries(pathScope?: string): Array<{ text: string; fileDiff: FileDiff }> {
    const scoped = this.touchedPaths().filter((p) => !pathScope || p === pathScope || p.startsWith(`${pathScope}/`));
    const out: Array<{ text: string; fileDiff: FileDiff }> = [];

    for (const relPath of scoped) {
      const backupPath = path.join(this.backupDir, relPath);
      const currentPath = path.join(this.workspaceRoot, relPath);
      const backupExists = fs.existsSync(backupPath);
      const currentExists = fs.existsSync(currentPath);

      if (!backupExists && !currentExists) continue; // created then deleted again within this run — nothing to report

      const status: FileDiff["status"] = !backupExists ? "added" : !currentExists ? "deleted" : "modified";
      const beforeArg = backupExists ? backupPath : "/dev/null";
      const afterArg = currentExists ? currentPath : "/dev/null";

      const binary = status === "modified" && isBinaryNoIndexDiff(beforeArg, afterArg, this.workspaceRoot);
      const text = binary ? "" : runNoIndexDiff(beforeArg, afterArg, relPath, this.workspaceRoot);
      if (status === "modified" && !binary && !text) continue; // identical content — a real `git diff` reports nothing either

      out.push({
        text,
        fileDiff: {
          path: relPath,
          status,
          before: !binary && backupExists ? fs.readFileSync(backupPath, "utf8") : undefined,
          after: !binary && currentExists ? fs.readFileSync(currentPath, "utf8") : undefined,
          binary
        }
      });
    }
    return out;
  }
}

/**
 * `git diff --no-index` (unlike every *other* git subcommand this package
 * calls) deliberately behaves like `diff --exit-code`: exit 1 means "a real
 * diff was found" — the overwhelmingly common outcome here — not a
 * failure, so it is not treated as one. This is deliberately its own small
 * wrapper rather than a reuse of `git-exec.ts`'s shared `git()` helper:
 * `execFileSync` throws on *any* non-zero exit and Node discards the
 * captured stdout unless the catch handler reaches for `error.stdout`
 * specifically — `git()`'s own `allowFailure: true` doesn't do that (by
 * design: every other call site in this package that uses it wants "" on
 * failure, with no real content to recover), so reusing it here silently
 * threw away the actual diff text on every single non-empty diff. Real bug,
 * caught by this file's own tests failing (5 of 5 new assertions), not
 * assumed — see the git history for the pre-fix version if this needs
 * re-diagnosing. Scoped as a bespoke wrapper instead of changing `git()`
 * itself so every other caller's `allowFailure` contract is untouched.
 */
function execGitNoIndex(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50_000_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stdout?: Buffer | string; status?: number | null };
    if (err.status === 1 && err.stdout !== undefined) return err.stdout.toString();
    return ""; // a real failure (bad arg, unreadable file) — no meaningful stdout to recover, same posture as git()'s allowFailure elsewhere
  }
}

/**
 * `git diff --no-index --numstat` prints `-\t-\t<path>` for a binary pair —
 * git's own binary signal, the same one `worktree.ts`'s `isBinaryDiff` reads
 * for the git-worktree backend, reused here rather than re-guessing it.
 */
function isBinaryNoIndexDiff(beforeArg: string, afterArg: string, cwd: string): boolean {
  const out = execGitNoIndex(["diff", "--no-index", "--numstat", "--", beforeArg, afterArg], cwd);
  return out.trim().startsWith("-\t-\t");
}

/**
 * `--no-index` has no repo root to compute a clean relative path from, so
 * git's own output embeds whatever absolute path we hand it (leading `/`
 * stripped) instead of `relPath`. Rewritten below so this text is
 * indistinguishable from a real in-repo `git diff`'s output to any
 * consumer — none of which should need to know or care this run had no
 * repository at all. `/dev/null` (git's own added/deleted sentinel) is
 * left untouched, never rewritten.
 */
function runNoIndexDiff(beforeArg: string, afterArg: string, relPath: string, cwd: string): string {
  const raw = execGitNoIndex(["diff", "--no-index", "--src-prefix=a/", "--dst-prefix=b/", "--", beforeArg, afterArg], cwd);
  if (!raw.trim()) return "";
  let text = raw;
  if (beforeArg !== "/dev/null") text = text.split(stripLeadingSlash(beforeArg)).join(relPath);
  if (afterArg !== "/dev/null") text = text.split(stripLeadingSlash(afterArg)).join(relPath);
  return text.endsWith("\n") ? text : `${text}\n`;
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, "");
}
