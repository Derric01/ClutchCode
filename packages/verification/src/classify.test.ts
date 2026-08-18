import { describe, expect, it } from "vitest";
import { classifyFailure, isFlaky, shouldEscalate, MAX_REPAIR_ITERS } from "./classify.js";
import type { StageResult } from "./pipeline.js";

function stage(overrides: Partial<StageResult>): StageResult {
  return {
    stage: "test",
    ran: true,
    exitCode: 1,
    stdout: "",
    stderr: "",
    passed: false,
    durationMs: 1,
    ...overrides
  };
}

describe("classifyFailure", () => {
  it("classifies lint and typecheck stages directly by name", () => {
    expect(classifyFailure(stage({ stage: "lint" }))).toBe("lint");
    expect(classifyFailure(stage({ stage: "typecheck" }))).toBe("typecheck");
  });

  it("classifies a build failure as compile-error", () => {
    expect(classifyFailure(stage({ stage: "build", stderr: "SyntaxError: unexpected token" }))).toBe("compile-error");
  });

  it("classifies a test failure with an assertion message as test-assertion", () => {
    const result = stage({ stage: "test", stdout: "AssertionError: expected 1 to equal 2" });
    expect(classifyFailure(result)).toBe("test-assertion");
  });

  it("classifies a test failure with a network error as test-error-env", () => {
    const result = stage({ stage: "test", stderr: "connect ECONNREFUSED 127.0.0.1:5432" });
    expect(classifyFailure(result)).toBe("test-error-env");
  });

  it("classifies a test failure with a missing-module error as compile-error", () => {
    const result = stage({ stage: "test", stderr: "Error: Cannot find module 'lodash'" });
    expect(classifyFailure(result)).toBe("compile-error");
  });

  it("falls back to unknown when nothing matches", () => {
    const result = stage({ stage: "test", stdout: "something went wrong in a way we've never seen" });
    expect(classifyFailure(result)).toBe("unknown");
  });

  it("classifies exit code 127 as command-not-found, regardless of output text", () => {
    expect(classifyFailure(stage({ stage: "test", exitCode: 127, stderr: "" }))).toBe("command-not-found");
  });

  it("classifies a shell 'not found' message as command-not-found even without exit code 127", () => {
    const result = stage({ stage: "test", exitCode: 1, stderr: "sh: 1: pytest: not found" });
    expect(classifyFailure(result)).toBe("command-not-found");
  });

  it("command-not-found takes precedence over lint/typecheck's own stage-name classification — the missing binary is a memory problem, not a real lint/typecheck issue", () => {
    expect(classifyFailure(stage({ stage: "lint", exitCode: 127, stderr: "sh: 1: eslint: not found" }))).toBe("command-not-found");
    expect(classifyFailure(stage({ stage: "typecheck", exitCode: 127, stderr: "sh: 1: tsc: not found" }))).toBe("command-not-found");
  });

  it("a real lint/typecheck failure (not a missing binary) still classifies by stage name", () => {
    expect(classifyFailure(stage({ stage: "lint", exitCode: 1, stderr: "error  no-unused-vars" }))).toBe("lint");
    expect(classifyFailure(stage({ stage: "typecheck", exitCode: 2, stderr: "error TS2322: Type 'string' is not assignable" }))).toBe("typecheck");
  });

  it("command-not-found takes precedence over compile-error/test-assertion/test-error-env too", () => {
    const result = stage({ stage: "test", exitCode: 127, stderr: "bash: cargo: command not found" });
    expect(classifyFailure(result)).toBe("command-not-found");
  });
});

describe("isFlaky", () => {
  it("flags a test that fails then passes with no code change", () => {
    expect(isFlaky(false, true, false)).toBe(true);
  });

  it("does not flag a fix (code changed between runs)", () => {
    expect(isFlaky(false, true, true)).toBe(false);
  });

  it("does not flag a consistent failure", () => {
    expect(isFlaky(false, false, false)).toBe(false);
  });
});

describe("shouldEscalate", () => {
  it("escalates once the repair loop hits MAX_REPAIR_ITERS", () => {
    expect(shouldEscalate({ iterations: MAX_REPAIR_ITERS - 1 })).toBe(false);
    expect(shouldEscalate({ iterations: MAX_REPAIR_ITERS })).toBe(true);
  });
});
