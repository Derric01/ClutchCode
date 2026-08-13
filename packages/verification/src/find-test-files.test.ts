import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTestFiles } from "./find-test-files.js";

describe("findTestFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-findtests-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds .test./.spec. files, python test_*.py, and go _test.go files", () => {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "math.test.ts"), "", "utf8");
    fs.writeFileSync(path.join(dir, "src", "util.spec.js"), "", "utf8");
    fs.writeFileSync(path.join(dir, "src", "math.ts"), "", "utf8"); // not a test
    fs.writeFileSync(path.join(dir, "test_widget.py"), "", "utf8");
    fs.writeFileSync(path.join(dir, "widget_test.go"), "", "utf8");

    const found = findTestFiles(dir).sort();
    expect(found).toEqual([path.join("src", "math.test.ts"), path.join("src", "util.spec.js"), "test_widget.py", "widget_test.go"].sort());
  });

  it("skips node_modules, .git, and other build/vendor directories", () => {
    fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "pkg", "index.test.js"), "", "utf8");
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "bundle.test.js"), "", "utf8");

    expect(findTestFiles(dir)).toEqual([]);
  });
});
