import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildBwrapSpawn, detectBwrapOnPath } from "./tier1-linux.js";
import { DENIED_SYSCALLS_X86_64, buildSeccompFilterX86_64, detectSeccompSupport, ensureSeccompFilterFile } from "./seccomp-linux.js";

describe("detectSeccompSupport", () => {
  it("reports supported on linux/x64 — this dev container", () => {
    expect(detectSeccompSupport("linux", "x64")).toEqual({ supported: true, reason: "x86_64 seccomp-bpf filter available" });
  });

  it("reports unsupported on a non-Linux platform", () => {
    expect(detectSeccompSupport("darwin", "x64").supported).toBe(false);
  });

  it("reports unsupported on a non-x64 arch, honestly (not guessed)", () => {
    const result = detectSeccompSupport("linux", "arm64");
    expect(result.supported).toBe(false);
    expect(result.reason).toContain("arm64");
    expect(result.reason).toContain("not yet supported");
  });
});

describe("buildSeccompFilterX86_64", () => {
  it("produces a buffer sized as a whole number of 8-byte sock_filter instructions", () => {
    const filter = buildSeccompFilterX86_64();
    expect(filter.length % 8).toBe(0);
    // 3 fixed instructions (load arch, arch check, load nr) + one check per denied syscall + 2 returns.
    const expectedInstructions = 3 + Object.keys(DENIED_SYSCALLS_X86_64).length + 2;
    expect(filter.length).toBe(expectedInstructions * 8);
  });

  it("is fully deterministic — same bytes every call", () => {
    expect(buildSeccompFilterX86_64().equals(buildSeccompFilterX86_64())).toBe(true);
  });
});

describe("ensureSeccompFilterFile", () => {
  it("writes the filter once and leaves a byte-identical file alone on a second call", () => {
    const filterPath = ensureSeccompFilterFile();
    expect(filterPath).toBeDefined();
    const firstMtime = fs.statSync(filterPath!).mtimeMs;
    const secondPath = ensureSeccompFilterFile();
    expect(secondPath).toBe(filterPath);
    expect(fs.statSync(filterPath!).mtimeMs).toBe(firstMtime); // not rewritten — content was already correct
    expect(fs.readFileSync(filterPath!).equals(buildSeccompFilterX86_64())).toBe(true);
  });
});

/**
 * Real, running kernel enforcement — not mocked. Spawns the actual
 * `bwrap` binary with the compiled filter loaded via `--seccomp 3`
 * (exactly the mechanism `shell.ts` uses in production) and, from
 * *inside* the sandbox, invokes raw syscalls by number via Python's
 * `ctypes` (the standard library's generic FFI, present in any Linux
 * dev/CI Python — used here purely as a precise raw-syscall probe, the
 * same role `bwrap` itself plays for the namespace-confinement tests;
 * neither is a runtime dependency of the feature itself, only of proving
 * it). Skips itself if `bwrap` or a `python3` genuinely aren't on PATH,
 * rather than faking success — same convention as `tier1-linux.test.ts`.
 */
function detectPython3OnPath(): boolean {
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(`${dir}/python3`));
}

const canRunRealTest = detectBwrapOnPath() && detectPython3OnPath() && detectSeccompSupport().supported;
const maybeIt = canRunRealTest ? it : it.skip;

describe("seccomp filter under real bwrap — actual kernel enforcement, not mocked", () => {
  /** Runs `command` under a real bwrap sandbox, with the compiled filter wired to fd 3 when `withSeccomp` is true — the exact mechanism `shell.ts` uses in production. */
  function runInSandbox(command: string, withSeccomp: boolean): { stdout: string; exitCode: number } {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-seccomp-ws-"));
    const filterFd = withSeccomp ? fs.openSync(ensureSeccompFilterFile()!, "r") : undefined;
    try {
      const { bin, args } = buildBwrapSpawn({ workspaceRoot, cwd: workspaceRoot, command, homeDir: "/home/clutchcode-seccomp-test", enableSeccomp: withSeccomp });
      try {
        const out = execFileSync(bin, args, { encoding: "utf8", stdio: filterFd === undefined ? "pipe" : ["ignore", "pipe", "pipe", filterFd] });
        return { stdout: out, exitCode: 0 };
      } catch (e) {
        const err = e as { stdout?: string; status?: number };
        return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
      }
    } finally {
      if (filterFd !== undefined) fs.closeSync(filterFd);
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }

  function pythonSyscallProbe(nr: number, argCount: number): string {
    const zeros = Array.from({ length: argCount }, () => "0").join(", ");
    return `python3 -c "import ctypes; libc=ctypes.CDLL(None, use_errno=True); r=libc.syscall(${nr}${zeros ? ", " + zeros : ""}); print(r, ctypes.get_errno())"`;
  }

  maybeIt("ptrace is blocked with EPERM inside the sandbox", () => {
    const { stdout } = runInSandbox(pythonSyscallProbe(101, 4), true);
    expect(stdout.trim()).toBe("-1 1"); // -1 return, errno 1 = EPERM
  });

  maybeIt("mount is blocked with EPERM inside the sandbox", () => {
    const { stdout } = runInSandbox(pythonSyscallProbe(165, 5), true);
    expect(stdout.trim()).toBe("-1 1");
  });

  maybeIt("bpf is blocked with EPERM inside the sandbox", () => {
    const { stdout } = runInSandbox(pythonSyscallProbe(321, 3), true);
    expect(stdout.trim()).toBe("-1 1");
  });

  maybeIt("unshare is blocked with EPERM inside the sandbox", () => {
    const { stdout } = runInSandbox(pythonSyscallProbe(272, 1), true);
    expect(stdout.trim()).toBe("-1 1");
  });

  maybeIt("a syscall NOT on the deny list (getpid) still works normally under the filter", () => {
    const { stdout } = runInSandbox('python3 -c "import ctypes; libc=ctypes.CDLL(None, use_errno=True); print(libc.syscall(39) > 0)"', true);
    expect(stdout.trim()).toBe("True");
  });

  maybeIt("without the filter, ptrace succeeds — proves the block above is the filter, not something else", () => {
    const { stdout, exitCode } = runInSandbox(pythonSyscallProbe(101, 4), false);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("0 0"); // PTRACE_TRACEME on self succeeds when unfiltered
  });

  maybeIt("ordinary shell usage still works fine under the filter", () => {
    const { stdout, exitCode } = runInSandbox("echo hello-from-sandbox", true);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("hello-from-sandbox");
  });
});
