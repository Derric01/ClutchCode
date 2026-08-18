import fs from "node:fs";
import os from "node:os";
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

  it("log's `arg` can never smuggle a git flag through — real vulnerability caught in security review: a leading '-' turned it into --output=<path>, an out-of-workspace arbitrary file write, confirmed against a real git binary", async () => {
    git(workspace, ["init", "-q"]);
    git(workspace, ["config", "user.email", "test@example.com"]);
    git(workspace, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(workspace, "f.txt"), "one\n");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-q", "-m", "init"]);

    const target = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "clutchcode-git-tool-exploit-")), "pwned.txt");
    try {
      const result = await gitTool.run({ op: "log", arg: `-output=${target}` }, ctx);
      // Either the (now-sanitized) count is used as a plain digit-only argument and the
      // command still succeeds normally, or it's rejected — either way, the attacker's
      // path must never be written to.
      expect(fs.existsSync(target)).toBe(false);
      if (result.ok) {
        expect(result.data!.output).toContain("init"); // ran as an ordinary `git log`, not the injected flag
      }
    } finally {
      fs.rmSync(path.dirname(target), { recursive: true, force: true });
    }
  });

  it("log's `arg` accepts only a plain digit count, defaulting to 10 for anything else", async () => {
    git(workspace, ["init", "-q"]);
    git(workspace, ["config", "user.email", "test@example.com"]);
    git(workspace, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(workspace, "f.txt"), "one\n");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-q", "-m", "init"]);

    const withDigits = await gitTool.run({ op: "log", arg: "5" }, ctx);
    expect(withDigits.ok).toBe(true);

    const withGarbage = await gitTool.run({ op: "log", arg: "-not-a-count" }, ctx);
    expect(withGarbage.ok).toBe(true); // falls back to the default count instead of failing
    expect(withGarbage.data!.output).toContain("init");
  });
});
