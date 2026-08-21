import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "./test-helpers.js";
import { SnapshotBackup } from "./snapshot-backup.js";

describe("SnapshotBackup (§13.4 non-git fallback)", () => {
  let workspace: string;
  let backupDir: string;
  let backup: SnapshotBackup;

  beforeEach(() => {
    workspace = makeTempDir("clutchcode-snapshot-ws-");
    backupDir = makeTempDir("clutchcode-snapshot-backup-");
    backup = new SnapshotBackup(workspace, { backupDir });
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it("restores an edited file to its pre-edit content", () => {
    fs.writeFileSync(path.join(workspace, "a.txt"), "original\n", "utf8");
    backup.snapshotBeforeFirstEdit("a.txt");
    fs.writeFileSync(path.join(workspace, "a.txt"), "modified\n", "utf8");

    backup.rollback();

    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf8")).toBe("original\n");
  });

  it("removes a file that did not exist before the run", () => {
    backup.snapshotBeforeFirstEdit("new.txt"); // taken before the file exists
    fs.writeFileSync(path.join(workspace, "new.txt"), "created during run\n", "utf8");

    backup.rollback();

    expect(fs.existsSync(path.join(workspace, "new.txt"))).toBe(false);
  });

  it("only snapshots a path once even if edited multiple times", () => {
    fs.writeFileSync(path.join(workspace, "a.txt"), "v1\n", "utf8");
    backup.snapshotBeforeFirstEdit("a.txt");
    fs.writeFileSync(path.join(workspace, "a.txt"), "v2\n", "utf8");
    backup.snapshotBeforeFirstEdit("a.txt"); // no-op, already snapshotted
    fs.writeFileSync(path.join(workspace, "a.txt"), "v3\n", "utf8");

    backup.rollback();

    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf8")).toBe("v1\n");
  });

  it("diff reports before/after content, with null for nonexistent states", () => {
    backup.snapshotBeforeFirstEdit("created.txt");
    fs.writeFileSync(path.join(workspace, "created.txt"), "content\n", "utf8");

    const diff = backup.diff();
    expect(diff).toEqual([{ path: "created.txt", before: null, after: "content\n" }]);
  });

  it("still handles a legitimate nested subdirectory relPath", () => {
    fs.mkdirSync(path.join(workspace, "src", "nested"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "nested", "file.ts"), "v1\n", "utf8");
    backup.snapshotBeforeFirstEdit("src/nested/file.ts");
    fs.writeFileSync(path.join(workspace, "src", "nested", "file.ts"), "v2\n", "utf8");

    backup.rollback();

    expect(fs.readFileSync(path.join(workspace, "src", "nested", "file.ts"), "utf8")).toBe("v1\n");
  });

  describe("relPath traversal (§13.4, round-3-deferred finding)", () => {
    it("rejects a '..'-traversal relPath outright, before touching disk", () => {
      expect(() => backup.snapshotBeforeFirstEdit("../outside.txt")).toThrow(/invalid relative path/);
      // Nothing at all should have been written under backupDir for the
      // rejected call.
      expect(fs.readdirSync(backupDir)).toEqual([]);
      // Nor should the (rejected) path have been recorded as snapshotted —
      // a later rollback() must not try to touch it.
      expect(backup.touchedPaths()).toEqual([]);
    });

    it("rejects a deeply-nested '..' segment", () => {
      expect(() => backup.snapshotBeforeFirstEdit("a/b/../../../etc/passwd")).toThrow(/invalid relative path/);
    });

    it("rejects an absolute relPath", () => {
      expect(() => backup.snapshotBeforeFirstEdit("/etc/passwd")).toThrow(/invalid relative path/);
    });

    it(
      "reproduces the real pre-fix escape: without the guard, a traversal relPath would write a " +
        "backup file outside backupDir entirely",
      () => {
        // Distinct-depth roots, same setup used to first reproduce this bug
        // manually: a single ".." count resolves to a different absolute
        // location depending on which root (workspaceRoot vs backupDir) it's
        // applied to, so the two escape directions can't accidentally
        // collide on the same file and mask each other.
        const container = makeTempDir("clutchcode-snapshot-container-");
        const backupParent = fs.mkdtempSync(path.join(container, "bp-"));
        const nestedBackupDir = fs.mkdtempSync(path.join(backupParent, "backup-"));
        const nestedWorkspace = fs.mkdtempSync(path.join(container, "ws-"));
        const nestedBackup = new SnapshotBackup(nestedWorkspace, { backupDir: nestedBackupDir });

        const canaryPath = path.join(container, "canary.txt");
        fs.writeFileSync(canaryPath, "CANARY-ORIGINAL\n", "utf8");
        const relPath = path.relative(nestedWorkspace, canaryPath); // "../canary.txt"

        expect(() => nestedBackup.snapshotBeforeFirstEdit(relPath)).toThrow(/invalid relative path/);

        // The would-be escape destination must not exist — the guard fired
        // before any fs write happened.
        const wouldBeEscapeDest = path.join(nestedBackupDir, relPath);
        expect(fs.existsSync(wouldBeEscapeDest)).toBe(false);
        expect(fs.readdirSync(nestedBackupDir)).toEqual([]);

        fs.rmSync(container, { recursive: true, force: true });
      },
    );

    it(
      "reproduces the real pre-fix escape: without the guard, rollback() would overwrite a file " +
        "outside workspaceRoot entirely",
      () => {
        const container = makeTempDir("clutchcode-snapshot-container2-");
        const wsParent = fs.mkdtempSync(path.join(container, "wp-"));
        const nestedWorkspace = fs.mkdtempSync(path.join(wsParent, "ws-"));
        const nestedBackupDir = fs.mkdtempSync(path.join(container, "backup-"));
        const nestedBackup = new SnapshotBackup(nestedWorkspace, { backupDir: nestedBackupDir });

        const victimPath = path.join(container, "victim.txt");
        fs.writeFileSync(victimPath, "VICTIM-ORIGINAL\n", "utf8");
        const relPath = path.relative(nestedWorkspace, victimPath); // "../../victim.txt"

        expect(() => nestedBackup.snapshotBeforeFirstEdit(relPath)).toThrow(/invalid relative path/);

        // Simulate the run mutating the victim file directly — since the
        // snapshot call above was rejected, rollback() has nothing recorded
        // for this path and must leave the victim alone.
        fs.writeFileSync(victimPath, "VICTIM-TAMPERED-BY-RUN\n", "utf8");
        nestedBackup.rollback();
        expect(fs.readFileSync(victimPath, "utf8")).toBe("VICTIM-TAMPERED-BY-RUN\n");

        fs.rmSync(container, { recursive: true, force: true });
      },
    );
  });
});
