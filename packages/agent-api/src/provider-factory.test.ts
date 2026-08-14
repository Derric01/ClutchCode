import { describe, expect, it } from "vitest";
import { buildProvider } from "./provider-factory.js";

describe("buildProvider", () => {
  it("builds each Phase 1 provider kind with the expected id", () => {
    expect(buildProvider({ kind: "anthropic", credentials: {} }).id).toBe("anthropic");
    expect(buildProvider({ kind: "openai-compatible", credentials: {} }).id).toBe("openai-compatible");
    expect(buildProvider({ kind: "ollama", credentials: {} }).id).toBe("ollama");
    expect(buildProvider({ kind: "fake", credentials: {} }).id).toBe("fake");
  });

  it("prefers an explicit baseUrl over a credentials-sourced one for openai-compatible", () => {
    const p = buildProvider({ kind: "openai-compatible", baseUrl: "http://explicit", credentials: { openaiBaseUrl: "http://from-env" } });
    expect(p.id).toBe("openai-compatible");
  });
});
