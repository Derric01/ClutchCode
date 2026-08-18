import { describe, expect, it } from "vitest";
import { createRunState, transition, canTransition, InvalidTransitionError } from "./run-state.js";

describe("RunState state machine", () => {
  it("creates a run in CREATED with default budgets", () => {
    const state = createRunState({ runId: "r1", task: "fix the bug", provider: "fake", model: "fake" });
    expect(state.status).toBe("CREATED");
    expect(state.budgets.steps).toBe(50);
    expect(state.consumed.steps).toBe(0);
  });

  it("walks the happy path", () => {
    const state = createRunState({ runId: "r1", task: "t", provider: "fake", model: "fake" });
    for (const to of ["UNDERSTANDING", "INSPECTING", "ACTING", "EDITING", "VERIFYING", "AWAITING_APPROVAL", "COMMITTING", "DONE"] as const) {
      transition(state, to);
    }
    expect(state.status).toBe("DONE");
  });

  it("allows the REPAIRING -> EDITING -> ... -> VERIFYING cycle", () => {
    const state = createRunState({ runId: "r1", task: "t", provider: "fake", model: "fake" });
    transition(state, "UNDERSTANDING");
    transition(state, "INSPECTING");
    transition(state, "ACTING");
    transition(state, "VERIFYING");
    transition(state, "REPAIRING");
    transition(state, "EDITING");
    transition(state, "ACTING");
    transition(state, "VERIFYING");
    expect(state.status).toBe("VERIFYING");
  });

  it("rejects an invalid transition", () => {
    const state = createRunState({ runId: "r1", task: "t", provider: "fake", model: "fake" });
    expect(() => transition(state, "DONE")).toThrow(InvalidTransitionError);
  });

  it("allows escape hatches (PAUSED/ESCALATED/FAILED/CANCELLED) from any non-terminal, non-paused state", () => {
    // §6.5: Ctrl-C once pauses, twice cancels — available at any point in an
    // active run, not just once the diff is ready for approval.
    expect(canTransition("ACTING", "PAUSED")).toBe(true);
    expect(canTransition("VERIFYING", "ESCALATED")).toBe(true);
    expect(canTransition("EDITING", "FAILED")).toBe(true);
    expect(canTransition("UNDERSTANDING", "CANCELLED")).toBe(true);
  });

  it("terminal states have no outgoing transitions except via resume semantics", () => {
    expect(canTransition("DONE", "ACTING")).toBe(false);
    expect(canTransition("FAILED", "ACTING")).toBe(false);
    expect(canTransition("CANCELLED", "ACTING")).toBe(false);
  });

  it("PAUSED can resume into any state (caller-tracked prior state)", () => {
    expect(canTransition("PAUSED", "ACTING")).toBe(true);
    expect(canTransition("PAUSED", "VERIFYING")).toBe(true);
  });

  it("ACTING -> DONE is legal (§8.2 review-only finishes here, skipping verify/approve/commit)", () => {
    const state = createRunState({ runId: "r1", task: "t", workflowId: "review-only", provider: "fake", model: "fake" });
    transition(state, "UNDERSTANDING");
    transition(state, "INSPECTING");
    transition(state, "ACTING");
    transition(state, "DONE");
    expect(state.status).toBe("DONE");
  });

  it("defaults workflowId to \"default\" and accepts an explicit id", () => {
    const defaulted = createRunState({ runId: "r1", task: "t", provider: "fake", model: "fake" });
    expect(defaulted.workflowId).toBe("default");
    const explicit = createRunState({ runId: "r2", task: "t", workflowId: "quickfix", provider: "fake", model: "fake" });
    expect(explicit.workflowId).toBe("quickfix");
  });

  it("resolves workflowPlan from a built-in workflowId, and defaults to \"default\"'s plan for an unrecognized one (§8.1)", () => {
    expect(createRunState({ runId: "r1", task: "t", provider: "fake", model: "fake" }).workflowPlan).toEqual({ planMode: "auto", readonly: false });
    expect(createRunState({ runId: "r2", task: "t", workflowId: "quickfix", provider: "fake", model: "fake" }).workflowPlan).toEqual({
      planMode: "never",
      readonly: false
    });
    expect(createRunState({ runId: "r3", task: "t", workflowId: "review-only", provider: "fake", model: "fake" }).workflowPlan).toEqual({
      planMode: "never",
      readonly: true
    });
    // An id createRunState doesn't recognize (e.g. a custom declarative workflow's
    // own id, passed without its resolved plan by mistake) falls back to "default"'s
    // plan defensively rather than throwing — the id itself is still recorded as-is.
    const unrecognized = createRunState({ runId: "r4", task: "t", workflowId: "something-custom", provider: "fake", model: "fake" });
    expect(unrecognized.workflowId).toBe("something-custom");
    expect(unrecognized.workflowPlan).toEqual({ planMode: "auto", readonly: false });
  });

  it("an explicit workflowPlan wins over the workflowId-derived default (§8.1 custom declarative workflows)", () => {
    const custom = createRunState({
      runId: "r1",
      task: "t",
      workflowId: "always-plan-custom",
      workflowPlan: { planMode: "always", readonly: false },
      provider: "fake",
      model: "fake"
    });
    expect(custom.workflowPlan).toEqual({ planMode: "always", readonly: false });
  });
});
