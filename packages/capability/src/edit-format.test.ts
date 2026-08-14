import { describe, expect, it } from "vitest";
import { selectEditFormat, wholeFileLocCap } from "./edit-format.js";

describe("wholeFileLocCap", () => {
  it("is ~400 LOC at an 8k effective context (§4.4)", () => {
    expect(wholeFileLocCap(8000)).toBe(400);
  });
  it("scales linearly with effective context", () => {
    expect(wholeFileLocCap(16000)).toBe(800);
  });
  it("clamps to a sane floor and ceiling", () => {
    expect(wholeFileLocCap(100)).toBeGreaterThanOrEqual(100);
    expect(wholeFileLocCap(1_000_000)).toBeLessThanOrEqual(4000);
  });
});

describe("selectEditFormat", () => {
  const existingLargeFile = { isNew: false, loc: 2000 };
  const newFile = { isNew: true, loc: 0 };
  const smallExistingFile = { isNew: false, loc: 50 };

  it("grammar-enforces search/replace when constrained decode is available and accuracy is high", () => {
    const decision = selectEditFormat({ diffApplicationAccuracy: 0.9, constrainedDecodeAvailable: true, effectiveContext: 8000 }, existingLargeFile);
    expect(decision).toEqual({ format: "search-replace", grammarEnforced: true, tighterReminders: false });
  });

  it("uses plain search/replace above the 0.75 threshold without constrained decode", () => {
    const decision = selectEditFormat({ diffApplicationAccuracy: 0.8, constrainedDecodeAvailable: false, effectiveContext: 8000 }, existingLargeFile);
    expect(decision).toEqual({ format: "search-replace", grammarEnforced: false, tighterReminders: false });
  });

  it("prefers whole-file for a new file when accuracy is below the search/replace threshold", () => {
    const decision = selectEditFormat({ diffApplicationAccuracy: 0.6, constrainedDecodeAvailable: false, effectiveContext: 8000 }, newFile);
    expect(decision).toEqual({ format: "whole-file", chunked: false });
  });

  it("prefers whole-file for a small existing file under the LOC cap, mid accuracy", () => {
    const decision = selectEditFormat(
      { diffApplicationAccuracy: 0.6, constrainedDecodeAvailable: false, effectiveContext: 8000 },
      smallExistingFile
    );
    expect(decision).toEqual({ format: "whole-file", chunked: false });
  });

  it("uses search/replace with tighter reminders for a large file at mid accuracy", () => {
    const decision = selectEditFormat({ diffApplicationAccuracy: 0.6, constrainedDecodeAvailable: false, effectiveContext: 8000 }, existingLargeFile);
    expect(decision).toEqual({ format: "search-replace", grammarEnforced: false, tighterReminders: true });
  });

  it("falls back to chunked whole-file for a large file at low accuracy", () => {
    const decision = selectEditFormat({ diffApplicationAccuracy: 0.2, constrainedDecodeAvailable: false, effectiveContext: 8000 }, existingLargeFile);
    expect(decision).toEqual({ format: "whole-file", chunked: true });
  });

  it("a high-accuracy model with no constrained decode still gets grammar-free search/replace, never downgraded", () => {
    const decision = selectEditFormat({ diffApplicationAccuracy: 0.99, constrainedDecodeAvailable: false, effectiveContext: 32000 }, existingLargeFile);
    expect(decision.format).toBe("search-replace");
  });
});
