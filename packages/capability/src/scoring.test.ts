import { describe, expect, it } from "vitest";
import type { CollectedResponse } from "@clutchcode/providers";
import { deriveToolTransport, extractEditBlocks, scoreStopObedience, scoreStructuredOutput, tier } from "./scoring.js";

function collected(overrides: Partial<CollectedResponse> = {}): CollectedResponse {
  return { text: "", toolCalls: [], finishReason: "stop", ...overrides };
}

describe("tier", () => {
  it("buckets scores into high/medium/low at the §4.1 thresholds", () => {
    expect(tier(1)).toBe("high");
    expect(tier(0.85)).toBe("high");
    expect(tier(0.84)).toBe("medium");
    expect(tier(0.5)).toBe("medium");
    expect(tier(0.49)).toBe("low");
    expect(tier(0)).toBe("low");
  });
});

describe("scoreStopObedience", () => {
  it("scores an exact match perfectly", () => {
    expect(scoreStopObedience("DONE")).toBe(1);
  });
  it("tolerates trivial punctuation", () => {
    expect(scoreStopObedience("DONE.")).toBe(0.75);
    expect(scoreStopObedience("  DONE  ")).toBe(1); // trims whitespace first
  });
  it("penalizes rambling that still contains the word", () => {
    expect(scoreStopObedience("Sure! DONE, hope that helps.")).toBeGreaterThan(0);
    expect(scoreStopObedience("Sure! DONE, hope that helps.")).toBeLessThan(1);
  });
  it("scores 0 when the model never stops", () => {
    expect(scoreStopObedience("I'll keep working on this and will let you know when finished.")).toBe(0);
  });
});

describe("scoreStructuredOutput", () => {
  it("scores a well-formed exact match perfectly", () => {
    expect(scoreStructuredOutput('{"status":"ok","count":3}')).toBe(1);
  });
  it("partially credits valid JSON with the wrong shape", () => {
    expect(scoreStructuredOutput('{"status":"ok"}')).toBe(0.3);
  });
  it("salvages a well-formed object embedded in prose (json-mode-only)", () => {
    expect(scoreStructuredOutput('Sure, here you go: {"status":"ok","count":2} — done!')).toBe(0.6);
  });
  it("scores 0 on unparseable output", () => {
    expect(scoreStructuredOutput("I can't do that.")).toBe(0);
  });
});

describe("extractEditBlocks", () => {
  it("extracts a native tool call and marks the source", () => {
    const res = collected({
      toolCalls: [{ id: "c1", name: "edit_file", argsJson: JSON.stringify({ edits: [{ search: "a", replace: "b" }] }) }]
    });
    const extracted = extractEditBlocks(res, "edit_file");
    expect(extracted).toEqual({ edits: [{ search: "a", replace: "b" }], source: "native" });
  });

  it("falls back to a JSON object embedded in text and marks json-mode-only", () => {
    const res = collected({ text: 'Here is my edit: {"edits":[{"search":"a","replace":"b"}]} done.' });
    const extracted = extractEditBlocks(res, "edit_file");
    expect(extracted).toEqual({ edits: [{ search: "a", replace: "b" }], source: "json-mode-only" });
  });

  it("returns null when nothing parseable is present", () => {
    const res = collected({ text: "I changed the greeting for you." });
    expect(extractEditBlocks(res, "edit_file")).toBeNull();
  });

  it("ignores a tool call for the wrong tool name", () => {
    const res = collected({ toolCalls: [{ id: "c1", name: "run_tests", argsJson: "{}" }] });
    expect(extractEditBlocks(res, "edit_file")).toBeNull();
  });
});

describe("deriveToolTransport", () => {
  it("prefers native when native trials are the majority", () => {
    expect(deriveToolTransport(["native", "native", "json-mode-only"])).toBe("native");
  });
  it("falls back to json-mode-only when it dominates", () => {
    expect(deriveToolTransport(["json-mode-only", "json-mode-only", "native"])).toBe("json-mode-only");
  });
  it("reports none when nothing ever parsed", () => {
    expect(deriveToolTransport(["none", "none"])).toBe("none");
  });
});
