import type { Provider } from "@clutchcode/providers";
import { UNPROBED_PROFILE, type CapabilityProfile } from "./types.js";

/**
 * A profile for a model that has never been probed (§4.9: "fall back to
 * static defaults if probe fails"), built from the provider adapter's own
 * declared `capabilityDefaults` rather than blindly assuming the most
 * conservative case — e.g. Ollama declares `supportsNativeTools: false` so
 * an unprobed Ollama model correctly defaults to text-protocol emulation,
 * while an unprobed OpenAI-compatible/Anthropic model defaults to native.
 */
export function defaultProfileFromProvider(provider: Provider, model: string): CapabilityProfile {
  return {
    ...UNPROBED_PROFILE,
    providerId: provider.id,
    modelId: model,
    toolTransport: provider.capabilityDefaults.supportsNativeTools ? "native" : "emulation",
    effectiveContext: provider.capabilityDefaults.approxEffectiveContext,
    supportsConstrainedDecode: provider.capabilityDefaults.supportsConstrainedDecode
  };
}
