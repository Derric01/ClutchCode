import { describe, expect, it } from "vitest";
import { buildSeatbeltProfile, buildSeatbeltSpawn, detectSandboxExecOnPath } from "./tier1-macos.js";

/**
 * Written-to-spec, not runtime-verified (see `tier1-macos.ts`'s header
 * comment — no macOS host exists in this environment). These tests check
 * what *can* be checked without `sandbox-exec`: the generated SBPL profile
 * is well-formed and contains the clauses the design calls for.
 */

function parensBalanced(sbpl: string): boolean {
  let depth = 0;
  for (const ch of sbpl) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe("buildSeatbeltProfile", () => {
  const opts = { workspaceRoot: "/Users/dev/repo/wt/run1", cwd: "/Users/dev/repo/wt/run1", command: "npm test", homeDir: "/tmp/clutchcode-home-run1" };

  it("is well-formed SBPL: starts with (version 1), balanced parens", () => {
    const profile = buildSeatbeltProfile(opts);
    expect(profile.startsWith("(version 1)")).toBe(true);
    expect(parensBalanced(profile)).toBe(true);
  });

  it("denies by default and denies network outright", () => {
    const profile = buildSeatbeltProfile(opts);
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(deny network*)");
  });

  it("grants read+write on the workspace and the synthetic home, not the real one", () => {
    const profile = buildSeatbeltProfile(opts);
    expect(profile).toContain(`(subpath "${opts.workspaceRoot}")`);
    expect(profile).toContain(`(subpath "${opts.homeDir}")`);
    expect(profile).not.toContain("/Users/dev/.ssh");
  });

  it("escapes a double quote in a path instead of breaking the profile syntax", () => {
    const profile = buildSeatbeltProfile({ ...opts, workspaceRoot: '/tmp/weird"path' });
    expect(profile).toContain('\\"path');
    expect(parensBalanced(profile)).toBe(true);
  });
});

describe("buildSeatbeltSpawn", () => {
  it("invokes sandbox-exec with the profile via -p, then /bin/sh -c <command>", () => {
    const { bin, args } = buildSeatbeltSpawn({ workspaceRoot: "/ws", cwd: "/ws", command: "echo hi", homeDir: "/tmp/home" });
    expect(bin).toBe("sandbox-exec");
    expect(args[0]).toBe("-p");
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "echo hi"]);
  });
});

describe("detectSandboxExecOnPath", () => {
  it("is false on this (Linux) test environment — there's no macOS sandbox-exec here", () => {
    expect(detectSandboxExecOnPath()).toBe(false);
  });
});
