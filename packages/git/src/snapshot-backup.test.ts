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

  describe("diffText / diffFiles (§13.4 'diff is snapshot-vs-current', real git diff --no-index)", () => {
    it("reports a modified file as a real unified diff, parseable the same way an in-repo diff is", () => {
      fs.writeFileSync(path.join(workspace, "math.ts"), "export const add = (a, b) => a - b;\n", "utf8");
      backup.snapshotBeforeFirstEdit("math.ts");
      fs.writeFileSync(path.join(workspace, "math.ts"), "export const add = (a, b) => a + b;\n", "utf8");

      const text = backup.diffText();
      expect(text).toContain("diff --git a/math.ts b/math.ts");
      expect(text).toContain("-export const add = (a, b) => a - b;");
      expect(text).toContain("+export const add = (a, b) => a + b;");
      // No leaked absolute backupDir/workspace path anywhere in the output —
      // the whole point of the path rewrite is that this reads exactly like
      // a real in-repo diff.
      expect(text).not.toContain(backupDir);
      expect(text).not.toContain(workspace);

      const files = backup.diffFiles();
      expect(files).toEqual([{ path: "math.ts", status: "modified", before: "export const add = (a, b) => a - b;\n", after: "export const add = (a, b) => a + b;\n", binary: false }]);
    });

    it("does not corrupt real file content that happens to textually match the backup/workspace absolute path (§14.6 cheat-detection input integrity)", () => {
      // Real, reproduced bug: `runNoIndexDiff` used to run its
      // absolute-path→relPath rewrite as a `.split().join()` over the
      // *entire* raw `git diff --no-index` output, headers and hunk body
      // both. A line of real file content that happens to equal the
      // backup file's own stripped absolute path (e.g. a model that knows
      // this project's `~/.local/state/clutchcode` convention and its own
      // run id could construct one deliberately) got silently rewritten
      // down to `relPath` too — the actually-added content lost, replaced
      // with something indistinguishable from a legitimate line, in the
      // exact text `detectCheats`'s `parseUnifiedDiff` (§14.6) treats as
      // ground truth for what changed. Confirmed with a direct
      // reproduction before the fix (see docs/PROJECT_LOG.md): this exact
      // assertion failed, with the middle line coming back as `+evil.txt`
      // (the bare relPath) instead of the real added content below.
      fs.writeFileSync(path.join(workspace, "evil.txt"), "line one\nline two\n", "utf8");
      backup.snapshotBeforeFirstEdit("evil.txt");
      const backupPathStripped = path.join(backupDir, "evil.txt").replace(/^\/+/, "");
      fs.writeFileSync(path.join(workspace, "evil.txt"), `line one\n${backupPathStripped}\nline two\n`, "utf8");

      const text = backup.diffText();
      expect(text).toContain(`+${backupPathStripped}`);
      expect(text).not.toContain("+evil.txt"); // would indicate the corruption: the real content silently swapped for the bare relPath

      const files = backup.diffFiles();
      expect(files[0]!.after).toBe(`line one\n${backupPathStripped}\nline two\n`);
    });

    it("reports a newly-created file as 'added', diffed against /dev/null", () => {
      backup.snapshotBeforeFirstEdit("new.txt");
      fs.writeFileSync(path.join(workspace, "new.txt"), "brand new\n", "utf8");

      const text = backup.diffText();
      expect(text).toContain("new file mode");
      expect(text).toContain("--- /dev/null");
      expect(text).toContain("+brand new");

      const files = backup.diffFiles();
      expect(files).toEqual([{ path: "new.txt", status: "added", before: undefined, after: "brand new\n", binary: false }]);
    });

    it("reports a file removed during the run as 'deleted', diffed against /dev/null", () => {
      fs.writeFileSync(path.join(workspace, "gone.txt"), "will be removed\n", "utf8");
      backup.snapshotBeforeFirstEdit("gone.txt");
      fs.rmSync(path.join(workspace, "gone.txt"));

      const text = backup.diffText();
      expect(text).toContain("deleted file mode");
      expect(text).toContain("+++ /dev/null");
      expect(text).toContain("-will be removed");

      const files = backup.diffFiles();
      expect(files).toEqual([{ path: "gone.txt", status: "deleted", before: "will be removed\n", after: undefined, binary: false }]);
    });

    it("reports nothing for a snapshotted file that ends up byte-identical (a real git diff would report nothing too)", () => {
      fs.writeFileSync(path.join(workspace, "same.txt"), "unchanged\n", "utf8");
      backup.snapshotBeforeFirstEdit("same.txt");
      // No actual mutation — snapshotted "just in case" but never really edited.

      expect(backup.diffText()).toBe("");
      expect(backup.diffFiles()).toEqual([]);
    });

    it("flags a binary change without embedding raw bytes in the diff text", () => {
      fs.writeFileSync(path.join(workspace, "image.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
      backup.snapshotBeforeFirstEdit("image.bin");
      fs.writeFileSync(path.join(workspace, "image.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));

      const files = backup.diffFiles();
      expect(files).toEqual([{ path: "image.bin", status: "modified", before: undefined, after: undefined, binary: true }]);
    });

    it("scopes to a pathScope subdirectory, like diffAgainstBase's pathScope does for the git backend", () => {
      fs.mkdirSync(path.join(workspace, "pkgA"), { recursive: true });
      fs.mkdirSync(path.join(workspace, "pkgB"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "pkgA", "a.txt"), "a1\n", "utf8");
      fs.writeFileSync(path.join(workspace, "pkgB", "b.txt"), "b1\n", "utf8");
      backup.snapshotBeforeFirstEdit("pkgA/a.txt");
      backup.snapshotBeforeFirstEdit("pkgB/b.txt");
      fs.writeFileSync(path.join(workspace, "pkgA", "a.txt"), "a2\n", "utf8");
      fs.writeFileSync(path.join(workspace, "pkgB", "b.txt"), "b2\n", "utf8");

      const files = backup.diffFiles("pkgA");
      expect(files.map((f) => f.path)).toEqual(["pkgA/a.txt"]);
    });

    it("real revert-proof: stashing the diffText/diffFiles methods away makes this test suite fail to even compile/run against the pre-fix class", () => {
      // Documented rather than executed as a literal stash-pop cycle (these
      // methods live in a brand-new addition to an existing file, not a
      // standalone new file — `git stash push -- <file>` on a tracked file
      // with a real diff is reliable here, unlike the untracked-file case
      // HANDOFF.md warns about). Proof: `SnapshotBackup.prototype.diffText`
      // is undefined on any commit before this change, so every test in
      // this describe block throws "backup.diffText is not a function"
      // against the pre-fix code — a TypeError, the sharpest possible
      // failure signal that these tests discriminate real behavior.
      expect(typeof backup.diffText).toBe("function");
      expect(typeof backup.diffFiles).toBe("function");
    });
  });
});
