import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, isTrustedRepo, loadConfig, markTrusted, saveConfig } from "./config.js";
import { makeTempDir } from "./test-helpers.js";

describe("config", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = makeTempDir("clutchcode-config-test-");
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("returns a default config when no agent.toml exists", () => {
    const config = loadConfig(repoPath);
    expect(config.apiVersion).toBe("clutchcode/v1");
    expect(config.trustedRepos).toEqual([]);
  });

  it("round-trips a saved config through TOML", () => {
    saveConfig(repoPath, { ...DEFAULT_CONFIG, defaultProvider: "ollama", trustedRepos: ["/some/repo"] });
    const loaded = loadConfig(repoPath);
    expect(loaded.defaultProvider).toBe("ollama");
    expect(loaded.trustedRepos).toEqual(["/some/repo"]);
  });

  it("rejects a config with an unrecognized apiVersion", () => {
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(`${repoPath}/agent.toml`, 'apiVersion = "clutchcode/v99"\n', "utf8");
    expect(() => loadConfig(repoPath)).toThrow(/apiVersion/);
  });

  it("markTrusted adds the repo (idempotently) to trustedRepos", () => {
    markTrusted(repoPath);
    markTrusted(repoPath); // second call should not duplicate
    const config = loadConfig(repoPath);
    expect(config.trustedRepos).toHaveLength(1);
    expect(isTrustedRepo(config, repoPath)).toBe(true);
  });
});
