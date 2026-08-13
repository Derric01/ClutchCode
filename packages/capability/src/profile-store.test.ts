import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapabilityProfileStore } from "./profile-store.js";
import { unprobedProfile } from "./types.js";

describe("CapabilityProfileStore", () => {
  let configDir: string;
  let store: CapabilityProfileStore;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-capability-store-"));
    store = new CapabilityProfileStore(configDir);
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("returns null when no profile has been probed yet", () => {
    expect(store.load("openai-compatible", "gpt-4o-mini")).toBeNull();
  });

  it("round-trips a saved profile through TOML", () => {
    const profile = { ...unprobedProfile("ollama", "qwen2.5-coder:14b"), diffAcc: 0.82, probedAt: 12345, probeVersion: 1 };
    store.save(profile);

    const loaded = store.load("ollama", "qwen2.5-coder:14b");
    expect(loaded).toEqual(profile);
  });

  it("sanitizes provider/model ids into a safe filename", () => {
    const profile = unprobedProfile("openai-compatible", "org/model:tag");
    store.save(profile);
    const files = fs.readdirSync(path.join(configDir, "models"));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
  });
});
