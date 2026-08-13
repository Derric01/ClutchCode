import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, makeTestContext } from "../test-helpers.js";
import { searchTool } from "./search.js";
import type { ToolContext } from "../types.js";

describe("search tool", () => {
  let workspace: string;
  let ctx: ToolContext;

  beforeEach(() => {
    workspace = makeTempWorkspace();
    ctx = makeTestContext(workspace);
    fs.writeFileSync(path.join(workspace, "a.ts"), "export function needleFn() { return 1; }\n");
    fs.writeFileSync(path.join(workspace, "b.ts"), "// no match here\n");
    fs.mkdirSync(path.join(workspace, "sub"));
    fs.writeFileSync(path.join(workspace, "sub", "c.ts"), "const needleFn2 = () => needleFn();\n");
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(ctx.evidenceDir, { recursive: true, force: true });
  });

  it("finds matches by regex pattern across the workspace", async () => {
    const r = await searchTool.run({ pattern: "needleFn" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.totalCount).toBeGreaterThanOrEqual(2);
    const files = r.data!.matches.map((m) => m.file);
    expect(files.some((f) => f.endsWith("a.ts"))).toBe(true);
  });

  it("returns an empty (not failed) result for a pattern with no matches", async () => {
    const r = await searchTool.run({ pattern: "definitely-not-present-xyz" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.totalCount).toBe(0);
  });

  it("caps results to topK and reports truncation", async () => {
    const r = await searchTool.run({ pattern: "needleFn", topK: 1 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.matches.length).toBe(1);
    expect(r.data!.truncated).toBe(true);
  });
});
