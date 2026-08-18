import { describe, expect, it } from "vitest";
import { BUILTIN_WORKFLOWS, BUILTIN_WORKFLOW_IDS, isBuiltinWorkflowId } from "./workflow.js";

describe("Built-in workflows (§8.2)", () => {
  it("ships exactly the three workflows named in the spec", () => {
    expect(BUILTIN_WORKFLOW_IDS).toEqual(["default", "quickfix", "review-only"]);
    expect(Object.keys(BUILTIN_WORKFLOWS).sort()).toEqual(["default", "quickfix", "review-only"]);
  });

  it("each descriptor's id matches its own registry key", () => {
    for (const id of BUILTIN_WORKFLOW_IDS) {
      expect(BUILTIN_WORKFLOWS[id].id).toBe(id);
    }
  });

  it("isBuiltinWorkflowId accepts the three built-ins and rejects anything else", () => {
    expect(isBuiltinWorkflowId("default")).toBe(true);
    expect(isBuiltinWorkflowId("quickfix")).toBe(true);
    expect(isBuiltinWorkflowId("review-only")).toBe(true);
    expect(isBuiltinWorkflowId("nonexistent")).toBe(false);
    expect(isBuiltinWorkflowId("")).toBe(false);
  });
});
