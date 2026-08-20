import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, makeTestContext } from "../test-helpers.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";
import type { ToolContext } from "../types.js";

describe("read_file / write_file / edit_file", () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeEach(() => {
    workspace = makeTempWorkspace();
    ctx = makeTestContext(workspace);
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(ctx.evidenceDir, { recursive: true, force: true });
  });

  it("write_file creates a new file, read_file reads it back", async () => {
    const w = await writeFileTool.run({ path: "hello.txt", body: "hello world\n" }, ctx);
    expect(w.ok).toBe(true);
    expect(w.data?.created).toBe(true);

    const r = await readFileTool.run({ path: "hello.txt" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.content).toBe("hello world\n");
  });

  it("read_file supports windowed reads", async () => {
    await writeFileTool.run({ path: "multi.txt", body: "l1\nl2\nl3\nl4\nl5" }, ctx);
    const r = await readFileTool.run({ path: "multi.txt", window: { startLine: 2, endLine: 3 } }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.content).toBe("l2\nl3");
    expect(r.data?.windowed).toBe(true);
  });

  it("read_file refuses paths outside the workspace", async () => {
    const r = await readFileTool.run({ path: "/etc/passwd" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("path-outside-workspace");
  });

  it("read_file refuses denylisted paths even inside the workspace", async () => {
    fs.writeFileSync(path.join(workspace, ".env"), "SECRET=1\n", "utf8");
    const r = await readFileTool.run({ path: ".env" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("denylisted");
  });

  it("write_file refuses to write a denylisted path", async () => {
    const w = await writeFileTool.run({ path: ".env", body: "SECRET=1\n" }, ctx);
    expect(w.ok).toBe(false);
    expect(w.error?.code).toBe("denylisted");
  });

  it("read_file returns not-found for a missing file", async () => {
    const r = await readFileTool.run({ path: "nope.txt" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not-found");
  });

  it("write_file refuses to escape the workspace", async () => {
    const r = await writeFileTool.run({ path: "../outside.txt", body: "x" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("path-outside-workspace");
    expect(fs.existsSync(path.join(workspace, "..", "outside.txt"))).toBe(false);
  });

  it("write_file refuses to escape the workspace through a symlinked directory (real vulnerability caught in round 3 of security review — a string-only containment check reported this as 'inside', so the PolicyEngine granted a bare ALLOW with no approval prompt at all, and fs.writeFileSync then genuinely followed the symlink outside the workspace)", async () => {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "clutchcode-symlink-escape-outside-"));
    try {
      fs.symlinkSync(outside, path.join(workspace, "shared"));
      const w = await writeFileTool.run({ path: "shared/pwned.txt", body: "attacker-controlled content" }, ctx);
      expect(w.ok).toBe(false);
      expect(w.error?.code).toBe("path-outside-workspace");
      expect(fs.existsSync(path.join(outside, "pwned.txt"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("read_file refuses to read through a symlinked directory that escapes the workspace (same mechanism as the write_file case above, but for arbitrary-file-read)", async () => {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "clutchcode-symlink-escape-read-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "top secret content", "utf8");
      fs.symlinkSync(outside, path.join(workspace, "shared"));
      const r = await readFileTool.run({ path: "shared/secret.txt" }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("path-outside-workspace");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("edit_file applies a SEARCH/REPLACE block to an existing file", async () => {
    await writeFileTool.run({ path: "code.ts", body: "export const x = 1;\n" }, ctx);
    const e = await editFileTool.run(
      { path: "code.ts", edits: [{ search: "const x = 1;", replace: "const x = 2;" }] },
      ctx
    );
    expect(e.ok).toBe(true);

    const r = await readFileTool.run({ path: "code.ts" }, ctx);
    expect(r.data?.content).toBe("export const x = 2;\n");
  });

  it("edit_file reports a structured failure with the failing block index", async () => {
    await writeFileTool.run({ path: "code.ts", body: "export const x = 1;\n" }, ctx);
    const e = await editFileTool.run(
      { path: "code.ts", edits: [{ search: "const y = 999;", replace: "const y = 1000;" }] },
      ctx
    );
    expect(e.ok).toBe(false);
    expect(e.error?.code).toBe("edit-block-failed");
  });

  it("edit_file on a nonexistent file fails not-found (use write_file to create)", async () => {
    const e = await editFileTool.run({ path: "ghost.ts", edits: [{ search: "a", replace: "b" }] }, ctx);
    expect(e.ok).toBe(false);
    expect(e.error?.code).toBe("not-found");
  });

  it("read_file scrubs a secret accidentally committed to a file it reads (§5.2)", async () => {
    const canary = "sk-ant-canarysecretvalue00000000000000";
    fs.writeFileSync(path.join(workspace, "oops.env.js"), `const key = "${canary}";\n`, "utf8");
    const r = await readFileTool.run({ path: "oops.env.js" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.content).not.toContain(canary);
    expect(r.data?.content).toContain("«REDACTED:");
  });

  it("read_file refuses binary content instead of returning garbled text (§4.5/§13.4)", async () => {
    fs.writeFileSync(path.join(workspace, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
    const r = await readFileTool.run({ path: "image.png" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("binary-file");
  });

  it("read_file recognizes an LFS pointer file and doesn't dump the pointer stub as real content (§13.4)", async () => {
    const pointer = [
      "version https://git-lfs.github.com/spec/v1",
      "oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
      "size 999999",
      ""
    ].join("\n");
    fs.writeFileSync(path.join(workspace, "asset.psd"), pointer, "utf8");
    const r = await readFileTool.run({ path: "asset.psd" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.lfsPointer).toBe(true);
    expect(r.data?.content).toContain("999999");
    expect(r.data?.content).not.toContain("version https://git-lfs.github.com/spec/v1");
  });
});

describe("write_file / edit_file inside a git submodule (§13.4)", () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeEach(() => {
    workspace = makeTempWorkspace();
    ctx = makeTestContext(workspace, { submodulePaths: ["libs/vendored"] });
    fs.mkdirSync(path.join(workspace, "libs", "vendored"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "libs", "vendored", "existing.ts"), "export const x = 1;\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(ctx.evidenceDir, { recursive: true, force: true });
  });

  it("write_file inside a submodule needs approval, never silently allowed", async () => {
    const w = await writeFileTool.run({ path: "libs/vendored/new.ts", body: "export const y = 1;\n" }, ctx);
    expect(w.ok).toBe(false);
    expect(w.error?.code).toBe("needs-approval");
    expect(w.error?.message).toMatch(/submodule/);
    expect(fs.existsSync(path.join(workspace, "libs", "vendored", "new.ts"))).toBe(false);
  });

  it("edit_file inside a submodule needs approval, never silently allowed", async () => {
    const e = await editFileTool.run(
      { path: "libs/vendored/existing.ts", edits: [{ search: "const x = 1;", replace: "const x = 2;" }] },
      ctx
    );
    expect(e.ok).toBe(false);
    expect(e.error?.code).toBe("needs-approval");
    expect(fs.readFileSync(path.join(workspace, "libs", "vendored", "existing.ts"), "utf8")).toContain("const x = 1;");
  });

  it("a write outside the submodule is unaffected", async () => {
    const w = await writeFileTool.run({ path: "src/main.ts", body: "ok\n" }, ctx);
    expect(w.ok).toBe(true);
  });
});

describe("write_file / edit_file flag LFS-tracked paths (§13.4)", () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeEach(() => {
    workspace = makeTempWorkspace();
    ctx = makeTestContext(workspace, { lfsPatterns: ["*.bin"] });
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(ctx.evidenceDir, { recursive: true, force: true });
  });

  it("write_file flags an LFS-tracked path but still allows the write", async () => {
    const w = await writeFileTool.run({ path: "assets/blob.bin", body: "x" }, ctx);
    expect(w.ok).toBe(true);
    expect(w.data?.lfsTracked).toBe(true);
  });

  it("write_file does not flag a non-matching path", async () => {
    const w = await writeFileTool.run({ path: "src/main.ts", body: "ok\n" }, ctx);
    expect(w.ok).toBe(true);
    expect(w.data?.lfsTracked).toBe(false);
  });

  it("edit_file flags an LFS-tracked path but still applies the edit", async () => {
    await writeFileTool.run({ path: "assets/blob.bin", body: "before\n" }, ctx);
    const e = await editFileTool.run({ path: "assets/blob.bin", edits: [{ search: "before", replace: "after" }] }, ctx);
    expect(e.ok).toBe(true);
    expect(e.data?.lfsTracked).toBe(true);
  });
});
