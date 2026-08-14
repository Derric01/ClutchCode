import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildBwrapSpawn, detectBwrapOnPath } from "./tier1-linux.js";

describe("detectBwrapOnPath", () => {
  it("finds a real binary on PATH (this repo's dev container has bubblewrap installed)", () => {
    // Not mocked deliberately: a false positive here would mean every
    // other test in this file silently skips instead of proving anything.
    expect(detectBwrapOnPath()).toBe(true);
  });

  it("returns false when PATH has no bwrap", () => {
    expect(detectBwrapOnPath({ PATH: "/definitely/not/a/real/dir" })).toBe(false);
  });
});

describe("buildBwrapSpawn", () => {
  it("binds the workspace read-write, sets a synthetic HOME, and unshares net/pid", () => {
    const { bin, args } = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "echo hi", homeDir: "/home/sandboxed" });
    expect(bin).toBe("bwrap");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--unshare-pid");
    expect(args).toContain("--die-with-parent");
    const homeIdx = args.indexOf("--dir");
    expect(args[homeIdx + 1]).toBe("/home/sandboxed");
    const bindIdx = args.indexOf("--bind");
    expect(args[bindIdx + 1]).toBe("/tmp/ws");
    expect(args[bindIdx + 2]).toBe("/tmp/ws");
    // The actual command is the final three args: /bin/sh -c <command>.
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "echo hi"]);
  });

  it("only ro-binds system dirs that actually exist, never guessing", () => {
    const { args } = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "true", homeDir: "/home/x" });
    // /usr and /etc exist on any Linux box (including this one); a
    // fabricated path must never show up as a --ro-bind target.
    expect(args).toContain("/usr");
    expect(args).not.toContain("/this/path/does/not/exist");
  });
});

describe("buildBwrapSpawn — real confinement, run against the actual bwrap binary", () => {
  const hasBwrap = detectBwrapOnPath();
  const maybeIt = hasBwrap ? it : it.skip;

  let workspaceRoot: string;
  let outsideFile: string;

  function setup(): void {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-tier1-ws-"));
    fs.writeFileSync(path.join(workspaceRoot, "in-workspace.txt"), "workspace content\n", "utf8");
    outsideFile = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-tier1-outside-")) + "/secret.txt";
    fs.writeFileSync(outsideFile, "should never be readable\n", "utf8");
  }

  function run(command: string): string {
    const { bin, args } = buildBwrapSpawn({ workspaceRoot, cwd: workspaceRoot, command, homeDir: "/home/clutchcode-sandboxed" });
    return execFileSync(bin, args, { encoding: "utf8" });
  }

  maybeIt("can read a file inside the workspace", () => {
    setup();
    expect(run("cat in-workspace.txt")).toBe("workspace content\n");
  });

  maybeIt("cannot read a file outside the workspace, even with an absolute path", () => {
    setup();
    expect(() => run(`cat ${outsideFile}`)).toThrow();
  });

  maybeIt("cannot reach the network", () => {
    setup();
    // node is under /opt or /usr on most installs, both ro-bound; a fetch
    // to a real host must fail purely from network namespace isolation,
    // not DNS/connectivity flakiness in the test environment.
    const out = run(`node -e "fetch('http://93.184.216.34', {signal: AbortSignal.timeout(2000)}).then(()=>console.log('REACHED')).catch(()=>console.log('BLOCKED'))"`);
    expect(out.trim()).toBe("BLOCKED");
  });

  maybeIt("HOME inside the sandbox is empty, not the real one", () => {
    setup();
    expect(run("ls -A $HOME").trim()).toBe("");
  });

  maybeIt("a write inside the workspace is real and visible outside the sandbox afterward", () => {
    setup();
    run("echo written > new-file.txt");
    expect(fs.readFileSync(path.join(workspaceRoot, "new-file.txt"), "utf8")).toBe("written\n");
  });
});
