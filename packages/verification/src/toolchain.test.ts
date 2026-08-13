import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAgentsMdOverrides, detectToolchain } from "./toolchain.js";

describe("detectToolchain", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-toolchain-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects a node project via package.json scripts and pnpm-lock.yaml", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run", lint: "eslint ." } }),
      "utf8"
    );
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "", "utf8");

    const commands = detectToolchain(dir);
    expect(commands.language).toBe("node");
    expect(commands.packageManager).toBe("pnpm");
    expect(commands.build).toBe("pnpm run build");
    expect(commands.test).toBe("pnpm run test");
    expect(commands.lint).toBe("pnpm run lint");
    expect(commands.typecheck).toBeUndefined();
  });

  it("defaults to npm when no lockfile is present", () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "jest" } }), "utf8");
    const commands = detectToolchain(dir);
    expect(commands.packageManager).toBe("npm");
    expect(commands.test).toBe("npm run test");
  });

  it("detects a python project", () => {
    fs.writeFileSync(path.join(dir, "pyproject.toml"), "[tool.poetry]\n", "utf8");
    fs.writeFileSync(path.join(dir, "poetry.lock"), "", "utf8");
    const commands = detectToolchain(dir);
    expect(commands.language).toBe("python");
    expect(commands.packageManager).toBe("poetry");
    expect(commands.test).toBe("pytest -q");
  });

  it("detects a rust project", () => {
    fs.writeFileSync(path.join(dir, "Cargo.toml"), "[package]\nname = \"x\"\n", "utf8");
    const commands = detectToolchain(dir);
    expect(commands.language).toBe("rust");
    expect(commands.test).toBe("cargo test");
  });

  it("detects a go project", () => {
    fs.writeFileSync(path.join(dir, "go.mod"), "module x\n", "utf8");
    const commands = detectToolchain(dir);
    expect(commands.language).toBe("go");
    expect(commands.test).toBe("go test ./...");
  });

  it("returns unknown with provenance when no manifest is found", () => {
    const commands = detectToolchain(dir);
    expect(commands.language).toBe("unknown");
    expect(commands.provenance).toContain(dir);
  });
});

describe("applyAgentsMdOverrides", () => {
  it("overrides detected commands and stamps provenance", () => {
    const base = { language: "node" as const, test: "npm run test", provenance: "derived from package.json" };
    const agentsMd = "## Commands\n- test: `pytest -q -k 'not slow'`\n- lint: ruff check .\n";

    const overridden = applyAgentsMdOverrides(base, agentsMd);

    expect(overridden.test).toBe("pytest -q -k 'not slow'");
    expect(overridden.lint).toBe("ruff check .");
    expect(overridden.provenance).toMatch(/AGENTS\.md/);
  });

  it("leaves commands untouched when AGENTS.md has no override lines", () => {
    const base = { language: "node" as const, test: "npm run test", provenance: "derived from package.json" };
    const overridden = applyAgentsMdOverrides(base, "# My Project\nJust a description.\n");
    expect(overridden.test).toBe("npm run test");
    expect(overridden.provenance).toBe("derived from package.json");
  });
});
