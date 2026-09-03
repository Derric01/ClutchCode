import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { FakeProvider, OllamaProvider, textTurn, toolCallTurn } from "@clutchcode/providers";
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

/**
 * §4.9 check 3 against the open-weight `<tool_call>` format (§4.7).
 *
 * This is the cascade the Hermes support exists to fix, asserted end to end
 * over the real SSE path: before it, a model answering in the Hermes format
 * was read as plain prose, scored `toolTransport: "none"`, and was told it
 * needed text-protocol emulation (§4.8) — which then costs it a weaker edit
 * format (§4.4) and a smaller context budget (§4.5).
 *
 * NOT a live-model test: no Ollama, no GPU, no weights in this environment.
 * The mock speaks the format; whether a real Hermes-3 deployment does is
 * flagged unverified in `packages/providers/src/hermes.ts`.
 */
describe("runCapabilityProbe against a Hermes-format model (§4.7/§4.9)", () => {
  const HERMES_EDIT =
    '<scratch_pad>\nGoal: change the greeting\nActions:\n- r1 = functions.edit_file(...)\nObservation: None\nReflection: relevant\n</scratch_pad>\n' +
    '<tool_call>\n{"name": "edit_file", "arguments": {"path": "greeter.txt", "edits": [{"search": "Hello", "replace": "Hi"}]}}\n</tool_call>';

  /** Answers each probe check in the Hermes idiom, chunked so tags straddle SSE boundaries. */
  function startHermesModel(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          let reply: string;
          if (body.includes("edit_file")) reply = HERMES_EDIT;
          else if (body.includes("stop immediately")) reply = "DONE";
          else if (body.includes("well-formed JSON")) reply = '{"status":"ok","count":1}';
          else if (body.includes("secret code")) reply = "CC-300-PROBE";
          else reply = "That task is already complete — nothing further to do.";

          res.writeHead(200, { "content-type": "text/event-stream" });
          for (const piece of reply.match(/[\s\S]{1,9}/g) ?? []) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
          }
          res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
          res.end("data: [DONE]\n\n");
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
      });
    });
  }

  it("scores it as a native tool-transport model instead of demanding text-protocol emulation", async () => {
    const server = await startHermesModel();
    try {
      const provider = new OllamaProvider({ baseUrl: server.baseUrl });
      const profile = await runCapabilityProbe(provider, "hermes-3", { trials: 2, contextRungs: [300] });

      expect(profile.toolTransport).toBe("native");
      expect(profile.diffApplicationAccuracy).toBe(1);
      expect(profile.notes.some((n) => n.includes("text-protocol emulation"))).toBe(false);
      // The GOAP reasoning block must not have leaked into a scored answer.
      expect(profile.instructionFidelity).toBe(1);
      expect(profile.loopCheckPassed).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("still scores none when the same model is pinned to the pre-Hermes native-only protocol", async () => {
    const server = await startHermesModel();
    try {
      const provider = new OllamaProvider({ baseUrl: server.baseUrl, toolProtocol: "native" });
      const profile = await runCapabilityProbe(provider, "hermes-3", { trials: 2, contextRungs: [300] });

      expect(profile.toolTransport).toBe("none");
      expect(profile.notes.some((n) => n.includes("text-protocol emulation"))).toBe(true);
    } finally {
      await server.close();
    }
  });
});
