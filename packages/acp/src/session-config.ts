import type { AgentConfig, ProviderKind } from "@clutchcode/agent-api";

/**
 * Resolves which provider/model an ACP session should run with (PROJECT_SPEC.md
 * §18.1/§20). ACP's `session/new` has no provider/model fields of its own —
 * unlike the CLI's `run` command, which takes `--provider`/`--model` as
 * required flags (`apps/cli/src/commands.ts`'s `RunCommandOptions`) — so the
 * binding needs its own source of truth. The natural fit is the repo's own
 * `agent.toml` (`defaultProvider` → `providers[name]`, written by `agent init`
 * + `agent providers set-key`), the same config every other ClutchCode
 * surface already reads. `_meta` is ACP's own sanctioned extensibility
 * mechanism ("Implementations MUST NOT make assumptions about values at
 * these keys" — i.e. any client MAY ignore them; we treat that as
 * *optional* per-session override, never a requirement to send them.
 */
export interface ResolvedSessionProvider {
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
}

const META_PROVIDER_KEY = "clutchcode/provider";
const META_MODEL_KEY = "clutchcode/model";
const META_BASE_URL_KEY = "clutchcode/baseUrl";

const KNOWN_PROVIDER_KINDS: ReadonlySet<string> = new Set(["openai-compatible", "anthropic", "ollama", "fake"]);

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Pure and side-effect-free so it is directly unit-testable against a
 * literal `AgentConfig`/`_meta` object — no disk, no `Agent`, no ACP
 * connection needed to exercise every branch.
 */
export function resolveSessionProvider(config: AgentConfig, meta: Record<string, unknown> | null | undefined): ResolvedSessionProvider | { error: string } {
  const providerOverride = metaString(meta, META_PROVIDER_KEY);
  if (providerOverride && !KNOWN_PROVIDER_KINDS.has(providerOverride)) {
    return { error: `_meta["${META_PROVIDER_KEY}"] "${providerOverride}" is not a known provider kind (openai-compatible | anthropic | ollama | fake)` };
  }

  const providerName = config.defaultProvider;
  const providerConfig = providerName ? config.providers[providerName] : undefined;

  const providerKind = (providerOverride as ProviderKind | undefined) ?? providerConfig?.kind;
  if (!providerKind) {
    return {
      error: providerName
        ? `agent.toml's defaultProvider "${providerName}" has no matching [providers.${providerName}] entry, and no _meta["${META_PROVIDER_KEY}"] override was sent`
        : `no defaultProvider configured in agent.toml, and no _meta["${META_PROVIDER_KEY}"] override was sent — run \`clutchcode providers set-key\` in this repo, or send _meta["${META_PROVIDER_KEY}"]/_meta["${META_MODEL_KEY}"] on session/new`
    };
  }

  const model = metaString(meta, META_MODEL_KEY) ?? providerConfig?.model;
  if (!model) {
    return { error: `no model configured for provider "${providerKind}" — set [providers.<name>].model in agent.toml, or send _meta["${META_MODEL_KEY}"] on session/new` };
  }

  const baseUrl = metaString(meta, META_BASE_URL_KEY) ?? providerConfig?.baseUrl;
  return { providerKind, model, ...(baseUrl ? { baseUrl } : {}) };
}
