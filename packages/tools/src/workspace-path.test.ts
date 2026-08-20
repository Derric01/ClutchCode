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
});
