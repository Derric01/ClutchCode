import { describe, expect, it } from "vitest";
import { buildConfinedSpawn, detectSandboxBackend } from "./tier1.js";

describe("detectSandboxBackend", () => {
  it("picks bwrap on linux when it's on PATH (true in this dev container)", () => {
    const cap = detectSandboxBackend("linux");
    expect(cap.backend).toBe("bwrap");
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
});
