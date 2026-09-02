import { buildBwrapSpawn, detectBwrapUsable } from "./tier1-linux.js";
import { buildSeatbeltSpawn, detectSandboxExecOnPath } from "./tier1-macos.js";
import { detectSeccompSupport, type SeccompDetection } from "./seccomp-linux.js";

/**
 * Tier 1 OS sandbox dispatch (PROJECT_SPEC.md §12.5/§12.6): "Tier 1
 * (default where available): macOS → Seatbelt, Linux → bubblewrap
 * (+ seccomp on x86_64, Landlock not yet — see `seccomp-linux.ts`),
 * Windows → WSL2 recommended, else weak [C:Low]." `detectSandboxBackend`
 * decides which is actually available on this machine; `agent doctor`
 * (and this module's callers) surface `reason` when it isn't, rather than
 * silently running unconfined.
 */

export type SandboxBackend = "bwrap" | "seatbelt" | "none";

export interface SandboxCapability {
  backend: SandboxBackend;
  reason: string;
  /** Only meaningful when `backend === "bwrap"` — whether the seccomp-bpf hardening layer (§12.6) is available on this platform/arch. */
  seccomp?: SeccompDetection;
}

export function detectSandboxBackend(platform: NodeJS.Platform = process.platform): SandboxCapability {
  if (platform === "linux") {
    // Deliberately `detectBwrapUsable`, NOT `detectBwrapOnPath`: presence
    // on PATH does not imply the ability to confine. A host with bwrap
    // installed but namespace creation denied (CI runners, unprivileged
    // containers) used to be reported as `"bwrap"` here, after which
    // *every* command the agent ran was wrapped in a bwrap that exits 1
    // with no output — the agent silently unable to do anything, while
    // claiming to be sandboxed. Falling back to Tier 0 on such a host is
    // both honest and functional; `reason` says exactly what happened, and
    // `agent doctor` surfaces it.
    const probe = detectBwrapUsable();
    return probe.usable
      ? { backend: "bwrap", reason: probe.reason, seccomp: detectSeccompSupport(platform) }
      : { backend: "none", reason: `${probe.reason}; falling back to Tier 0 (policy engine only)` };
  }
  if (platform === "darwin") {
    return detectSandboxExecOnPath()
      ? { backend: "seatbelt", reason: "sandbox-exec found at /usr/bin/sandbox-exec" }
      : { backend: "none", reason: "/usr/bin/sandbox-exec not found — unexpected on macOS; falling back to Tier 0 (policy engine only)" };
  }
  return {
    backend: "none",
    reason: `Tier 1 isn't implemented for "${platform}" yet (§12.5) — WSL2 is the recommended path on Windows; falling back to Tier 0 (policy engine only)`
  };
}

export interface ConfinedSpawnOptions {
  workspaceRoot: string;
  cwd: string;
  command: string;
  /** Presented as `$HOME` inside the sandbox — never the real one. Ignored when `backend` is `"none"`. */
  homeDir: string;
  /** Layer the seccomp-bpf hardening filter (§12.6) under bwrap. Ignored for `"seatbelt"`/`"none"` backends — only meaningful when `backend === "bwrap"` and `detectSeccompSupport()` reports it available. */
  enableSeccomp?: boolean;
}

/** Builds the actual argv to spawn: wrapped under OS confinement for `"bwrap"`/`"seatbelt"`, or a plain `/bin/sh -c` passthrough for `"none"` (Tier 0 — the policy engine + env scrubbing still apply; only the OS-level fs/net/pid confinement is absent). */
export function buildConfinedSpawn(backend: SandboxBackend, opts: ConfinedSpawnOptions): { bin: string; args: string[] } {
  switch (backend) {
    case "bwrap":
      return buildBwrapSpawn(opts);
    case "seatbelt":
      return buildSeatbeltSpawn(opts);
    case "none":
      return { bin: "/bin/sh", args: ["-c", opts.command] };
    default: {
      const exhaustive: never = backend;
      throw new Error(`unknown sandbox backend: ${exhaustive as string}`);
    }
  }
}
