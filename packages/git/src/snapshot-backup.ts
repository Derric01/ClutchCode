import fs from "node:fs";
import path from "node:path";

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
  private readonly snapshotted = new Set<string>();

  constructor(workspaceRoot: string, opts: SnapshotBackupOptions) {
    this.workspaceRoot = workspaceRoot;
    this.backupDir = opts.backupDir;
  }

  /** Snapshot a file's pre-edit state, once, before its first edit this run. */
  snapshotBeforeFirstEdit(relPath: string): void {
    if (this.snapshotted.has(relPath)) return;
    this.snapshotted.add(relPath);

    const src = path.join(this.workspaceRoot, relPath);
    const dest = path.join(this.backupDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      fs.writeFileSync(dest + ABSENT_MARKER, "");
    }
  }

  /** All paths snapshotted so far this run. */
  touchedPaths(): string[] {
    return [...this.snapshotted];
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
    for (const relPath of this.snapshotted) {
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
}
