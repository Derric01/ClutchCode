import type { CapabilityDefaults, Delta, NormalizedRequest, Provider } from "./types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Ollama adapter (PROJECT_SPEC.md §4.7, §4.10): native chat via Ollama's
 * OpenAI-compatible `/v1` endpoint (reuses OpenAICompatibleProvider), plus a
 * thin native-API surface for model management (`agent models pull`,
 * `agent doctor`, §4.10) that the `/v1` endpoint doesn't cover.
 */

const DEFAULT_CAPS: Partial<CapabilityDefaults> = {
  // Local models are the canonical weak-model case (§4.1) — default
  // conservatively; the capability probe (§4.9) overrides this per model.
  supportsNativeTools: false,
  supportsParallelTools: false,
  supportsConstrainedDecode: true,
  approxEffectiveContext: 8_000
};

export interface OllamaOptions {
  baseUrl?: string; // e.g. http://localhost:11434
  fetchImpl?: typeof fetch;
  capabilityDefaults?: Partial<CapabilityDefaults>;
}

export class OllamaProvider implements Provider {
  readonly id = "ollama";
  readonly capabilityDefaults: CapabilityDefaults;
  readonly supportsNativeTools: boolean;
  readonly supportsParallelTools: boolean;
  readonly supportsConstrainedDecode: boolean;

  private readonly nativeBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly inner: OpenAICompatibleProvider;

  constructor(opts: OllamaOptions = {}) {
    this.nativeBaseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.inner = new OpenAICompatibleProvider({
      baseUrl: `${this.nativeBaseUrl}/v1`,
      id: "ollama",
      fetchImpl: this.fetchImpl,
      capabilityDefaults: { ...DEFAULT_CAPS, ...opts.capabilityDefaults }
    });
    this.capabilityDefaults = this.inner.capabilityDefaults;
    this.supportsNativeTools = this.inner.supportsNativeTools;
    this.supportsParallelTools = this.inner.supportsParallelTools;
    this.supportsConstrainedDecode = this.inner.supportsConstrainedDecode;
  }

  chat(request: NormalizedRequest): AsyncGenerator<Delta, void, void> {
    return this.inner.chat(request);
  }

  /** `agent models pull` (§4.10) — wraps Ollama's native pull API. Returns once the model is fully pulled. */
  async pull(model: string): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.nativeBaseUrl}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false })
      });
    } catch (e) {
      return { ok: false, error: `network error contacting Ollama: ${String(e)}` };
    }
    if (!res.ok) return { ok: false, error: `pull failed: ${res.status} ${await res.text().catch(() => "")}` };
    return { ok: true };
  }

  /** `agent doctor` (§4.10) — list locally-available models. */
  async listLocalModels(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.nativeBaseUrl}/api/tags`);
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => m.name);
  }
}
