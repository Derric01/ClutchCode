import { parseSSE } from "./sse.js";
import type { CapabilityDefaults, Delta, NormalizedRequest, Provider, ToolSchema } from "./types.js";

/**
 * Native Anthropic adapter (PROJECT_SPEC.md §4.7 — "native paths" for
 * provider-specific features that the OpenAI-compatible adapter can't
 * express). Talks to the Messages API (`/v1/messages`, streaming).
 */

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl?: string; // default https://api.anthropic.com
  apiVersion?: string; // default 2023-06-01
  fetchImpl?: typeof fetch;
  capabilityDefaults?: Partial<CapabilityDefaults>;
}

const DEFAULT_CAPS: CapabilityDefaults = {
  supportsNativeTools: true,
  supportsParallelTools: true,
  supportsConstrainedDecode: false,
  approxEffectiveContext: 200_000
};

const DEFAULT_MAX_TOKENS = 4096;

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toAnthropicRequest(request: NormalizedRequest): { system: string; messages: unknown[] } {
  let system = "";
  const messages: Array<Record<string, unknown>> = [];

  for (const m of request.messages) {
    if (m.role === "system") {
      system += (system ? "\n" : "") + m.content;
      continue;
    }
    if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: safeParseJson(tc.argsJson) });
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }

  return { system, messages };
}

function toAnthropicTool(t: ToolSchema): Record<string, unknown> {
  return { name: t.name, description: t.description, input_schema: t.parameters };
}

function mapStopReason(reason: string | null | undefined): "stop" | "tool_use" | "length" | "error" {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "length";
    case "end_turn":
    case "stop_sequence":
    default:
      return "stop";
  }
}

interface AnthropicSSEData {
  type: string;
  message?: { usage?: { input_tokens?: number } };
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  readonly capabilityDefaults: CapabilityDefaults;
  readonly supportsNativeTools: boolean;
  readonly supportsParallelTools: boolean;
  readonly supportsConstrainedDecode: boolean;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.apiVersion = opts.apiVersion ?? "2023-06-01";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.capabilityDefaults = { ...DEFAULT_CAPS, ...opts.capabilityDefaults };
    this.supportsNativeTools = this.capabilityDefaults.supportsNativeTools;
    this.supportsParallelTools = this.capabilityDefaults.supportsParallelTools;
    this.supportsConstrainedDecode = this.capabilityDefaults.supportsConstrainedDecode;
  }

  async *chat(request: NormalizedRequest): AsyncGenerator<Delta, void, void> {
    const { system, messages } = toAnthropicRequest(request);
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      stream: true
    };
    if (system) body.system = system;
    if (request.tools && request.tools.length > 0) body.tools = request.tools.map(toAnthropicTool);
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences) body.stop_sequences = request.stopSequences;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": this.apiVersion,
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {})
        },
        body: JSON.stringify(body),
        signal: request.signal
      });
    } catch (e) {
      yield { type: "error", message: `network error calling Anthropic: ${String(e)}`, retryable: true };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield {
        type: "error",
        message: `Anthropic returned ${res.status}: ${text.slice(0, 500)}`,
        retryable: res.status >= 500 || res.status === 429
      };
      return;
    }

    const blocksByIndex = new Map<number, { kind: "text" | "tool_use"; id: string }>();
    let inputTokens = 0;

    for await (const evt of parseSSE(res.body)) {
      let json: AnthropicSSEData;
      try {
        json = JSON.parse(evt.data) as AnthropicSSEData;
      } catch {
        continue;
      }

      switch (json.type) {
        case "message_start":
          inputTokens = json.message?.usage?.input_tokens ?? 0;
          break;

        case "content_block_start": {
          const idx = json.index ?? 0;
          const block = json.content_block;
          if (block?.type === "tool_use") {
            const id = block.id ?? `block_${idx}`;
            blocksByIndex.set(idx, { kind: "tool_use", id });
            yield { type: "tool_call_start", id, name: block.name ?? "" };
          } else {
            blocksByIndex.set(idx, { kind: "text", id: `block_${idx}` });
          }
          break;
        }

        case "content_block_delta": {
          const idx = json.index ?? 0;
          const block = blocksByIndex.get(idx);
          if (block?.kind === "text" && json.delta?.type === "text_delta" && json.delta.text) {
            yield { type: "text", text: json.delta.text };
          } else if (block?.kind === "tool_use" && json.delta?.type === "input_json_delta") {
            yield { type: "tool_call_delta", id: block.id, argsDelta: json.delta.partial_json ?? "" };
          }
          break;
        }

        case "content_block_stop": {
          const idx = json.index ?? 0;
          const block = blocksByIndex.get(idx);
          if (block?.kind === "tool_use") {
            yield { type: "tool_call_end", id: block.id };
          }
          break;
        }

        case "message_delta": {
          const outputTokens = json.usage?.output_tokens ?? 0;
          yield { type: "usage", inputTokens, outputTokens };
          if (json.delta?.stop_reason) {
            yield { type: "done", finishReason: mapStopReason(json.delta.stop_reason) };
          }
          break;
        }

        case "error":
          yield { type: "error", message: json.error?.message ?? "unknown Anthropic stream error", retryable: false };
          return;

        default:
          break;
      }
    }
  }
}
