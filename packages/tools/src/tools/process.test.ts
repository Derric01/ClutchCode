import fs from "node:fs";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, makeTestContext } from "../test-helpers.js";
import { processTool } from "./process.js";
import type { ToolContext } from "../types.js";

describe("process tool", () => {
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

  it("lists processes as a table", async () => {
    const r = await processTool.run({ op: "list" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.op).toBe("list");
    if (r.data!.op === "list") {
      expect(r.data!.rows.length).toBeGreaterThan(0);
      expect(r.data!.rows[0]).toHaveProperty("pid");
    }
  });

  it("kills a real child process", async () => {
    const child = spawn("sleep", ["30"]);
    await new Promise((resolve) => child.once("spawn", resolve));

    const r = await processTool.run({ op: "kill", pid: child.pid! }, ctx);
    expect(r.ok).toBe(true);
    if (r.data!.op === "kill") expect(r.data!.signaled).toBe(true);
  });

  it("returns no-such-process for an invalid pid", async () => {
    // A pid extremely unlikely to exist.
    const r = await processTool.run({ op: "kill", pid: 999_999 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("no-such-process");
  });
});
