import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { CapabilityProfile } from "./types.js";

/**
 * CapabilityProfile persistence (§4.9): "a `CapabilityProfile` written to
 * `~/.config/clutchcode/models/<id>.toml`. Re-runnable with `--force`."
 * One file per model id, so a repo-wide probe never touches per-repo state
 * (§19.2 draws the same config/state split the rest of the codebase uses).
 */

export function defaultModelsDir(): string {
  return path.join(os.homedir(), ".config", "clutchcode", "models");
}

/** Model ids can contain "/" (e.g. "openrouter/qwen-2.5-coder") — flatten to a safe filename. */
function safeFileName(modelId: string): string {
  const flattened = modelId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${flattened || "model"}.toml`;
}

export function capabilityProfilePath(modelId: string, modelsDir: string = defaultModelsDir()): string {
  return path.join(modelsDir, safeFileName(modelId));
}

export function saveCapabilityProfile(profile: CapabilityProfile, modelsDir: string = defaultModelsDir()): string {
  const p = capabilityProfilePath(profile.modelId, modelsDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, stringifyToml(profile as unknown as Record<string, unknown>), "utf8");
  return p;
}

export function loadCapabilityProfile(modelId: string, modelsDir: string = defaultModelsDir()): CapabilityProfile | null {
  const p = capabilityProfilePath(modelId, modelsDir);
  if (!fs.existsSync(p)) return null;
  return parseToml(fs.readFileSync(p, "utf8")) as unknown as CapabilityProfile;
}

export function listCapabilityProfiles(modelsDir: string = defaultModelsDir()): CapabilityProfile[] {
  if (!fs.existsSync(modelsDir)) return [];
  return fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith(".toml"))
    .map((f) => parseToml(fs.readFileSync(path.join(modelsDir, f), "utf8")) as unknown as CapabilityProfile)
    .sort((a, b) => a.modelId.localeCompare(b.modelId));
}
