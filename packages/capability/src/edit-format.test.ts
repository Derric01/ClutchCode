import { describe, expect, it } from "vitest";
import { buildEditFormatGuidance, selectEditFormat, wholeFileLocCap } from "./edit-format.js";
import { unprobedProfile, type CapabilityProfile } from "./types.js";

function profile(overrides: Partial<CapabilityProfile>): CapabilityProfile {
  return { ...unprobedProfile("fake", "m"), ...overrides };
}

describe("wholeFileLocCap", () => {
  it("scales with effective context, floored at 100", () => {
    expect(wholeFileLocCap(profile({ effectiveContext: 8_000 }))).toBe(400);
    expect(wholeFileLocCap(profile({ effectiveContext: 32_000 }))).toBe(1600);
    expect(wholeFileLocCap(profile({ effectiveContext: 500 }))).toBe(100); // floor
  });
});

describe("selectEditFormat (§4.4)", () => {
  it("picks grammar-enforced SEARCH/REPLACE for a strong, constrained-decode-capable model", () => {
    const p = profile({ diffAcc: 0.9, supportsConstrainedDecode: true });
    expect(selectEditFormat(p, { isNew: false, loc: 5000 })).toBe("search_replace_grammar_enforced");
  });

  it("picks plain SEARCH/REPLACE for a strong model without constrained decoding", () => {
    const p = profile({ diffAcc: 0.8, supportsConstrainedDecode: false });
    expect(selectEditFormat(p, { isNew: false, loc: 5000 })).toBe("search_replace");
  });

  it("picks whole-file for a new file or a small file, regardless of diff_acc tier", () => {
    const p = profile({ diffAcc: 0.6, effectiveContext: 8_000 });
    expect(selectEditFormat(p, { isNew: true, loc: 0 })).toBe("whole_file");
    expect(selectEditFormat(p, { isNew: false, loc: 100 })).toBe("whole_file");
  });

  it("picks tight-reminder SEARCH/REPLACE for a mid-tier model on a large existing file", () => {
    const p = profile({ diffAcc: 0.6, effectiveContext: 8_000 });
    expect(selectEditFormat(p, { isNew: false, loc: 5000 })).toBe("search_replace_tight");
  });

  it("falls back to whole-file for a weak model on a large file", () => {
    const p = profile({ diffAcc: 0.2, effectiveContext: 8_000 });
    expect(selectEditFormat(p, { isNew: false, loc: 5000 })).toBe("whole_file");
  });
});

describe("buildEditFormatGuidance", () => {
  it("recommends edit_file broadly for a high-diffAcc model", () => {
    const text = buildEditFormatGuidance(profile({ diffAcc: 0.9 }));
    expect(text).toContain("prefer edit_file");
  });

  it("recommends write_file for small/new files on a low-diffAcc model, naming the LOC cap", () => {
    const text = buildEditFormatGuidance(profile({ diffAcc: 0.4, effectiveContext: 8_000 }));
    expect(text).toContain("prefer write_file");
    expect(text).toContain("400"); // the computed LOC cap at 8k context
  });
});
