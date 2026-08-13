import { describe, expect, it } from "vitest";
import { OllamaProvider, OpenAICompatibleProvider } from "@clutchcode/providers";
import { defaultProfileFromProvider } from "./default-profile.js";

describe("defaultProfileFromProvider (§4.9 fallback for an unprobed model)", () => {
  it("defaults an Ollama model to emulation transport (declared supportsNativeTools: false)", () => {
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    const profile = defaultProfileFromProvider(provider, "qwen2.5-coder:14b");
    expect(profile.toolTransport).toBe("emulation");
    expect(profile.effectiveContext).toBe(provider.capabilityDefaults.approxEffectiveContext);
  });

  it("defaults an OpenAI-compatible model to native transport (declared supportsNativeTools: true)", () => {
    const provider = new OpenAICompatibleProvider({ baseUrl: "http://localhost:9999/v1" });
    const profile = defaultProfileFromProvider(provider, "gpt-test");
    expect(profile.toolTransport).toBe("native");
  });
});
