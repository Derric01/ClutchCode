import {
  capabilityProfilePath,
  defaultModelsDir,
  listCapabilityProfiles,
  loadCapabilityProfile,
  runCapabilityProbe,
  saveCapabilityProfile,
  type CapabilityProfile
} from "@clutchcode/capability";
import { FakeProvider, textTurn, type Provider } from "@clutchcode/providers";
import { loadCredentialsFromEnv } from "./credentials.js";
import { buildProvider, type ProviderKind } from "./provider-factory.js";

/**
 * `agent models probe` / `agent models list` (§4.9, §18.2) — the Agent API
 * binding over @clutchcode/capability, so apps/* never depend on it
 * directly (§20 boundary rule).
 */

export interface ProbeModelOptions {
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  /** Re-run even if a cached profile already exists (§4.9: "Re-runnable with --force"). */
  force?: boolean;
  /** Trials per scored check; forwarded to the probe. */
  trials?: number;
  /** Override the profile storage directory (default: ~/.config/clutchcode/models). */
  modelsDir?: string;
}

export interface ProbeModelResult {
  profile: CapabilityProfile;
  /** True if an existing profile was returned unprobed (no `force`). */
  cached: boolean;
  path: string;
}

/**
 * `buildProvider`'s "fake" case is a deliberate single-turn no-op (it only
 * has to survive one dry-run agent step); the probe issues many requests
 * per run (several trials x several checks). Give "fake" its own
 * generously-scripted, always-benign provider here rather than lengthening
 * the shared dry-run stub — that stub's *exact* one-turn shape is itself
 * asserted elsewhere (a normal `agent run --provider fake` finishing after
 * one no-op turn).
 */
function buildProbeProvider(opts: ProbeModelOptions): Provider {
  if (opts.providerKind === "fake") {
    const turn = textTurn("(fake provider: no real model configured)");
    return new FakeProvider(
      Array.from({ length: 64 }, () => turn),
      { id: "fake" }
    );
  }
  const credentials = loadCredentialsFromEnv();
  return buildProvider({ kind: opts.providerKind, baseUrl: opts.baseUrl, credentials });
}

export async function probeModel(opts: ProbeModelOptions): Promise<ProbeModelResult> {
  const modelsDir = opts.modelsDir ?? defaultModelsDir();
  const path = capabilityProfilePath(opts.model, modelsDir);

  if (!opts.force) {
    const existing = loadCapabilityProfile(opts.model, modelsDir);
    if (existing) return { profile: existing, cached: true, path };
  }

  const provider = buildProbeProvider(opts);
  const profile = await runCapabilityProbe(provider, opts.model, { trials: opts.trials });
  saveCapabilityProfile(profile, modelsDir);
  return { profile, cached: false, path };
}

export function listModelProfiles(modelsDir?: string): CapabilityProfile[] {
  return listCapabilityProfiles(modelsDir ?? defaultModelsDir());
}
