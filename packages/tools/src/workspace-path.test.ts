import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInWorkspace } from "./workspace-path.js";
import { makeTempWorkspace } from "./test-helpers.js";

describe("resolveInWorkspace", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = makeTempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("an ordinary relative path inside the workspace is inside", () => {
    const { inside, abs } = resolveInWorkspace(workspace, "src/foo.ts");
    expect(inside).toBe(true);
    expect(abs).toBe(path.join(workspace, "src", "foo.ts"));
  });

  it("an absolute path outside the workspace is not inside", () => {
    expect(resolveInWorkspace(workspace, "/etc/passwd").inside).toBe(false);
  });

  it("a `..`-relative path escaping the workspace is not inside", () => {
    expect(resolveInWorkspace(workspace, "../../../etc/passwd").inside).toBe(false);
  });

  it("a nonexistent path is still correctly judged inside the workspace (no false negative just because nothing exists yet)", () => {
    expect(resolveInWorkspace(workspace, "brand/new/file.txt").inside).toBe(true);
  });

  it("real gap caught in round 3 of security review, reproduced against a real symlink: a workspace-relative path through a symlinked directory that points outside the workspace is NOT reported as inside, even though the string-only path still starts with the workspace root", () => {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "clutchcode-workspace-path-outside-"));
    try {
      fs.symlinkSync(outside, path.join(workspace, "shared"));
      const { abs, inside } = resolveInWorkspace(workspace, "shared/pwned.txt");
      // The string-prefix view still looks "inside" — that's exactly the bug:
      expect(abs.startsWith(workspace + path.sep)).toBe(true);
      // But real containment, resolved through the symlink, is not:
      expect(inside).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("a symlinked directory that points back INSIDE the workspace is still correctly reported as inside (not an over-broad fix)", () => {
    fs.mkdirSync(path.join(workspace, "real-target"));
    fs.symlinkSync(path.join(workspace, "real-target"), path.join(workspace, "alias"));
    expect(resolveInWorkspace(workspace, "alias/file.txt").inside).toBe(true);
  });

  it("follow-up gap: a DANGLING symlink (target doesn't exist yet) pointing outside the workspace is NOT reported as inside — reproduced for real, confirmed the pre-fix code reports this as inside AND that write_file's own fs.writeFileSync genuinely follows it (see read-write-edit.test.ts)", () => {
    const outsideDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "clutchcode-workspace-path-dangling-"));
    try {
      const target = path.join(outsideDir, "pwned.txt");
      expect(fs.existsSync(target)).toBe(false); // the target must not exist yet — that's the whole bug
      fs.symlinkSync(target, path.join(workspace, "link"));
      const { inside } = resolveInWorkspace(workspace, "link");
      expect(inside).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("a dangling symlink whose target is genuinely inside the workspace is still correctly reported as inside", () => {
    fs.mkdirSync(path.join(workspace, "sub"));
    fs.symlinkSync(path.join(workspace, "sub", "not-created-yet.txt"), path.join(workspace, "link"));
    expect(resolveInWorkspace(workspace, "link").inside).toBe(true);
  });

  it("`real` resolves a same-workspace symlink alias to its actual target — the follow-up denylist-bypass gap this field exists to close (see the tool-layer test in read-write-edit.test.ts)", () => {
    fs.writeFileSync(path.join(workspace, ".env"), "SECRET=1\n", "utf8");
    fs.symlinkSync(path.join(workspace, ".env"), path.join(workspace, "notenv.txt"));
    const { real, inside } = resolveInWorkspace(workspace, "notenv.txt");
    expect(inside).toBe(true); // still correctly inside — this was never the escape bug
    expect(real).toBe(fs.realpathSync(path.join(workspace, ".env")));
  });

  it("a symlink cycle is refused loudly instead of spinning forever — the 40-hop guard (mirrors Linux's MAXSYMLINKS) that the escape fixes above depend on to terminate at all", () => {
    // Without the hop limit this input does not fail, it *hangs*: realpathSync
    // throws ELOOP so the component walk takes over, and the walk follows
    // a -> b -> a forever. A guard whose only job is to stop an infinite loop
    // is exactly the kind of error path that silently rots untested, so it is
    // pinned here.
    fs.symlinkSync(path.join(workspace, "loop-b"), path.join(workspace, "loop-a"));
    fs.symlinkSync(path.join(workspace, "loop-a"), path.join(workspace, "loop-b"));
    expect(() => resolveInWorkspace(workspace, "loop-a")).toThrow(/too many levels of symbolic links/);
  });

  it("a self-referential symlink is refused the same way", () => {
    fs.symlinkSync(path.join(workspace, "self"), path.join(workspace, "self"));
    expect(() => resolveInWorkspace(workspace, "self")).toThrow(/too many levels of symbolic links/);
  });

  it("a chain of symlinks (some dangling) that eventually escapes the workspace is NOT reported as inside", () => {
    const outsideDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "clutchcode-workspace-path-chain-"));
    try {
      const finalTarget = path.join(outsideDir, "final.txt");
      fs.symlinkSync(finalTarget, path.join(workspace, "hop2")); // dangling, points outside
      fs.symlinkSync(path.join(workspace, "hop2"), path.join(workspace, "hop1")); // points at hop2
      expect(resolveInWorkspace(workspace, "hop1").inside).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
