import { buildBwrapSpawn, detectBwrapOnPath } from "./tier1-linux.js";
import { buildSeatbeltSpawn, detectSandboxExecOnPath } from "./tier1-macos.js";

/**
 * Tier 1 OS sandbox dispatch (PROJECT_SPEC.md §12.5/§12.6): "Tier 1
 * (default where available): macOS → Seatbelt, Linux → bubblewrap
 * (+Landlock/seccomp, not yet layered in — see `tier1-linux.ts`),
 * Windows → WSL2 recommended, else weak [C:Low]." `detectSandboxBackend`
 * decides which is actually available on this machine; `agent doctor`
 * (and this module's callers) surface `reason` when it isn't, rather than
 * silently running unconfined.
 */

export type SandboxBackend = "bwrap" | "seatbelt" | "none";

export interface SandboxCapability {
  backend: SandboxBackend;
  reason: string;
}

export function detectSandboxBackend(platform: NodeJS.Platform = process.platform): SandboxCapability {
  if (platform === "linux") {
    return detectBwrapOnPath()
      ? { backend: "bwrap", reason: "bubblewrap found on PATH" }
      : { backend: "none", reason: "bubblewrap (bwrap) not found on PATH — install it for OS-level confinement (§12.5); falling back to Tier 0 (policy engine only)" };
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
