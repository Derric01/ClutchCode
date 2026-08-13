import type { CapabilityDefaults, Delta, NormalizedRequest, Provider } from "./types.js";

/**
 * FakeProvider (PROJECT_SPEC.md §2, §4.7, ADR-020).
 *
 * Scripted, fault-injecting, zero-token, zero-latency (unless asked
 * otherwise) provider used to test every layer above the model boundary —
 * the runtime, tools, verification, and git — without a real API key or
 * GPU. Also the engine behind the recorded-transcript replay harness
 * (§16.3c, evals/).
 */

export type ScriptedTurn =
  | { kind: "deltas"; deltas: Delta[]; latencyMs?: number }
  | { kind: "error"; message: string; retryable: boolean; latencyMs?: number }
  /** Emits raw, possibly-malformed text (no structured tool call) — for testing edit-format/tool-parse repair (§4.4, §4.8). */
  | { kind: "malformed"; text: string; latencyMs?: number };

export interface FakeProviderOptions {
  id?: string;
  capabilityDefaults?: Partial<CapabilityDefaults>;
}

const DEFAULT_CAPS: CapabilityDefaults = {
  supportsNativeTools: true,
  supportsParallelTools: false,
  supportsConstrainedDecode: false,
  approxEffectiveContext: 32_000
};

export class FakeProvider implements Provider {
  readonly id: string;
  readonly capabilityDefaults: CapabilityDefaults;
  readonly supportsNativeTools: boolean;
  readonly supportsParallelTools: boolean;
  readonly supportsConstrainedDecode: boolean;

  /** Every request this provider received, in order — for assertions in tests. */
  readonly requestLog: NormalizedRequest[] = [];

  private readonly script: ScriptedTurn[];
  private cursor = 0;

  constructor(script: ScriptedTurn[], opts: FakeProviderOptions = {}) {
    this.script = script;
    this.id = opts.id ?? "fake";
    this.capabilityDefaults = { ...DEFAULT_CAPS, ...opts.capabilityDefaults };
    this.supportsNativeTools = this.capabilityDefaults.supportsNativeTools;
    this.supportsParallelTools = this.capabilityDefaults.supportsParallelTools;
    this.supportsConstrainedDecode = this.capabilityDefaults.supportsConstrainedDecode;
  }

  /** How many scripted turns remain unconsumed. */
  remaining(): number {
    return this.script.length - this.cursor;
  }

  async *chat(request: NormalizedRequest): AsyncGenerator<Delta, void, void> {
    this.requestLog.push(request);

    if (this.cursor >= this.script.length) {
      throw new Error(
        `FakeProvider script exhausted after ${this.cursor} turn(s); the runtime made an extra model call the test didn't script for`
      );
    }
    const turn = this.script[this.cursor++]!;

    if (turn.latencyMs) await new Promise((r) => setTimeout(r, turn.latencyMs));

    if (request.signal?.aborted) {
      yield { type: "error", message: "aborted", retryable: false };
      return;
    }

    switch (turn.kind) {
      case "deltas":
        for (const d of turn.deltas) {
          if (request.signal?.aborted) {
            yield { type: "error", message: "aborted", retryable: false };
            return;
          }
          yield d;
        }
        return;
      case "error":
        yield { type: "error", message: turn.message, retryable: turn.retryable };
        return;
      case "malformed":
        yield { type: "text", text: turn.text };
        yield { type: "done", finishReason: "stop" };
        return;
    }
  }
}

/** Convenience: a single assistant text turn ending in a normal stop. */
export function textTurn(text: string): ScriptedTurn {
  return { kind: "deltas", deltas: [{ type: "text", text }, { type: "done", finishReason: "stop" }] };
}

/** Convenience: a single tool-call turn (native tool-calling shape). */
export function toolCallTurn(id: string, name: string, argsJson: string): ScriptedTurn {
  return {
    kind: "deltas",
    deltas: [
      { type: "tool_call_start", id, name },
      { type: "tool_call_delta", id, argsDelta: argsJson },
      { type: "tool_call_end", id },
      { type: "done", finishReason: "tool_use" }
    ]
  };
}
