import { parseSSE } from "./sse.js";
import type { CapabilityDefaults, Delta, NormalizedMessage, NormalizedRequest, Provider, ToolSchema } from "./types.js";

/**
 * OpenAI-compatible adapter (PROJECT_SPEC.md §4.7) — covers the long tail:
 * OpenRouter, Groq, DeepSeek, Together, vLLM `--api`, llama.cpp
 * `llama-server`, LM Studio, and Ollama's `/v1` endpoint (see ollama.ts).
 */

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  id?: string;
  extraHeaders?: Record<string, string>;
  capabilityDefaults?: Partial<CapabilityDefaults>;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_CAPS: CapabilityDefaults = {
  supportsNativeTools: true,
  supportsParallelTools: true,
  supportsConstrainedDecode: false,
  approxEffectiveContext: 32_000
};

function toOpenAIMessage(m: NormalizedMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argsJson }
      }))
    };
  }
  return { role: m.role, content: m.content };
}

function toOpenAITool(t: ToolSchema): Record<string, unknown> {
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
}

function mapFinishReason(reason: string | null | undefined): "stop" | "tool_use" | "length" | "error" {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "length";
    case "stop":
    case null:
    case undefined:
      return "stop";
    default:
      return "stop";
  }
}

interface StreamedToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  readonly capabilityDefaults: CapabilityDefaults;
  readonly supportsNativeTools: boolean;
  readonly supportsParallelTools: boolean;
  readonly supportsConstrainedDecode: boolean;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAICompatibleOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.id = opts.id ?? "openai-compatible";
    this.extraHeaders = opts.extraHeaders ?? {};
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.capabilityDefaults = { ...DEFAULT_CAPS, ...opts.capabilityDefaults };
    this.supportsNativeTools = this.capabilityDefaults.supportsNativeTools;
    this.supportsParallelTools = this.capabilityDefaults.supportsParallelTools;
    this.supportsConstrainedDecode = this.capabilityDefaults.supportsConstrainedDecode;
  }

  async *chat(request: NormalizedRequest): AsyncGenerator<Delta, void, void> {
    const body: Record<string, unknown> = {
      model: request.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: request.messages.map(toOpenAIMessage)
    };
    if (request.tools && request.tools.length > 0) body.tools = request.tools.map(toOpenAITool);
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences) body.stop = request.stopSequences;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...this.extraHeaders
        },
        body: JSON.stringify(body),
        signal: request.signal
      });
    } catch (e) {
      yield { type: "error", message: `network error calling ${this.baseUrl}: ${String(e)}`, retryable: true };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield {
        type: "error",
        message: `provider returned ${res.status}: ${text.slice(0, 500)}`,
        retryable: res.status >= 500 || res.status === 429
      };
      return;
    }

    const toolCallBuffers = new Map<number, { id: string; name: string }>();

    for await (const evt of parseSSE(res.body)) {
      if (evt.data === "[DONE]") return;

      let json: any;
      try {
        json = JSON.parse(evt.data);
      } catch {
        continue;
      }

      const choice = json.choices?.[0];
      if (!choice) {
        if (json.usage) {
          yield { type: "usage", inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
        }
        continue;
      }

      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length > 0) {
        yield { type: "text", text: delta.content };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls as StreamedToolCallDelta[]) {
          const idx = tc.index ?? 0;
          let buf = toolCallBuffers.get(idx);
          if (!buf) {
            buf = { id: tc.id ?? `call_${idx}`, name: tc.function?.name ?? "" };
            toolCallBuffers.set(idx, buf);
            yield { type: "tool_call_start", id: buf.id, name: buf.name };
          }
          if (tc.function?.arguments) {
            yield { type: "tool_call_delta", id: buf.id, argsDelta: tc.function.arguments };
          }
        }
      }

      if (choice.finish_reason) {
        for (const buf of toolCallBuffers.values()) yield { type: "tool_call_end", id: buf.id };
        if (json.usage) {
          yield { type: "usage", inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
        }
        yield { type: "done", finishReason: mapFinishReason(choice.finish_reason) };
      }
    }
  }
}
