import fs from "node:fs";
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
});
