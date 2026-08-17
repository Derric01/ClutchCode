import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectSecretToolOnPath, secretToolClear, secretToolGet, secretToolSet } from "./keychain-linux.js";
import { startThrowawaySecretService, type ThrowawaySecretService } from "./test-helpers.js";

describe("detectSecretToolOnPath", () => {
  it("finds a real binary on PATH (this repo's dev container has libsecret-tools installed)", () => {
    // Not mocked deliberately: a false positive here would mean the real
    // Secret Service suite below silently skips instead of proving
    // anything, same reasoning as tier1-linux.test.ts's bwrap check.
    expect(detectSecretToolOnPath()).toBe(true);
  });

  it("returns false when PATH has no secret-tool", () => {
    expect(detectSecretToolOnPath({ PATH: "/definitely/not/a/real/dir" })).toBe(false);
  });
});

/** A real, running freedesktop Secret Service — not mocked. See `startThrowawaySecretService`'s doc comment for the mechanism. */
const hasSecretTool = detectSecretToolOnPath();
const maybeIt = hasSecretTool ? it : it.skip;

describe("secret-tool get/set/clear — real Secret Service, not mocked", () => {
  let service: ThrowawaySecretService;

  beforeAll(() => {
    if (hasSecretTool) service = startThrowawaySecretService();
  });

  afterAll(() => {
    service?.close();
  });

  maybeIt("stores and retrieves a secret through the real Secret Service", () => {
    expect(secretToolSet("anthropic-api-key", "sk-ant-integration-test-value", service.env)).toBe(true);
    expect(secretToolGet("anthropic-api-key", service.env)).toBe("sk-ant-integration-test-value");
  });

  maybeIt("returns undefined for an account that was never stored", () => {
    expect(secretToolGet("never-stored-account", service.env)).toBeUndefined();
  });

  maybeIt("clear removes the secret; a lookup afterward returns undefined", () => {
    expect(secretToolSet("to-be-cleared", "temp-value", service.env)).toBe(true);
    expect(secretToolGet("to-be-cleared", service.env)).toBe("temp-value");
    expect(secretToolClear("to-be-cleared", service.env)).toBe(true);
    expect(secretToolGet("to-be-cleared", service.env)).toBeUndefined();
  });

  maybeIt("a second store for the same account overwrites the first", () => {
    expect(secretToolSet("overwrite-account", "first-value", service.env)).toBe(true);
    expect(secretToolSet("overwrite-account", "second-value", service.env)).toBe(true);
    expect(secretToolGet("overwrite-account", service.env)).toBe("second-value");
  });
});

describe("secret-tool get/set/clear — no Secret Service reachable", () => {
  it("get fails fast and returns undefined, never hangs or throws", () => {
    const noSessionEnv = { ...process.env };
    delete noSessionEnv.DBUS_SESSION_BUS_ADDRESS;
    delete noSessionEnv.DISPLAY;
    const start = Date.now();
    expect(secretToolGet("anything", noSessionEnv)).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("set fails cleanly and returns false", () => {
    const noSessionEnv = { ...process.env };
    delete noSessionEnv.DBUS_SESSION_BUS_ADDRESS;
    delete noSessionEnv.DISPLAY;
    expect(secretToolSet("anything", "value", noSessionEnv)).toBe(false);
  });
});
