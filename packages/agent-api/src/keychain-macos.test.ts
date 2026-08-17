import { describe, expect, it } from "vitest";
import { buildSecurityClearArgs, buildSecurityGetArgs, buildSecuritySetArgs, detectSecurityCliOnPath, securityGet } from "./keychain-macos.js";

/**
 * Written-to-spec, not runtime-verified (see `keychain-macos.ts`'s header
 * comment — no macOS host exists in this environment). What *can* be
 * checked without a real `security` binary: the argv shape is exactly
 * what the documented `security(1)` grammar expects (pure functions, no
 * mocking needed — same approach as `tier1-macos.test.ts`), and a missing
 * binary is reported as "not available", never a thrown error.
 */

describe("detectSecurityCliOnPath", () => {
  it("is false on this (Linux) test environment — there's no macOS `security` here", () => {
    expect(detectSecurityCliOnPath()).toBe(false);
  });

  it("returns false for a PATH with no matching binary", () => {
    expect(detectSecurityCliOnPath({ PATH: "/does/not/exist" })).toBe(false);
  });
});

describe("buildSecurityGetArgs", () => {
  it("calls find-generic-password scoped to the clutchcode service, -w to print the password", () => {
    expect(buildSecurityGetArgs("anthropic-api-key")).toEqual({
      bin: "security",
      args: ["find-generic-password", "-s", "clutchcode", "-a", "anthropic-api-key", "-w"]
    });
  });
});

describe("buildSecuritySetArgs", () => {
  it("calls add-generic-password with -U so re-storing an existing account never errors", () => {
    expect(buildSecuritySetArgs("openai-api-key", "sk-test-value")).toEqual({
      bin: "security",
      args: ["add-generic-password", "-s", "clutchcode", "-a", "openai-api-key", "-w", "sk-test-value", "-U"]
    });
  });
});

describe("buildSecurityClearArgs", () => {
  it("calls delete-generic-password scoped to service + account", () => {
    expect(buildSecurityClearArgs("anthropic-api-key")).toEqual({
      bin: "security",
      args: ["delete-generic-password", "-s", "clutchcode", "-a", "anthropic-api-key"]
    });
  });
});

describe("securityGet on a host with no `security` binary", () => {
  it("returns undefined instead of throwing (this Linux container has no `security`)", () => {
    expect(securityGet("anything")).toBeUndefined();
  });
});
