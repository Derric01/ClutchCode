import fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Windows Tier 1 keychain (PROJECT_SPEC.md §5.1): DPAPI-encrypted-at-rest
 * storage via PowerShell (`ConvertTo-SecureString` / `ConvertFrom-SecureString`,
 * backed by `CryptProtectData` under the hood — the same primitive Windows
 * Credential Manager itself is built on). We deliberately don't script
 * Credential Manager via `cmdkey` — `cmdkey` can *write* a generic
 * credential but has no supported way to *read the password back*
 * (`cmdkey /list` never reveals it; that needs the Win32 `CredRead` API,
 * i.e. a native helper), so claiming a `cmdkey`-based round trip would be
 * incorrect, not just unverified. DPAPI via PowerShell is the realistic
 * scriptable equivalent without a native binding: a ciphertext blob tied
 * to the current Windows user account, stored under
 * `%APPDATA%\clutchcode\credentials\<account>.dat`.
 *
 * Written against documented, long-stable PowerShell/DPAPI cmdlets but
 * **not runtime-verified** — no Windows host exists in this environment.
 * Same honesty flag as `tier1-macos.ts` and `keychain-macos.ts`.
 *
 * Script construction is split into pure `build*Script` functions — same
 * pattern as the macOS backend's `build*Args` — so the exact PowerShell
 * text is directly assertable in tests without a real Windows host. The
 * secret value crosses the process boundary via an environment variable,
 * never a command-line argument (unlike the macOS `security` CLI, which
 * has no better option) — env vars aren't visible in a process listing
 * the way argv is.
 */

const TIMEOUT_MS = 5000;
const ACCOUNT_ENV_VAR = "CLUTCHCODE_ACCOUNT";
const SECRET_ENV_VAR = "CLUTCHCODE_SECRET_VALUE";

const RESOLVE_PATH = `$dir = Join-Path $env:APPDATA 'clutchcode\\credentials'; $path = Join-Path $dir ($env:${ACCOUNT_ENV_VAR} + '.dat')`;

export interface PowerShellInvocation {
  bin: string;
  args: string[];
}

export function detectPowerShellOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const pathDirs = (env.PATH ?? "").split(";").filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(`${dir}\\powershell.exe`) || fs.existsSync(`${dir}/powershell.exe`));
}

export function buildDpapiGetScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    RESOLVE_PATH,
    "if (-not (Test-Path $path)) { exit 1 }",
    "$enc = Get-Content -Path $path -Raw",
    "$secure = ConvertTo-SecureString -String $enc",
    "$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "[System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)"
  ].join("\n");
}

export function buildDpapiSetScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    RESOLVE_PATH,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    `$secure = ConvertTo-SecureString -String $env:${SECRET_ENV_VAR} -AsPlainText -Force`,
    "$enc = ConvertFrom-SecureString -SecureString $secure",
    "Set-Content -Path $path -Value $enc -NoNewline"
  ].join("\n");
}

export function buildDpapiClearScript(): string {
  return ["$ErrorActionPreference = 'Stop'", RESOLVE_PATH, "if (Test-Path $path) { Remove-Item -Path $path -Force }"].join("\n");
}

function powerShellInvocation(script: string): PowerShellInvocation {
  return { bin: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
}

function runPowerShell(script: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    const { bin, args } = powerShellInvocation(script);
    // "not found"/missing binary is a routine, expected outcome — its
    // stderr text must never leak into the agent's own logs/terminal.
    return execFileSync(bin, args, { encoding: "utf8", env, timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

export function dpapiGet(account: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const out = runPowerShell(buildDpapiGetScript(), { ...env, [ACCOUNT_ENV_VAR]: account });
  if (out === undefined) return undefined;
  const value = out.replace(/\r?\n$/, "");
  return value.length > 0 ? value : undefined;
}

export function dpapiSet(account: string, value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return runPowerShell(buildDpapiSetScript(), { ...env, [ACCOUNT_ENV_VAR]: account, [SECRET_ENV_VAR]: value }) !== undefined;
}

export function dpapiClear(account: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return runPowerShell(buildDpapiClearScript(), { ...env, [ACCOUNT_ENV_VAR]: account }) !== undefined;
}
