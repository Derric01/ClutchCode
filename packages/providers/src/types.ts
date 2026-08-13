/**
 * Provider abstraction (PROJECT_SPEC.md §4.7).
 *
 * ```
 * interface Provider {
 *   id, capabilityDefaults
 *   chat(request: NormalizedRequest): AsyncStream<Delta>
 *   supportsNativeTools, supportsParallelTools, supportsConstrainedDecode
 * }
 * Adapters (MVP): OpenAICompatible (covers most), Anthropic (native), Ollama (native+model mgmt).
 * FakeProvider (CI): scripted, fault-injecting.
 * ```
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  name: string;
  /** JSON-encoded arguments (native tool-calling) or raw text (emulation mode, §4.8). */
  argsJson: string;
}

export interface NormalizedMessage {
  role: Role;
  content: string;
  /** Present on assistant messages that invoked tools. */
  toolCalls?: ToolCallRequest[];
  /** Present on tool-role messages: which call this is a result for. */
  toolCallId?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NormalizedRequest {
  model: string;
  messages: NormalizedMessage[];
  tools?: ToolSchema[];
  maxOutputTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  /** Cooperative cancellation (§6.6). */
  signal?: AbortSignal;
}

export type Delta =
  | { type: "text"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argsDelta: string }
  | { type: "tool_call_end"; id: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens?: number }
  | { type: "done"; finishReason: "stop" | "tool_use" | "length" | "error" }
  | { type: "error"; message: string; retryable: boolean };

export interface CapabilityDefaults {
  /** Best-effort defaults before the §4.9 probe has run for this model. */
  supportsNativeTools: boolean;
  supportsParallelTools: boolean;
  supportsConstrainedDecode: boolean;
  /** A conservative estimate of usable context, used before a probe overrides it. */
  approxEffectiveContext: number;
}

export interface Provider {
  id: string;
  capabilityDefaults: CapabilityDefaults;
  supportsNativeTools: boolean;
  supportsParallelTools: boolean;
  supportsConstrainedDecode: boolean;
  chat(request: NormalizedRequest): AsyncGenerator<Delta, void, void>;
}

/** Collect a full streamed response into one object — a convenience for callers that don't need incremental deltas. */
export interface CollectedResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; argsJson: string }>;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  finishReason: "stop" | "tool_use" | "length" | "error";
}

export async function collect(stream: AsyncGenerator<Delta, void, void>): Promise<CollectedResponse> {
  let text = "";
  const toolCallsById = new Map<string, { id: string; name: string; argsJson: string }>();
  let usage: CollectedResponse["usage"];
  let finishReason: CollectedResponse["finishReason"] = "stop";

  for await (const delta of stream) {
    switch (delta.type) {
      case "text":
        text += delta.text;
        break;
      case "tool_call_start":
        toolCallsById.set(delta.id, { id: delta.id, name: delta.name, argsJson: "" });
        break;
      case "tool_call_delta": {
        const call = toolCallsById.get(delta.id);
        if (call) call.argsJson += delta.argsDelta;
        break;
      }
      case "tool_call_end":
        break;
      case "usage":
        usage = { inputTokens: delta.inputTokens, outputTokens: delta.outputTokens, cachedTokens: delta.cachedTokens };
        break;
      case "done":
        finishReason = delta.finishReason;
        break;
      case "error":
        finishReason = "error";
        break;
    }
  }

  return { text, toolCalls: [...toolCallsById.values()], usage, finishReason };
}
