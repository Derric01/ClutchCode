import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, makeTestContext } from "../test-helpers.js";
import { symbolsTool } from "./symbols.js";
import type { ToolContext } from "../types.js";

describe("symbols", () => {
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

  it("extracts symbols from a TypeScript file in the workspace", async () => {
    fs.writeFileSync(
      path.join(workspace, "math.ts"),
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf8"
    );
    const r = await symbolsTool.run({ path: "math.ts" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.language).toBe("typescript");
    expect(r.data?.symbols).toEqual([
      { kind: "function", name: "add", startLine: 1, endLine: 3, exported: true }
    ]);
  });

  it("refuses paths outside the workspace", async () => {
    const r = await symbolsTool.run({ path: "/etc/passwd" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("path-outside-workspace");
  });

  it("refuses denylisted paths even inside the workspace", async () => {
    fs.writeFileSync(path.join(workspace, ".env"), "export const SECRET = 1;\n", "utf8");
    const r = await symbolsTool.run({ path: ".env" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("denylisted");
  });

  it("returns not-found for a missing file", async () => {
    const r = await symbolsTool.run({ path: "nope.ts" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not-found");
  });

  it("returns unsupported-language for a non-JS/TS file", async () => {
    fs.writeFileSync(path.join(workspace, "script.py"), "def add(a, b):\n    return a + b\n", "utf8");
    const r = await symbolsTool.run({ path: "script.py" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("unsupported-language");
  });

  it("scrubs a secret-shaped symbol name (§5.2)", async () => {
    // A GitHub-token-shaped identifier: "ghp_" + 20+ alnum chars is both a
    // syntactically valid JS identifier and matches the redactor's github
    // pattern, so this exercises real (if pathological) redaction, not a
    // contrived string the extractor would never actually produce.
    const canary = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    fs.writeFileSync(path.join(workspace, "leak.ts"), `export const ${canary} = 1;\n`, "utf8");
    const r = await symbolsTool.run({ path: "leak.ts" }, ctx);
    expect(r.ok).toBe(true);
    const names = r.data?.symbols.map((s) => s.name) ?? [];
    for (const name of names) {
      expect(name).not.toContain(canary);
    }
    expect(names).toEqual(["«REDACTED:github»"]);
  });
});
