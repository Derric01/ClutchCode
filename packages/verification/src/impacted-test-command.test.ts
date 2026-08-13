import { describe, expect, it } from "vitest";
import { buildImpactedTestCommand } from "./impacted-test-command.js";

describe("buildImpactedTestCommand", () => {
  it("returns null for an empty file list", () => {
    expect(buildImpactedTestCommand("npm run test", [], "node")).toBeNull();
  });

  it("appends files after -- for node", () => {
    expect(buildImpactedTestCommand("npm run test", ["a.test.ts", "b.test.ts"], "node")).toBe('npm run test -- "a.test.ts" "b.test.ts"');
  });

  it("appends file paths directly for python (pytest convention)", () => {
    expect(buildImpactedTestCommand("pytest -q", ["test_a.py"], "python")).toBe('pytest -q "test_a.py"');
  });

  it("returns null for go/rust/unknown — file-level selection doesn't map cleanly", () => {
    expect(buildImpactedTestCommand("go test ./...", ["a_test.go"], "go")).toBeNull();
    expect(buildImpactedTestCommand("cargo test", ["a.rs"], "rust")).toBeNull();
    expect(buildImpactedTestCommand("echo noop", ["a"], "unknown")).toBeNull();
  });
});
