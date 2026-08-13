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
});
