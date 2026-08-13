import { describe, expect, it } from "vitest";
import { FakeProvider, textTurn, toolCallTurn, type ScriptedTurn } from "@clutchcode/providers";
import { runCapabilityProbe } from "./probe.js";

const NEEDLE = "NEEDLE-FIXED-TEST-VALUE";
const CORRECT_DIFF_BLOCK = ["<<<<<<< SEARCH", "  return a - b;", "=======", "  return a + b;", ">>>>>>> REPLACE"].join("\n");

function strongModelScript(): ScriptedTurn[] {
  return [
    // diffAcc x2
    textTurn(CORRECT_DIFF_BLOCK),
    textTurn(CORRECT_DIFF_BLOCK),
    // instructionFidelity x2
    textTurn("DONE"),
    textTurn("DONE"),
    // toolTransport x1 — native
    toolCallTurn("call_1", "probe_tool", '{"ok":true}'),
    // structuredOutput x2
    textTurn('{"answer": 42}'),
    textTurn('{"answer": 42}'),
    // effectiveContext — succeeds at every size (5 sizes)
    textTurn(NEEDLE),
    textTurn(NEEDLE),
    textTurn(NEEDLE),
    textTurn(NEEDLE),
    textTurn(NEEDLE),
    // loopCheck — no tool call, obeys
    textTurn("Found a.txt.")
  ];
}

function weakModelScript(): ScriptedTurn[] {
  return [
    // diffAcc x2 — rambles instead of emitting the block
    textTurn("Sure, I'll change it! Here's the fix, let me explain..."),
    textTurn("I think you want return a + b but I'm not sure of the format"),
    // instructionFidelity x2 — adds extra text
    textTurn("DONE. I have completed the task as requested."),
    textTurn("Okay, DONE!"),
    // toolTransport — no native tool call, not even JSON
    textTurn("I would call probe_tool but I'm not sure how."),
    // structuredOutput x2 — invalid JSON
    textTurn("The answer is 42."),
    textTurn("{answer: 42}"), // invalid JSON (unquoted key)
    // effectiveContext — fails immediately at the smallest size
    textTurn("I don't see any secret code."),
    // loopCheck — redundantly calls the tool again despite being told not to
    toolCallTurn("call_2", "list_files", "{}")
  ];
}

describe("runCapabilityProbe", () => {
  it("scores a strong, well-behaved model highly across every check", async () => {
    const provider = new FakeProvider(strongModelScript(), { id: "fake-strong" });
    const profile = await runCapabilityProbe(provider, "strong-model", { trials: 2, needleGenerator: () => NEEDLE });

    expect(profile.providerId).toBe("fake-strong");
    expect(profile.modelId).toBe("strong-model");
    expect(profile.diffAcc).toBe(1);
    expect(profile.instructionFidelity).toBe(1);
    expect(profile.toolTransport).toBe("native");
    expect(profile.structuredOutputReliability).toBe(1);
    expect(profile.effectiveContext).toBe(32_000); // succeeded at the largest scripted size
    expect(profile.loopCheckPassed).toBe(true);
    expect(profile.probeVersion).toBeGreaterThan(0);
    expect(profile.probedAt).toBeGreaterThan(0);
  });

  it("scores a weak/rambling model low, and detects it needs tool-call emulation", async () => {
    const provider = new FakeProvider(weakModelScript(), { id: "fake-weak" });
    const profile = await runCapabilityProbe(provider, "weak-model", { trials: 2, needleGenerator: () => NEEDLE });

    expect(profile.diffAcc).toBe(0);
    expect(profile.instructionFidelity).toBe(0); // neither reply was the bare word "DONE"
    expect(profile.toolTransport).toBe("emulation");
    expect(profile.structuredOutputReliability).toBe(0);
    expect(profile.effectiveContext).toBe(0); // failed even at the smallest size
    expect(profile.loopCheckPassed).toBe(false); // redundantly called the tool again
  });
});
