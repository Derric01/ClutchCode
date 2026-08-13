import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPipeline } from "./pipeline.js";
import type { ToolchainCommands } from "./toolchain.js";

describe("runPipeline", () => {
  let cwd: string;
  let evidenceDir: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-pipeline-cwd-"));
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-pipeline-evidence-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("runs all configured stages and reports allGreen when everything passes", () => {
    const commands: ToolchainCommands = {
      language: "unknown",
      provenance: "test",
      build: "true",
      test: "true",
      lint: "true"
    };
    const result = runPipeline(commands, { cwd, evidenceDir });

    expect(result.allGreen).toBe(true);
    expect(result.stages.map((s) => s.stage)).toEqual(["build", "test", "lint", "typecheck"]);
    expect(result.stages.find((s) => s.stage === "typecheck")!.ran).toBe(false);
    expect(result.firstFailure).toBeUndefined();
  });

  it("stops at the first failing stage by default", () => {
    const commands: ToolchainCommands = {
      language: "unknown",
      provenance: "test",
      build: "false", // fails immediately
      test: "true",
      lint: "true"
    };
    const result = runPipeline(commands, { cwd, evidenceDir });

    expect(result.allGreen).toBe(false);
    expect(result.firstFailure?.stage).toBe("build");
    // test/lint should not have run since build failed and stopOnFailure defaults true.
    const testStage = result.stages.find((s) => s.stage === "test");
    expect(testStage).toBeUndefined();
  });

  it("runs every configured stage when stopOnFailure is false", () => {
    const commands: ToolchainCommands = {
      language: "unknown",
      provenance: "test",
      build: "false",
      test: "true"
    };
    const result = runPipeline(commands, { cwd, evidenceDir, stopOnFailure: false });

    expect(result.stages).toHaveLength(4);
    expect(result.firstFailure?.stage).toBe("build");
  });

  it("captures stdout/stderr from a failing command", () => {
    const commands: ToolchainCommands = {
      language: "unknown",
      provenance: "test",
      test: "echo 'AssertionError: expected 1 to equal 2' && exit 1"
    };
    const result = runPipeline(commands, { cwd, evidenceDir });
    const testStage = result.stages.find((s) => s.stage === "test")!;
    expect(testStage.passed).toBe(false);
    expect(testStage.stdout).toContain("AssertionError");
  });
});
