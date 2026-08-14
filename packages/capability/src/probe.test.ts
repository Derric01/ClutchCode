import { describe, expect, it } from "vitest";
import { FakeProvider, textTurn, toolCallTurn } from "@clutchcode/providers";
import { defaultContextRungs, runCapabilityProbe } from "./probe.js";

describe("defaultContextRungs", () => {
  it("builds an ascending ladder of fractions of the advertised context, deduped", () => {
    const rungs = defaultContextRungs(8000);
    expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
    expect(rungs[rungs.length - 1]).toBe(8000);
    expect(new Set(rungs).size).toBe(rungs.length);
  });

  it("never proposes a rung below the 200-char floor", () => {
    const rungs = defaultContextRungs(100);
    expect(Math.min(...rungs)).toBeGreaterThanOrEqual(200);
  });
});

describe("runCapabilityProbe", () => {
  it("scores a well-behaved model high across every check", async () => {
    const editArgs = JSON.stringify({ edits: [{ search: "Hello", replace: "Hi" }] });
    const provider = new FakeProvider(
      [
        toolCallTurn("c1", "edit_file", editArgs), // check 1+3: diff-accuracy trial (native)
        textTurn("DONE"), // check 2: instruction-fidelity trial
        textTurn('{"status":"ok","count":1}'), // check 4: structured-output trial
        textTurn("the secret code is CC-500-PROBE, right there in the text"), // check 5: context rung (500 chars)
        textTurn("The task is already complete — no further action needed.") // check 6: loop sanity, no repeat
      ],
      { capabilityDefaults: { supportsParallelTools: true, supportsConstrainedDecode: true, approxEffectiveContext: 8000 } }
    );

    const profile = await runCapabilityProbe(provider, "good-model", { trials: 1, contextRungs: [500] });

    expect(profile.modelId).toBe("good-model");
    expect(profile.providerId).toBe("fake");
    expect(profile.diffApplicationAccuracy).toBe(1);
    expect(profile.toolTransport).toBe("native");
    expect(profile.instructionFidelity).toBe(1);
    expect(profile.longPromptInstructionFidelity).toBe("high");
    expect(profile.structuredOutputScore).toBe(1);
    expect(profile.structuredOutputReliability).toBe("high");
    expect(profile.effectiveContext).toBeGreaterThan(0);
    expect(profile.loopCheckPassed).toBe(true);
    expect(profile.supportsParallelTools).toBe(true);
    expect(profile.constrainedDecodeAvailable).toBe(true);
    expect(profile.notes).toEqual([]);
  });

  it("scores a weak model low and flags it as needing text-protocol emulation", async () => {
    const provider = new FakeProvider([
      textTurn("Sure, I changed the greeting for you! Let me know if you need anything else."), // no tool call, no JSON — diff-accuracy miss
      textTurn("Okay, I'll get right on that and let you know how it goes!"), // rambles instead of stopping
      textTurn("I can't produce JSON, but here's a summary of what I'd do."), // no structured output
      textTurn("I'm not sure what the secret code is."), // fails the context probe immediately
      toolCallTurn("c2", "run_tests", "{}") // check 6: blindly repeats the already-finished action
    ]);

    const profile = await runCapabilityProbe(provider, "weak-model", { trials: 1, contextRungs: [500] });

    expect(profile.diffApplicationAccuracy).toBe(0);
    expect(profile.toolTransport).toBe("none");
    expect(profile.instructionFidelity).toBe(0);
    expect(profile.structuredOutputScore).toBe(0);
    expect(profile.effectiveContext).toBe(0);
    expect(profile.loopCheckPassed).toBe(false);
    expect(profile.notes.some((n) => n.includes("text-protocol emulation"))).toBe(true);
    expect(profile.notes.some((n) => n.includes("loop detector"))).toBe(true);
  });

  it("averages diff-accuracy across multiple trials", async () => {
    const goodEdit = toolCallTurn("c1", "edit_file", JSON.stringify({ edits: [{ search: "Hello", replace: "Hi" }] }));
    const badEdit = toolCallTurn("c2", "edit_file", JSON.stringify({ edits: [{ search: "this text does not exist in the fixture", replace: "x" }] }));

    const provider = new FakeProvider([
      goodEdit,
      badEdit, // 1/2 diff-accuracy trials succeed
      textTurn("DONE"),
      textTurn("DONE"),
      textTurn('{"status":"ok","count":1}'),
      textTurn('{"status":"ok","count":1}'),
      textTurn("no needle here"), // context rung fails immediately
      textTurn("done, nothing more to do") // loop check passes
    ]);

    const profile = await runCapabilityProbe(provider, "mixed-model", { trials: 2, contextRungs: [300] });

    expect(profile.diffApplicationAccuracy).toBe(0.5);
    expect(profile.trials).toBe(2);
  });

  it("walks the context ladder and stops at the first miss", async () => {
    const provider = new FakeProvider([
      toolCallTurn("c1", "edit_file", JSON.stringify({ edits: [{ search: "Hello", replace: "Hi" }] })),
      textTurn("DONE"),
      textTurn('{"status":"ok","count":1}'),
      textTurn("found it: CC-200-PROBE"), // rung 1 (200) passes
      textTurn("found it: CC-800-PROBE"), // rung 2 (800) passes
      textTurn("nothing found this time"), // rung 3 (1600) fails
      textTurn("done") // loop check
    ]);

    const profile = await runCapabilityProbe(provider, "ladder-model", { trials: 1, contextRungs: [200, 800, 1600] });

    // Best confirmed rung was 800 chars; effectiveContext falls back to the chars/4 heuristic
    // when the FakeProvider script doesn't emit a usage delta.
    expect(profile.effectiveContext).toBe(Math.round(800 / 4));
    expect(profile.notes.some((n) => n.includes("context recall failed"))).toBe(true);
  });
});
