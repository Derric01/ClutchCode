import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * Config schema/contract (PROJECT_SPEC.md §19.2, ADR-003): `agent.toml`,
 * TOML for human-editability + comments. Full JSON-Schema validation and
 * `apiVersion`-gated migrations (§8.2) are a Phase-2 hardening item; this
 * loader validates just enough shape to fail loudly on garbage.
 */

export interface ProviderConfig {
  kind: "openai-compatible" | "anthropic" | "ollama";
  baseUrl?: string;
  model?: string;
}

export interface AgentConfig {
  apiVersion: "clutchcode/v1";
  defaultProvider?: string;
  providers: Record<string, ProviderConfig>;
  trustedRepos: string[];
  policy?: {
    costCeilingUsd?: number;
    /** §12.6: "auto" (default) uses OS sandbox Tier 1 (bwrap/Seatbelt) when available; "tier0" opts out and runs with the policy engine only — an escape hatch for a setup Tier 1's confinement breaks. */
    sandboxTier?: "auto" | "tier0";
  };
}

export const DEFAULT_CONFIG: AgentConfig = {
  apiVersion: "clutchcode/v1",
  providers: {},
  trustedRepos: []
};

export function configPath(repoPath: string): string {
  return path.join(repoPath, "agent.toml");
}

export function loadConfig(repoPath: string): AgentConfig {
  const p = configPath(repoPath);
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG, providers: {}, trustedRepos: [] };

  const raw = parseToml(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  if (raw.apiVersion !== "clutchcode/v1") {
    throw new Error(`${p}: unknown or missing apiVersion (expected "clutchcode/v1"); run \`agent config migrate\``);
  }
  return {
    apiVersion: "clutchcode/v1",
    defaultProvider: typeof raw.defaultProvider === "string" ? raw.defaultProvider : undefined,
    providers: (raw.providers as Record<string, ProviderConfig>) ?? {},
    trustedRepos: Array.isArray(raw.trustedRepos) ? (raw.trustedRepos as string[]) : [],
    policy: raw.policy as AgentConfig["policy"]
  };
}

export function saveConfig(repoPath: string, config: AgentConfig): void {
  fs.writeFileSync(configPath(repoPath), stringifyToml(config as unknown as Record<string, unknown>), "utf8");
}

export function isTrustedRepo(config: AgentConfig, repoPath: string): boolean {
  return config.trustedRepos.includes(path.resolve(repoPath));
}

export function markTrusted(repoPath: string): AgentConfig {
  const config = loadConfig(repoPath);
  const resolved = path.resolve(repoPath);
  if (!config.trustedRepos.includes(resolved)) config.trustedRepos.push(resolved);
  saveConfig(repoPath, config);
  return config;
}
