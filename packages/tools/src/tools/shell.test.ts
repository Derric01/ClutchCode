import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, makeTestContext } from "../test-helpers.js";
import { shellTool } from "./shell.js";
import type { ToolContext } from "../types.js";

describe("shell tool", () => {
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

  it("runs a command and captures stdout with a zero exit code", async () => {
    const r = await shellTool.run({ cmd: "echo hello-clutchcode" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.exitCode).toBe(0);
    expect(r.data?.stdout).toContain("hello-clutchcode");
  });

  it("surfaces a nonzero exit code as data, not as a tool error", async () => {
    const r = await shellTool.run({ cmd: "exit 3" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data?.exitCode).toBe(3);
  });

  it("kills a command that exceeds its timeout", async () => {
    const r = await shellTool.run({ cmd: "sleep 30", timeoutMs: 200 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("timeout");
  }, 10_000);

  it("asks for approval on a destructive command instead of running it", async () => {
    const r = await shellTool.run({ cmd: "git push --force origin main" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("needs-approval");
  });

  it("scrubs the credential environment from the child process", async () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-should-not-leak-into-child-0000000000";
    try {
      const r = await shellTool.run({ cmd: "env" }, ctx);
      expect(r.ok).toBe(true);
      expect(r.data?.stdout).not.toContain("OPENAI_API_KEY");
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it("remembers a non-destructive command-class after the first ASK", async () => {
    ctx = makeTestContext(workspace, { repoTrustMode: "untrusted" });
    const first = await shellTool.run({ cmd: "echo once" }, ctx);
    expect(first.ok).toBe(false);
    expect(first.error?.code).toBe("needs-approval");

    ctx.policy.remember("echo once", "ALLOW");
    const second = await shellTool.run({ cmd: "echo once" }, ctx);
    expect(second.ok).toBe(true);
  });
});
