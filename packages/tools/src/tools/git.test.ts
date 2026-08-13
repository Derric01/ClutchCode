import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, makeTestContext } from "../test-helpers.js";
import { gitTool } from "./git.js";
import type { ToolContext } from "../types.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("git tool (read-only)", () => {
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

  it("reports not-a-repo outside a git repository", async () => {
    const r = await gitTool.run({ op: "status" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not-a-repo");
  });

  it("reports status/diff/log inside a git repository", async () => {
    git(workspace, ["init", "-q"]);
    git(workspace, ["config", "user.email", "test@example.com"]);
    git(workspace, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(workspace, "f.txt"), "one\n");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-q", "-m", "init"]);

    fs.writeFileSync(path.join(workspace, "f.txt"), "two\n");

    const status = await gitTool.run({ op: "status" }, ctx);
    expect(status.ok).toBe(true);
    expect(status.data!.output).toContain("f.txt");

    const diff = await gitTool.run({ op: "diff" }, ctx);
    expect(diff.ok).toBe(true);
    expect(diff.data!.output).toContain("-one");
    expect(diff.data!.output).toContain("+two");

    const log = await gitTool.run({ op: "log" }, ctx);
    expect(log.ok).toBe(true);
    expect(log.data!.output).toContain("init");
  });

  it("rejects an unsupported op at validation", () => {
    // @ts-expect-error deliberately invalid op
    const result = gitTool.validate({ op: "push" });
    expect(result.ok).toBe(false);
  });
});
