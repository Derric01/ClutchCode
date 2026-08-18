import { describe, expect, it } from "vitest";
import { applyEditBlock, applyEdits } from "./edit-cascade.js";

describe("applyEditBlock — strategy 1: exact match", () => {
  it("applies a char-for-char match", () => {
    const content = "function add(a, b) {\n  return a + b;\n}\n";
    const result = applyEditBlock(content, {
      search: "  return a + b;",
      replace: "  return a + b; // sum"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.strategy).toBe("exact");
      expect(result.content).toContain("return a + b; // sum");
    }
  });

  it("reports a structured failure with nearest context on a total miss", () => {
    const content = "function add(a, b) {\n  return a + b;\n}\n";
    const result = applyEditBlock(content, {
      search: "  return a - b;",
      replace: "  return a - b; // diff"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/did not match/);
    }
  });
});

describe("applyEditBlock — strategy 2: uniform leading-whitespace drift", () => {
  it("tolerates a uniform indent offset between search and content", () => {
    const content = "class Foo {\n    function bar() {\n        return 1;\n    }\n}\n";
    // Model captured the inner block without the class-level 4-space indent.
    const search = "function bar() {\n    return 1;\n}";
    const replace = "function bar() {\n    return 2;\n}";
    const result = applyEditBlock(content, { search, replace });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.strategy).toBe("whitespace-tolerant");
      expect(result.content).toContain("    function bar() {\n        return 2;\n    }");
    }
  });
});

describe("applyEditBlock — strategy 3: spurious leading blank line", () => {
  it("drops a leading blank line in SEARCH and retries", () => {
    // "line2" is the very first line of the file, so there is no preceding
    // newline for an exact match on a spuriously-blank-line-prefixed search
    // to land on — this is precisely the case the strategy exists for.
    const content = "line2\nline3\n";
    const result = applyEditBlock(content, {
      search: "\nline2\nline3",
      replace: "\nLINE2\nline3"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.strategy).toBe("blank-line-drop");
      expect(result.content).toContain("LINE2");
    }
  });
});

describe("applyEditBlock — strategy 4: explicit ... elision", () => {
  it("matches head and tail segments and preserves the elided middle untouched", () => {
    const content = ["function big() {", "  const a = 1;", "  const b = 2;", "  const c = 3;", "  return a + b + c;", "}"].join(
      "\n"
    );
    const search = ["function big() {", "...", "  return a + b + c;", "}"].join("\n");
    const replace = ["function big() {", "...", "  return (a + b + c) * 2;", "}"].join("\n");

    const result = applyEditBlock(content, { search, replace });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.strategy).toBe("ellipsis-elision");
      // Elided middle lines are preserved untouched.
      expect(result.content).toContain("  const a = 1;");
      expect(result.content).toContain("  const b = 2;");
      expect(result.content).toContain("  const c = 3;");
      expect(result.content).toContain("return (a + b + c) * 2;");
    }
  });

  it("matches a SEARCH block that starts with its own ellipsis line — a leading ellipsis (real bug caught in code review: this used to fail unconditionally)", () => {
    const content = ["function big() {", "  const a = 1;", "  const b = 2;", "  const c = 3;", "  return a + b + c;", "}"].join(
      "\n"
    );
    const search = ["...", "  return a + b + c;", "}"].join("\n");
    const replace = ["...", "  return (a + b + c) * 2;", "}"].join("\n");

    const result = applyEditBlock(content, { search, replace });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.strategy).toBe("ellipsis-elision");
      // Everything before the first real anchor is preserved untouched.
      expect(result.content).toContain("  const a = 1;");
      expect(result.content).toContain("  const b = 2;");
      expect(result.content).toContain("  const c = 3;");
      expect(result.content).toContain("return (a + b + c) * 2;");
    }
  });
});

describe("applyEdits — sequential application", () => {
  it("applies multiple blocks in order and reports which block failed on a miss", () => {
    const content = "a\nb\nc\n";
    const result = applyEdits(content, [
      { search: "a", replace: "A" },
      { search: "does-not-exist", replace: "X" },
      { search: "c", replace: "C" }
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.blockIndex).toBe(1);
    }
  });

  it("applies all blocks successfully when every one matches", () => {
    const content = "a\nb\nc\n";
    const result = applyEdits(content, [
      { search: "a", replace: "A" },
      { search: "b", replace: "B" },
      { search: "c", replace: "C" }
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("A\nB\nC\n");
      expect(result.strategiesUsed).toEqual(["exact", "exact", "exact"]);
    }
  });
});
