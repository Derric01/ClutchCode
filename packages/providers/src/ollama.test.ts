import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { collect } from "./types.js";
import { OllamaProvider } from "./ollama.js";

describe("OllamaProvider", () => {
  let server: http.Server | undefined;
  let baseUrl = "";

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
  });

  function startServer(handler: http.RequestListener) {
    return new Promise<void>((resolve) => {
      server = http.createServer(handler);
      server.listen(0, "127.0.0.1", () => {
        const addr = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  it("chats through the OpenAI-compatible /v1 endpoint", async () => {
    await startServer((req, res) => {
      expect(req.url).toBe("/v1/chat/completions");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n');
      res.end("data: [DONE]\n\n");
    });

    const provider = new OllamaProvider({ baseUrl });
    const result = await collect(provider.chat({ model: "qwen2.5-coder:14b", messages: [] }));
    expect(result.text).toBe("hi");
  });

  it("lists local models via the native /api/tags endpoint", async () => {
    await startServer((req, res) => {
      expect(req.url).toBe("/api/tags");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:14b" }, { name: "llama3.1:8b" }] }));
    });

    const provider = new OllamaProvider({ baseUrl });
    const models = await provider.listLocalModels();
    expect(models).toEqual(["qwen2.5-coder:14b", "llama3.1:8b"]);
  });

  it("defaults to conservative local-model capability defaults (§4.1)", () => {
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    expect(provider.supportsNativeTools).toBe(false);
    expect(provider.supportsConstrainedDecode).toBe(true);
  });
});
