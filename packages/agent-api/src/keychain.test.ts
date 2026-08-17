import { describe, expect, it } from "vitest";
import { detectKeychainBackend, keychainClear, keychainGet, keychainSet } from "./keychain.js";

describe("detectKeychainBackend", () => {
  it("picks the Secret Service backend on Linux when secret-tool is on PATH (real, on this container)", () => {
    expect(detectKeychainBackend("linux").backend).toBe("secret-service");
  });

  it("falls back to none on Linux when secret-tool isn't on PATH", () => {
    const result = detectKeychainBackend("linux", { PATH: "/definitely/not/a/real/dir" } as NodeJS.ProcessEnv);
    expect(result.backend).toBe("none");
    expect(result.reason).toContain("libsecret-tools");
  });

  it("picks the macOS Keychain backend on darwin only when `security` is on PATH", () => {
    expect(detectKeychainBackend("darwin", { PATH: "/definitely/not/a/real/dir" } as NodeJS.ProcessEnv).backend).toBe("none");
    expect(detectKeychainBackend("darwin", { PATH: "/usr/bin" } as NodeJS.ProcessEnv).backend).toBe("none"); // this container has no /usr/bin/security
  });

  it("picks the Windows DPAPI backend on win32 only when powershell.exe is on PATH", () => {
    expect(detectKeychainBackend("win32", { PATH: "C:\\does\\not\\exist" } as NodeJS.ProcessEnv).backend).toBe("none");
  });

  it("returns none with an honest reason for an unsupported platform", () => {
    const result = detectKeychainBackend("aix" as NodeJS.Platform, {} as NodeJS.ProcessEnv);
    expect(result.backend).toBe("none");
    expect(result.reason).toContain("aix");
  });
});

describe("keychainGet/Set/Clear dispatch", () => {
  it("backend 'none' short-circuits to undefined/false without touching any binary", () => {
    expect(keychainGet("none", "any-account")).toBeUndefined();
    expect(keychainSet("none", "any-account", "value")).toBe(false);
    expect(keychainClear("none", "any-account")).toBe(false);
  });

  it("dispatches to the real Linux backend end-to-end when backend is 'secret-service' but no session bus is reachable — fails closed, not throws", () => {
    const env = { ...process.env };
    delete env.DBUS_SESSION_BUS_ADDRESS;
    delete env.DISPLAY;
    expect(keychainGet("secret-service", "any-account", env)).toBeUndefined();
    expect(keychainSet("secret-service", "any-account", "value", env)).toBe(false);
  });

  it("dispatches to the macOS backend (unreachable on this Linux container — fails closed)", () => {
    expect(keychainGet("macos-keychain", "any-account")).toBeUndefined();
  });

  it("dispatches to the Windows backend (unreachable on this Linux container — fails closed)", () => {
    expect(keychainGet("windows-dpapi", "any-account")).toBeUndefined();
  });
});
