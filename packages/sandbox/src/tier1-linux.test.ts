import { describe, expect, it } from "vitest";
import { buildBwrapArgv, isBwrapAvailable } from "./tier1-linux.js";

describe("buildBwrapArgv (§12.5/§12.6 Linux Tier 1)", () => {
  it("unshares the network namespace by default (ADR-019 default-deny)", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt" });
    expect(argv).toContain("--unshare-net");
  });

  it("omits --unshare-net when network is explicitly allowed", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt", allowNetwork: true });
    expect(argv).not.toContain("--unshare-net");
  });

  it("binds the workspace read-write and chdirs into it", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt" });
    const bindIdx = argv.indexOf("--bind");
    expect(argv[bindIdx + 1]).toBe("/wt");
    expect(argv[bindIdx + 2]).toBe("/wt");
    expect(argv).toContain("--chdir");
    expect(argv[argv.indexOf("--chdir") + 1]).toBe("/wt");
  });

  it("binds standard OS paths read-only via --ro-bind-try (tolerant of missing paths)", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt" });
    expect(argv).toContain("--ro-bind-try");
    const usrIdx = argv.indexOf("/usr");
    expect(argv[usrIdx - 1]).toBe("--ro-bind-try");
    expect(argv[usrIdx + 1]).toBe("/usr"); // source === dest
  });

  it("includes any extra read-only binds requested", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt", extraReadOnlyBinds: ["/opt/toolchain"] });
    expect(argv).toContain("/opt/toolchain");
  });

  it("chdirs into a scoped subdirectory when given, while still binding the whole workspace (§13.4 monorepo scope)", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt", chdir: "/wt/packages/api" });
    expect(argv[argv.indexOf("--chdir") + 1]).toBe("/wt/packages/api");
    const bindIdx = argv.indexOf("--bind");
    expect(argv[bindIdx + 1]).toBe("/wt");
  });

  it("passes the command through sh -c as the final argv", () => {
    const argv = buildBwrapArgv("npm test", { workspaceRoot: "/wt" });
    expect(argv.slice(-3)).toEqual(["sh", "-c", "npm test"]);
    expect(argv[argv.length - 4]).toBe("--");
  });

  it("never allows unconfined execution: every visible path is bound explicitly", () => {
    const argv = buildBwrapArgv("echo hi", { workspaceRoot: "/wt" });
    // No implicit passthrough flags like --dev-bind / (which would give host device access) are present.
    expect(argv).not.toContain("--dev-bind");
  });
});

describe("isBwrapAvailable", () => {
  it("returns a boolean without throwing, whether or not bwrap is installed", () => {
    expect(typeof isBwrapAvailable()).toBe("boolean");
  });
});
