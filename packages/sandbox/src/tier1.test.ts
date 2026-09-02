import { describe, expect, it } from "vitest";
import { buildConfinedSpawn, detectSandboxBackend } from "./tier1.js";
import { detectBwrapUsable } from "./tier1-linux.js";

describe("detectSandboxBackend", () => {
  it("picks bwrap on linux exactly when bwrap can actually confine — never a backend the host can't provide", () => {
    // This used to assert `backend === "bwrap"` outright, which only held
    // because detection was presence-based and therefore wrong: on a host
    // with bwrap installed but namespaces denied it claimed "bwrap" and
    // every sandboxed command then failed. Now that detection is honest,
    // the invariant worth asserting is that the dispatcher agrees with the
    // capability probe on whichever host is running the suite.
    const probe = detectBwrapUsable();
    const cap = detectSandboxBackend("linux");
    if (probe.usable) {
      expect(cap.backend).toBe("bwrap");
      if (process.arch === "x64") expect(cap.seccomp?.supported).toBe(true);
    } else {
      expect(cap.backend).toBe("none");
      expect(cap.reason).toMatch(/bubblewrap/);
      expect(cap.reason).toMatch(/Tier 0/);
    }
  });

  it("does not report seccomp for non-bwrap backends", () => {
    expect(detectSandboxBackend("darwin").seccomp).toBeUndefined();
    expect(detectSandboxBackend("win32").seccomp).toBeUndefined();
  });

  it("falls back to none on darwin when sandbox-exec isn't found (true in this Linux test environment)", () => {
    const cap = detectSandboxBackend("darwin");
    expect(cap.backend).toBe("none");
    expect(cap.reason).toMatch(/sandbox-exec/);
  });

  it("falls back to none with a clear reason on an unimplemented platform", () => {
    const cap = detectSandboxBackend("win32");
    expect(cap.backend).toBe("none");
    expect(cap.reason).toMatch(/win32/);
    expect(cap.reason).toMatch(/WSL2/);
  });
});

describe("buildConfinedSpawn", () => {
  const opts = { workspaceRoot: "/ws", cwd: "/ws", command: "echo hi", homeDir: "/tmp/home" };

  it("dispatches to bwrap", () => {
    expect(buildConfinedSpawn("bwrap", opts).bin).toBe("bwrap");
  });

  it("dispatches to sandbox-exec", () => {
    expect(buildConfinedSpawn("seatbelt", opts).bin).toBe("sandbox-exec");
  });

  it("falls back to a plain /bin/sh -c passthrough for 'none' (Tier 0 — policy engine + env scrub still apply upstream)", () => {
    expect(buildConfinedSpawn("none", opts)).toEqual({ bin: "/bin/sh", args: ["-c", "echo hi"] });
  });

  it("threads enableSeccomp through to bwrap's argv (§12.6)", () => {
    expect(buildConfinedSpawn("bwrap", opts).args).not.toContain("--seccomp");
    expect(buildConfinedSpawn("bwrap", { ...opts, enableSeccomp: true }).args).toContain("--seccomp");
  });
});
