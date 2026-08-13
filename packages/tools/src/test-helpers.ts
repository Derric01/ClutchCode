import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Denylist, PolicyEngine, Redactor } from "@clutchcode/sandbox";
import type { ToolContext } from "./types.js";

export function makeTempWorkspace(prefix = "clutchcode-tools-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeTestContext(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-evidence-"));
  return {
    workspaceRoot,
    evidenceDir,
    policy: new PolicyEngine(),
    denylist: new Denylist(),
    redactor: new Redactor(),
    repoTrustMode: "trusted",
    networkAllowlist: [],
    ...overrides
  };
}
