import { AnthropicProvider, FakeProvider, OllamaProvider, OpenAICompatibleProvider, textTurn, type Provider } from "@clutchcode/providers";
import type { Credentials } from "./credentials.js";

export type ProviderKind = "openai-compatible" | "anthropic" | "ollama" | "fake";

export interface BuildProviderOptions {
  kind: ProviderKind;
  baseUrl?: string;
  credentials: Credentials;
}

/**
 * Provider abstraction wiring (§4.7): one factory over the MVP adapters.
 * `"fake"` is exposed intentionally — it powers `agent run --dry-run` /
 * offline demos and the test suite, never a real task by accident (the CLI
 * never selects it implicitly).
 */
export function buildProvider(opts: BuildProviderOptions): Provider {
  switch (opts.kind) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: opts.credentials.anthropicApiKey });
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        baseUrl: opts.baseUrl ?? opts.credentials.openaiBaseUrl ?? "https://api.openai.com/v1",
        apiKey: opts.credentials.openaiApiKey
      });
    case "ollama":
      return new OllamaProvider({ baseUrl: opts.baseUrl });
    case "fake":
      // A harmless single-turn no-op so `--dry-run` completes instead of hanging.
      return new FakeProvider([textTurn("(dry-run: no real provider configured)")]);
    default: {
      const exhaustive: never = opts.kind;
      throw new Error(`unknown provider kind: ${exhaustive as string}`);
    }
  }
}
