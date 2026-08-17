import { describe, expect, it } from "vitest";
import { buildDpapiClearScript, buildDpapiGetScript, buildDpapiSetScript, detectPowerShellOnPath, dpapiGet } from "./keychain-windows.js";

/**
 * Written-to-spec, not runtime-verified (see `keychain-windows.ts`'s
 * header comment — no Windows host exists in this environment). What
 * *can* be checked without a real `powershell.exe`: the generated script
 * text references the documented DPAPI cmdlets correctly and never
 * embeds the secret value directly (it crosses via an env var instead),
 * and a missing binary is reported as "not available", never a thrown
 * error.
 */

describe("detectPowerShellOnPath", () => {
  it("is false on this (Linux) test environment — there's no powershell.exe here", () => {
    expect(detectPowerShellOnPath()).toBe(false);
  });

  it("returns false for a PATH with no matching binary", () => {
    expect(detectPowerShellOnPath({ PATH: "/does/not/exist" })).toBe(false);
  });
});

describe("buildDpapiGetScript", () => {
  it("resolves the account-scoped path under %APPDATA%\\clutchcode\\credentials and decrypts via DPAPI", () => {
    const script = buildDpapiGetScript();
    expect(script).toContain("$env:APPDATA");
    expect(script).toContain("clutchcode\\credentials");
    expect(script).toContain("$env:CLUTCHCODE_ACCOUNT");
    expect(script).toContain("ConvertTo-SecureString -String $enc");
    expect(script).toContain("SecureStringToBSTR");
    expect(script).toContain("if (-not (Test-Path $path)) { exit 1 }");
  });
});

describe("buildDpapiSetScript", () => {
  it("encrypts via DPAPI (CurrentUser scope, no explicit key) and writes to the resolved path", () => {
    const script = buildDpapiSetScript();
    expect(script).toContain("New-Item -ItemType Directory -Force -Path $dir");
    expect(script).toContain("ConvertTo-SecureString -String $env:CLUTCHCODE_SECRET_VALUE -AsPlainText -Force");
    expect(script).toContain("ConvertFrom-SecureString -SecureString $secure");
    expect(script).toContain("Set-Content -Path $path");
    // The function takes no `value` parameter at all — the secret can only
    // ever cross via the $env:CLUTCHCODE_SECRET_VALUE reference below, never
    // a literal embedded in the script text.
    expect(script).toContain("$env:CLUTCHCODE_SECRET_VALUE -AsPlainText -Force");
  });
});

describe("buildDpapiClearScript", () => {
  it("removes the file at the resolved path if present", () => {
    const script = buildDpapiClearScript();
    expect(script).toContain("if (Test-Path $path) { Remove-Item -Path $path -Force }");
  });
});

describe("dpapiGet on a host with no powershell.exe", () => {
  it("returns undefined instead of throwing (this Linux container has no PowerShell)", () => {
    expect(dpapiGet("anything")).toBeUndefined();
  });
});
