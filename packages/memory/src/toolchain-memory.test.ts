import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeManifestHash,
  correctToolchainFact,
  forgetToolchainFact,
  getOrDetectToolchain,
  listToolchainMemory,
  markToolchainFactStale,
  showToolchainFact
} from "./toolchain-memory.js";

/** `detectToolchain` (from @clutchcode/verification) wraps `package.json` scripts as `<packageManager> run <scriptName>` — it doesn't surface a script's raw command text, only whether the script key exists and which package manager (by lockfile) ran it. */
function makeNodeRepo(dir: string, scripts: Record<string, string> = { test: "x", build: "x" }): void {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts }, null, 2), "utf8");
}

function makePythonRepo(dir: string): void {
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"sample\"\n", "utf8");
}

describe("computeManifestHash", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-hash-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("is stable when nothing changes", () => {
    makeNodeRepo(repo);
    expect(computeManifestHash(repo)).toBe(computeManifestHash(repo));
  });

  it("changes when package.json's content changes (§10.3 point 2)", () => {
    makeNodeRepo(repo);
    const before = computeManifestHash(repo);
    makeNodeRepo(repo, { test: "x", build: "x", lint: "x" });
    expect(computeManifestHash(repo)).not.toBe(before);
  });

  it("is the same for a repo with no manifest files at all, every time", () => {
    expect(computeManifestHash(repo)).toBe(computeManifestHash(repo));
  });
});

describe("getOrDetectToolchain / listToolchainMemory", () => {
  let repo: string;
  let configDir: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-repo-"));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-config-"));
    makeNodeRepo(repo);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("derives fresh on first call (fromCache: false) and persists provenance + timestamps", () => {
    const result = getOrDetectToolchain(repo, repo, undefined, { configDir });
    expect(result.fromCache).toBe(false);
    expect(result.commands.test).toBe("npm run test");

    const memory = listToolchainMemory(repo, { configDir });
    expect(memory).toBeDefined();
    expect(memory!.facts.test?.value).toBe("npm run test");
    expect(memory!.facts.test?.source).toBeTruthy();
    expect(new Date(memory!.facts.test!.derivedAt).getTime()).toBeGreaterThan(0);
  });

  it("reuses the cache on a second call when nothing changed (fromCache: true)", () => {
    getOrDetectToolchain(repo, repo, undefined, { configDir });
    const second = getOrDetectToolchain(repo, repo, undefined, { configDir });
    expect(second.fromCache).toBe(true);
    expect(second.commands.test).toBe("npm run test");
  });

  it("re-derives when the manifest changes — here, a lockfile appearing switches the detected package manager (§10.3 point 2)", () => {
    getOrDetectToolchain(repo, repo, undefined, { configDir });
    fs.writeFileSync(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    const second = getOrDetectToolchain(repo, repo, undefined, { configDir });
    expect(second.fromCache).toBe(false);
    expect(second.commands.test).toBe("pnpm run test");
  });

  it("applies AGENTS.md overrides on every re-derive (§10.3 point 4, human edits win)", () => {
    const result = getOrDetectToolchain(repo, repo, "- test: `custom-test-runner`", { configDir });
    expect(result.commands.test).toBe("custom-test-runner");
    expect(listToolchainMemory(repo, { configDir })!.facts.test?.source).toContain("AGENTS.md");
  });

  it("returns undefined from listToolchainMemory before anything has been derived", () => {
    expect(listToolchainMemory(repo, { configDir })).toBeUndefined();
  });

  it("two different repos never share a cache entry", () => {
    const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-other-repo-"));
    try {
      makePythonRepo(otherRepo);
      getOrDetectToolchain(repo, repo, undefined, { configDir });
      getOrDetectToolchain(otherRepo, otherRepo, undefined, { configDir });
      expect(listToolchainMemory(repo, { configDir })!.facts.test?.value).toBe("npm run test");
      expect(listToolchainMemory(otherRepo, { configDir })!.facts.test?.value).toBe("pytest -q");
    } finally {
      fs.rmSync(otherRepo, { recursive: true, force: true });
    }
  });

  it("a corrupted cache file is treated as no cache, not a crash", () => {
    getOrDetectToolchain(repo, repo, undefined, { configDir });
    const files = fs.readdirSync(configDir);
    fs.writeFileSync(path.join(configDir, files[0]!), "not valid json", "utf8");
    expect(() => getOrDetectToolchain(repo, repo, undefined, { configDir })).not.toThrow();
    expect(getOrDetectToolchain(repo, repo, undefined, { configDir }).fromCache).toBe(true); // re-derived once above, cached properly the second time
  });
});

describe("showToolchainFact / forgetToolchainFact / correctToolchainFact", () => {
  let repo: string;
  let configDir: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-repo2-"));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-config2-"));
    makeNodeRepo(repo);
    getOrDetectToolchain(repo, repo, undefined, { configDir });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("show returns the full fact detail", () => {
    const fact = showToolchainFact(repo, "test", { configDir });
    expect(fact?.value).toBe("npm run test");
    expect(fact?.source).toBeTruthy();
  });

  it("show returns undefined for a key that was never derived (e.g. lint, when there's no lint script)", () => {
    expect(showToolchainFact(repo, "lint", { configDir })).toBeUndefined();
  });

  it("forget removes one fact and reports true; forgetting again reports false", () => {
    expect(forgetToolchainFact(repo, "test", { configDir })).toBe(true);
    expect(showToolchainFact(repo, "test", { configDir })).toBeUndefined();
    expect(forgetToolchainFact(repo, "test", { configDir })).toBe(false);
  });

  it("forgetting one fact doesn't disturb others", () => {
    forgetToolchainFact(repo, "test", { configDir });
    expect(showToolchainFact(repo, "build", { configDir })?.value).toBe("npm run build");
  });

  it("correct overwrites a fact's value with a human-authored one and records provenance", () => {
    correctToolchainFact(repo, "test", "pytest -q --maxfail=1", { configDir });
    const fact = showToolchainFact(repo, "test", { configDir });
    expect(fact?.value).toBe("pytest -q --maxfail=1");
    expect(fact?.source).toContain("human-corrected");
  });

  it("correct works even when nothing was cached yet for that repo", () => {
    const freshRepo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-fresh-"));
    try {
      correctToolchainFact(freshRepo, "test", "custom test command", { configDir });
      expect(showToolchainFact(freshRepo, "test", { configDir })?.value).toBe("custom test command");
    } finally {
      fs.rmSync(freshRepo, { recursive: true, force: true });
    }
  });

  it("a corrected fact survives a subsequent cache-hit read (manifest unchanged)", () => {
    correctToolchainFact(repo, "test", "corrected-command", { configDir });
    const result = getOrDetectToolchain(repo, repo, undefined, { configDir });
    // manifestHash is freshly recomputed by correctToolchainFact and happens to match
    // (package.json wasn't edited) — cache hit, corrected value preserved either way.
    expect(result.fromCache).toBe(true);
    expect(result.commands.test).toBe("corrected-command");
  });

  it("a correction still survives a cache-hit read even when the cached manifestHash was already stale before the correction ran (real bug caught in code review — §10.3 point 4, 'human edits win')", () => {
    // package.json changes *after* the initial getOrDetectToolchain (in
    // beforeEach) but *before* the correction — the cached record's
    // manifestHash is now stale relative to the repo's real current state.
    makeNodeRepo(repo, { test: "x", build: "x", lint: "x" });

    correctToolchainFact(repo, "test", "corrected-command", { configDir });
    const result = getOrDetectToolchain(repo, repo, undefined, { configDir });
    // Before the fix: correctToolchainFact left the stale hash untouched, so this
    // call would see a mismatch, conclude the whole record was stale, and silently
    // re-derive from scratch — discarding the correction with no warning.
    expect(result.fromCache).toBe(true);
    expect(result.commands.test).toBe("corrected-command");
  });
});

describe("markToolchainFactStale (§10.3 point 3 — verification is the truth oracle)", () => {
  let repo: string;
  let configDir: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-repo3-"));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-memory-config3-"));
    makeNodeRepo(repo);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("marking a fact stale forces re-derivation on the next getOrDetectToolchain call, even with an unchanged manifest", () => {
    getOrDetectToolchain(repo, repo, undefined, { configDir });
    markToolchainFactStale(repo, "test", "command not found when actually run", { configDir });

    expect(showToolchainFact(repo, "test", { configDir })?.stale).toBe(true);
    const result = getOrDetectToolchain(repo, repo, undefined, { configDir });
    expect(result.fromCache).toBe(false); // re-derived despite the manifest not changing, because a fact was stale
    // Fresh re-derivation clears the stale flag (it's a brand new record).
    expect(showToolchainFact(repo, "test", { configDir })?.stale).toBeUndefined();
  });

  it("is a silent no-op when nothing is cached yet for this repo or fact", () => {
    expect(() => markToolchainFactStale(repo, "test", "reason", { configDir })).not.toThrow();
    expect(listToolchainMemory(repo, { configDir })).toBeUndefined();
  });
});
