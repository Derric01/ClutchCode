import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkflowDeclaration, resolveWorkflowPlan, validateWorkflowDeclaration, type WorkflowDeclaration } from "./workflow-declaration.js";

const FULL_PIPELINE: WorkflowDeclaration = {
  apiVersion: "clutchcode/v1",
  id: "always-plan",
  name: "Always Plan",
  stages: [
    { id: "plan", uses: "plan", params: { mode: "always" } },
    { id: "implement", uses: "implement" },
    { id: "verify", uses: "verify" },
    { id: "approve", uses: "approve" },
    { id: "commit", uses: "commit" }
  ]
};

const READONLY_PIPELINE: WorkflowDeclaration = {
  apiVersion: "clutchcode/v1",
  id: "custom-review",
  name: "Custom Review",
  stages: [{ id: "implement", uses: "implement", params: { readonly: true } }]
};

describe("validateWorkflowDeclaration (§8.1 JSON-Schema layer)", () => {
  it("accepts a well-formed full-pipeline declaration", () => {
    expect(validateWorkflowDeclaration(FULL_PIPELINE)).toEqual(FULL_PIPELINE);
  });

  it("accepts a well-formed readonly declaration", () => {
    expect(validateWorkflowDeclaration(READONLY_PIPELINE)).toEqual(READONLY_PIPELINE);
  });

  it("accepts a minimal declaration with no plan stage (planning force-skipped)", () => {
    const decl: WorkflowDeclaration = {
      apiVersion: "clutchcode/v1",
      id: "minimal",
      name: "Minimal",
      stages: [
        { id: "implement", uses: "implement" },
        { id: "verify", uses: "verify" }
      ]
    };
    expect(() => validateWorkflowDeclaration(decl)).not.toThrow();
  });

  it("rejects an unsupported apiVersion", () => {
    const decl = { ...FULL_PIPELINE, apiVersion: "clutchcode/v2" };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/invalid workflow declaration/);
  });

  it("rejects an unknown stage 'uses' value (structural, real JSON-Schema enum check)", () => {
    const decl = { ...FULL_PIPELINE, stages: [{ id: "x", uses: "implment" }] }; // typo, on purpose
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/invalid workflow declaration/);
  });

  it("rejects an unknown top-level property (additionalProperties: false)", () => {
    const decl = { ...FULL_PIPELINE, extra: true };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/invalid workflow declaration/);
  });

  it("rejects an id colliding with a built-in workflow", () => {
    const decl = { ...FULL_PIPELINE, id: "quickfix" };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/collides with a built-in workflow id/);
  });

  it("rejects a stage kind repeated more than once", () => {
    const decl: WorkflowDeclaration = {
      ...FULL_PIPELINE,
      id: "dup-verify",
      stages: [
        { id: "implement", uses: "implement" },
        { id: "verify1", uses: "verify" },
        { id: "verify2", uses: "verify" }
      ]
    };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/appears 2 times/);
  });

  it("rejects a declaration with no implement stage", () => {
    const decl: WorkflowDeclaration = { apiVersion: "clutchcode/v1", id: "no-implement", name: "No Implement", stages: [{ id: "verify", uses: "verify" }] };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/must include an "implement" stage/);
  });

  it("rejects a readonly implement stage combined with any other stage", () => {
    const decl: WorkflowDeclaration = {
      apiVersion: "clutchcode/v1",
      id: "readonly-plus-verify",
      name: "Readonly Plus Verify",
      stages: [
        { id: "implement", uses: "implement", params: { readonly: true } },
        { id: "verify", uses: "verify" }
      ]
    };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/must be the only stage/);
  });

  it("rejects a non-readonly implement stage with no verify stage", () => {
    const decl: WorkflowDeclaration = { apiVersion: "clutchcode/v1", id: "no-verify", name: "No Verify", stages: [{ id: "implement", uses: "implement" }] };
    expect(() => validateWorkflowDeclaration(decl)).toThrow(/needs a "verify" stage too/);
  });
});

describe("resolveWorkflowPlan", () => {
  it("resolves a full pipeline with plan mode 'always' to { planMode: 'always', readonly: false }", () => {
    expect(resolveWorkflowPlan(FULL_PIPELINE)).toEqual({ planMode: "always", readonly: false });
  });

  it("resolves a full pipeline with a plain plan stage (no mode param) to 'auto'", () => {
    const decl: WorkflowDeclaration = {
      ...FULL_PIPELINE,
      id: "auto-plan",
      stages: [
        { id: "plan", uses: "plan" },
        { id: "implement", uses: "implement" },
        { id: "verify", uses: "verify" }
      ]
    };
    expect(resolveWorkflowPlan(decl)).toEqual({ planMode: "auto", readonly: false });
  });

  it("resolves a full pipeline with no plan stage at all to 'never'", () => {
    const decl: WorkflowDeclaration = {
      apiVersion: "clutchcode/v1",
      id: "no-plan",
      name: "No Plan",
      stages: [
        { id: "implement", uses: "implement" },
        { id: "verify", uses: "verify" }
      ]
    };
    expect(resolveWorkflowPlan(decl)).toEqual({ planMode: "never", readonly: false });
  });

  it("resolves a readonly pipeline to { planMode: 'never', readonly: true }", () => {
    expect(resolveWorkflowPlan(READONLY_PIPELINE)).toEqual({ planMode: "never", readonly: true });
  });
});

describe("loadWorkflowDeclaration (real filesystem I/O)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-workflow-decl-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads, parses, and validates a real JSON file", () => {
    const file = path.join(dir, "always-plan.json");
    fs.writeFileSync(file, JSON.stringify(FULL_PIPELINE, null, 2), "utf8");
    expect(loadWorkflowDeclaration(file)).toEqual(FULL_PIPELINE);
  });

  it("throws a clear error for malformed JSON, not a raw parser exception", () => {
    const file = path.join(dir, "broken.json");
    fs.writeFileSync(file, "{ not valid json", "utf8");
    expect(() => loadWorkflowDeclaration(file)).toThrow(/failed to read\/parse workflow file/);
  });

  it("throws a clear error for a missing file", () => {
    expect(() => loadWorkflowDeclaration(path.join(dir, "does-not-exist.json"))).toThrow(/failed to read\/parse workflow file/);
  });

  it("throws the same schema/semantic errors as validateWorkflowDeclaration for an invalid-but-parseable file", () => {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, JSON.stringify({ apiVersion: "clutchcode/v1", id: "bad", name: "Bad", stages: [] }), "utf8");
    expect(() => loadWorkflowDeclaration(file)).toThrow(/invalid workflow declaration/);
  });
});
