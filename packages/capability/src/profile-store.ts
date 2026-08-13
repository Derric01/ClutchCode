import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { CapabilityProfile } from "./types.js";

/**
 * `~/.config/clutchcode/models/<id>.toml` (§4.9): "probe once, store
 * profile, drive adaptation." Persisted per model so it's not re-run
 * every session.
 */
export class CapabilityProfileStore {
  constructor(private readonly configDir: string) {}

  private fileNameFor(providerId: string, modelId: string): string {
    const safe = `${providerId}__${modelId}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
    return path.join(this.configDir, "models", `${safe}.toml`);
  }

  save(profile: CapabilityProfile): void {
    const p = this.fileNameFor(profile.providerId, profile.modelId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, stringifyToml(profile as unknown as Record<string, unknown>), "utf8");
  }

  load(providerId: string, modelId: string): CapabilityProfile | null {
    const p = this.fileNameFor(providerId, modelId);
    if (!fs.existsSync(p)) return null;
    return parseToml(fs.readFileSync(p, "utf8")) as unknown as CapabilityProfile;
  }
}
