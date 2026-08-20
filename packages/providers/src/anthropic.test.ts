import { afterEach, describe, expect, it } from "vitest";
import { collect } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { startMockSSEServer, type MockSSEServer } from "./test-helpers.js";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("AnthropicProvider", () => {
  let server: MockSSEServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("streams a text response", async () => {
    server = await startMockSSEServer([
      sse("message_start", { type: "message_start", message: { usage: { input_tokens: 12 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
      sse("message_stop", { type: "message_stop" })
    ]);
    const provider = new AnthropicProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });

    const result = await collect(provider.chat({ model: "claude-test", messages: [{ role: "user", content: "hi" }] }));

    expect(result.text).toBe("Hello");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, cachedTokens: undefined });
    expect(server.requests[0]!.path).toBe("/v1/messages");
    expect(JSON.parse(server.requests[0]!.body).max_tokens).toBeGreaterThan(0);
  });

  it("streams a tool_use response", async () => {
    server = await startMockSSEServer([
      sse("message_start", { type: "message_start", message: { usage: { input_tokens: 8 } } }),
      sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "read_file" }
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"path":' }
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"a.ts"}' }
      }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } }),
      sse("message_stop", { type: "message_stop" })
    ]);
    const provider = new AnthropicProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });

    const result = await collect(provider.chat({ model: "claude-test", messages: [] }));

    expect(result.finishReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "toolu_1", name: "read_file", argsJson: '{"path":"a.ts"}' }]);
  });

  it("maps a refusal stop_reason to an error finishReason instead of a plain stop (real bug caught in round 3 of security review)", async () => {
    server = await startMockSSEServer([
      sse("message_start", { type: "message_start", message: { usage: { input_tokens: 5 } } }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "refusal" }, usage: { output_tokens: 1 } })
    ]);
    const provider = new AnthropicProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });
    const result = await collect(provider.chat({ model: "claude-test", messages: [] }));
    expect(result.finishReason).toBe("error");
  });

  it("reports an in-stream overloaded_error as retryable, unlike a generic in-stream error (real bug caught in round 3 of security review — every in-stream error used to be hardcoded retryable: false, discarding the error's actual type)", async () => {
    let capturedRetryable: boolean | undefined;
    server = await startMockSSEServer([sse("error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } })]);
    const provider = new AnthropicProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });
    for await (const delta of provider.chat({ model: "claude-test", messages: [] })) {
      if (delta.type === "error") capturedRetryable = delta.retryable;
    }
    expect(capturedRetryable).toBe(true);
  });

  it("reports an error when the stream ends with no message_delta stop_reason (real bug caught in round 3 of security review — a bare connection drop, e.g. a proxy idle-timeout, used to be silently reported as a normal 'stop')", async () => {
    server = await startMockSSEServer([
      sse("message_start", { type: "message_start", message: { usage: { input_tokens: 5 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "cut off mid-" } })
    ]);
    const provider = new AnthropicProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });
    const result = await collect(provider.chat({ model: "claude-test", messages: [] }));
    expect(result.finishReason).toBe("error");
  });

  it("puts system messages in the top-level `system` field, not the messages array", async () => {
    server = await startMockSSEServer([
      sse("message_start", { type: "message_start", message: { usage: { input_tokens: 1 } } }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })
    ]);
    const provider = new AnthropicProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });

    await collect(
      provider.chat({
        model: "claude-test",
        messages: [
          { role: "system", content: "You are a coding agent." },
          { role: "user", content: "hi" }
        ]
      })
    );

    const sent = JSON.parse(server.requests[0]!.body);
    expect(sent.system).toBe("You are a coding agent.");
    expect(sent.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
