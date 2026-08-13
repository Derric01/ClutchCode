import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { truncate, truncateSearchResults } from "./truncate.js";

describe("truncate", () => {
  let evidenceDir: string;

  beforeEach(() => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-truncate-test-"));
  });

  afterEach(() => {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("passes short output through untouched", () => {
    const result = truncate("short output", { budget: 1000, kind: "log", evidenceDir, label: "t" });
    expect(result.truncated).toBe(false);
    expect(result.shown).toBe("short output");
    expect(result.fullRef).toBeUndefined();
  });

  it("truncates long generic logs with head+tail and saves full output to evidence", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const result = truncate(text, { budget: 500, kind: "log", evidenceDir, label: "biglog" });

    expect(result.truncated).toBe(true);
    expect(result.fullRef).toBeDefined();
    expect(fs.readFileSync(result.fullRef!, "utf8")).toBe(text);
    expect(result.shown).toContain("line 0");
    expect(result.shown).toContain("line 1999");
    expect(result.shown).toMatch(/skipped/);
    expect(result.shown).toMatch(/truncated: full output saved/);
  });

  it("keeps failure signatures out of the omitted region for test logs", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) lines.push(`PASS test_${i}`);
    lines.splice(250, 0, "FAIL test_important — AssertionError: expected 1 to equal 2");
    const text = lines.join("\n");

    const result = truncate(text, { budget: 200, kind: "test", evidenceDir, label: "testlog" });
    expect(result.truncated).toBe(true);
    expect(result.shown).toContain("FAIL test_important");
  });
});

describe("truncateSearchResults", () => {
  it("returns top-K matches plus the total count", () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({ file: `f${i}.ts`, line: i, text: "x" }));
    const { shown, totalCount, truncated } = truncateSearchResults(matches, 3);
    expect(shown).toHaveLength(3);
    expect(totalCount).toBe(10);
    expect(truncated).toBe(true);
  });
});
