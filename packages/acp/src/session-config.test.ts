import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@clutchcode/agent-api";
import { resolveSessionProvider } from "./session-config.js";

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { apiVersion: "clutchcode/v1", providers: {}, trustedRepos: [], ...overrides };
}

describe("resolveSessionProvider (§18.1 ACP session/new provider resolution)", () => {
  it("resolves providerKind/model/baseUrl from agent.toml's defaultProvider when no _meta override is sent", () => {
    const cfg = config({
      defaultProvider: "work",
      providers: { work: { kind: "anthropic", model: "claude-x", baseUrl: "https://example.test" } }
    });
    const resolved = resolveSessionProvider(cfg, undefined);
    expect(resolved).toEqual({ providerKind: "anthropic", model: "claude-x", baseUrl: "https://example.test" });
  });

  it("omits baseUrl entirely when the provider config doesn't set one", () => {
    const cfg = config({ defaultProvider: "local", providers: { local: { kind: "ollama", model: "qwen2.5-coder" } } });
    const resolved = resolveSessionProvider(cfg, undefined);
    expect(resolved).toEqual({ providerKind: "ollama", model: "qwen2.5-coder" });
  });

  it("errors when no defaultProvider is configured and no _meta override is sent", () => {
    const resolved = resolveSessionProvider(config(), undefined);
    expect(resolved).toHaveProperty("error");
    expect((resolved as { error: string }).error).toContain("no defaultProvider configured");
  });

  it("errors when defaultProvider points at a provider name with no matching [providers.<name>] entry", () => {
    const cfg = config({ defaultProvider: "ghost" });
    const resolved = resolveSessionProvider(cfg, undefined);
    expect((resolved as { error: string }).error).toContain('defaultProvider "ghost"');
  });

  it("errors when the resolved provider has no model configured", () => {
    const cfg = config({ defaultProvider: "work", providers: { work: { kind: "anthropic" } } });
    const resolved = resolveSessionProvider(cfg, undefined);
    expect((resolved as { error: string }).error).toContain("no model configured");
  });

  it("lets _meta override provider/model/baseUrl even when agent.toml has a configured default", () => {
    const cfg = config({ defaultProvider: "work", providers: { work: { kind: "anthropic", model: "claude-x" } } });
    const resolved = resolveSessionProvider(cfg, {
      "clutchcode/provider": "fake",
      "clutchcode/model": "n/a",
      "clutchcode/baseUrl": "http://localhost:9"
    });
    expect(resolved).toEqual({ providerKind: "fake", model: "n/a", baseUrl: "http://localhost:9" });
  });

  it("lets _meta fully substitute for agent.toml when the repo has no config at all", () => {
    const resolved = resolveSessionProvider(config(), { "clutchcode/provider": "fake", "clutchcode/model": "n/a" });
    expect(resolved).toEqual({ providerKind: "fake", model: "n/a" });
  });

  it("rejects an unknown _meta provider override rather than silently passing it through", () => {
    const resolved = resolveSessionProvider(config(), { "clutchcode/provider": "not-a-real-provider" });
    expect((resolved as { error: string }).error).toContain("not a known provider kind");
  });

  it("ignores non-string _meta values instead of trusting them", () => {
    const cfg = config({ defaultProvider: "work", providers: { work: { kind: "anthropic", model: "claude-x" } } });
    const resolved = resolveSessionProvider(cfg, { "clutchcode/provider": 42, "clutchcode/model": null });
    expect(resolved).toEqual({ providerKind: "anthropic", model: "claude-x" });
  });
});
