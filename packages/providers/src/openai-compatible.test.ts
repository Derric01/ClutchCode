import { afterEach, describe, expect, it } from "vitest";
import { collect } from "./types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { startMockSSEServer, type MockSSEServer } from "./test-helpers.js";

describe("OpenAICompatibleProvider", () => {
  let server: MockSSEServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("streams text deltas and final usage", async () => {
    server = await startMockSSEServer([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n"
    ]);
    const provider = new OpenAICompatibleProvider({ baseUrl: server.baseUrl, apiKey: "test-key" });

    const result = await collect(provider.chat({ model: "gpt-test", messages: [{ role: "user", content: "hi" }] }));

    expect(result.text).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2, cachedTokens: undefined });
    expect(server.requests[0]!.path).toBe("/chat/completions");
    expect(JSON.parse(server.requests[0]!.body).model).toBe("gpt-test");
  });

  it("reassembles a streamed tool call", async () => {
    server = await startMockSSEServer([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      "data: [DONE]\n\n"
    ]);
    const provider = new OpenAICompatibleProvider({ baseUrl: server.baseUrl });

    const result = await collect(provider.chat({ model: "gpt-test", messages: [] }));

    expect(result.finishReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "call_abc", name: "read_file", argsJson: '{"path":"a.ts"}' }]);
  });

  it("surfaces a non-2xx response as a retryable error for 5xx", async () => {
    const http = await import("node:http");
    const errServer = http.createServer((_req, res) => {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("service unavailable");
    });
    await new Promise<void>((resolve) => errServer.listen(0, "127.0.0.1", resolve));
    const addr = errServer.address() as import("node:net").AddressInfo;

    const provider = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const result = await collect(provider.chat({ model: "gpt-test", messages: [] }));
    expect(result.finishReason).toBe("error");

    await new Promise<void>((resolve) => errServer.close(() => resolve()));
  });
});
