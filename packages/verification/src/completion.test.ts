import { describe, expect, it } from "vitest";
import { evaluateCompletion } from "./completion.js";
import type { CheatFlag } from "./cheat-detection.js";

const noCheat: CheatFlag[] = [];
const oneCheat: CheatFlag[] = [{ rule: "added-skip-marker", file: "a.test.ts", message: "m", evidence: [] }];

describe("evaluateCompletion (§14.7)", () => {
  it("FAILED when the deterministic gate is not green, regardless of approval", () => {
    const r = evaluateCompletion({ gateGreen: false, cheatFlags: noCheat, humanApproved: true, yesMode: false });
    expect(r.status).toBe("FAILED");
  });

  it("DONE-ESCALATED when cheat flags exist, even with a green gate and human approval", () => {
    const r = evaluateCompletion({ gateGreen: true, cheatFlags: oneCheat, humanApproved: true, yesMode: false });
    expect(r.status).toBe("DONE-ESCALATED");
    if (r.status === "DONE-ESCALATED") expect(r.reason).toContain("added-skip-marker");
  });

  it("DONE-SUCCESS when the gate is green, no cheats, and the human approved", () => {
    const r = evaluateCompletion({ gateGreen: true, cheatFlags: noCheat, humanApproved: true, yesMode: false });
    expect(r.status).toBe("DONE-SUCCESS");
  });

  it("DONE-SUCCESS in --yes mode when gate is green and no cheats, without human approval", () => {
    const r = evaluateCompletion({ gateGreen: true, cheatFlags: noCheat, humanApproved: false, yesMode: true });
    expect(r.status).toBe("DONE-SUCCESS");
  });

  it("DONE-ESCALATED (awaiting approval) when gate is green, no cheats, not yet approved, not --yes", () => {
    const r = evaluateCompletion({ gateGreen: true, cheatFlags: noCheat, humanApproved: false, yesMode: false });
    expect(r.status).toBe("DONE-ESCALATED");
    if (r.status === "DONE-ESCALATED") expect(r.reason).toMatch(/approval/);
  });

  it("never returns DONE-SUCCESS on the model's word alone (gate red + yesMode + approved)", () => {
    const r = evaluateCompletion({ gateGreen: false, cheatFlags: noCheat, humanApproved: true, yesMode: true });
    expect(r.status).toBe("FAILED");
  });
});
