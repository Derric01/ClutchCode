import fs from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Linux Tier 1 (PROJECT_SPEC.md §12.5/§12.6): bubblewrap (bwrap) namespace
 * confinement. Verified against a real `bwrap` binary (not just written to
 * spec) — see `tier1-linux.test.ts`, which skips itself when bwrap
 * genuinely cannot confine on this host (`detectBwrapUsable`, below)
 * rather than faking success.
 *
 * Scope, stated plainly: this unshares mount/pid/ipc/uts/net/cgroup
 * namespaces and confines the filesystem view, which is where the real
 * confinement value is (§12.1 "Credential theft", "Destructive shell").
 * It deliberately does *not* unshare the user namespace (`--unshare-user`)
 * — that needs either a setuid `bwrap` or unprivileged-userns-clone
 * enabled on the host, neither of which this package can assume, and the
 * fs/net/pid isolation below doesn't depend on it.
 *
 * §12.6's "Landlock + seccomp, layered under bwrap where available" is
 * half-done: a seccomp-bpf filter is layered in via `--seccomp FD` (see
 * `seccomp-linux.ts` for the filter itself, its x86_64-only scope, and
 * why Landlock specifically is not attempted this pass) when the caller
 * passes `seccompFd`. Building/opening that fd is the caller's job (real
 * file I/O), not this pure argv-builder's — see `shell.ts` for the actual
 * wiring.
 */

/** Standard userland dirs bound read-only when present — enough for typical shell/npm/git/python invocations; anything living outside these + the workspace (e.g. a tool installed under `$HOME`) won't be visible, by design (§12.3: we don't expose the real `$HOME`). */
const READONLY_SYSTEM_DIRS = ["/usr", "/bin", "/lib", "/lib64", "/etc", "/opt"];

/**
 * The namespace flags that *are* the confinement (§12.6). Shared verbatim
 * between the real spawn and the capability probe below, deliberately: a
 * probe that unshares less than the real thing can pass on a host where
 * the real thing fails, which is precisely the failure this whole probe
 * exists to prevent. `--unshare-net` in particular is the one that fails
 * on a GitHub Actions runner.
 */
const NAMESPACE_FLAGS = ["--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-net", "--unshare-cgroup"];

export interface BwrapSpawnOptions {
  workspaceRoot: string;
  cwd: string;
  command: string;
  /**
   * The path presented as `$HOME` inside the sandbox — created fresh and
   * empty by `--dir` (bwrap's own in-namespace tmpfs directory), never
   * bound from the real host (§12.1/§12.3: credential theft via
   * `~/.ssh`, `~/.aws`, etc.). Just a path string; nothing needs to exist
   * on the real host filesystem at this path.
   */
  homeDir: string;
  /**
   * Layer a seccomp-bpf filter under the namespace confinement (§12.6).
   * This builder never touches the filesystem — it only decides whether
   * to emit `--seccomp 3`; the caller is responsible for actually opening
   * the compiled filter (`seccomp-linux.ts`'s `ensureSeccompFilterFile`)
   * and placing it at stdio index 3 so it lands on fd 3 in the child.
   */
  enableSeccomp?: boolean;
}

/**
 * Cheap presence check: is there a file called `bwrap` anywhere on PATH?
 *
 * **This does not mean bwrap can confine anything** — see
 * `detectBwrapUsable`, which is what every capability decision should use.
 * Kept as its own exported function because "is it installed at all?" is
 * still the right question for an install-it-first diagnostic message.
 */
export function detectBwrapOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const pathDirs = (env.PATH ?? "").split(":").filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(`${dir}/bwrap`));
}

export interface BwrapProbe {
  /** bwrap is installed **and** actually created the namespaces on this host. */
  usable: boolean;
  reason: string;
}

const BWRAP_PROBE_TIMEOUT_MS = 5_000;
let probeCache: { pathKey: string; result: BwrapProbe } | null = null;

/**
 * The argv for the capability probe: the same read-only binds and the same
 * namespace flags a real confined spawn uses, running `/bin/true` instead
 * of a user command. Exported so it can be asserted directly, like every
 * other argv-builder in this package.
 */
export function buildBwrapProbeArgs(): string[] {
  const args: string[] = [];
  for (const dir of READONLY_SYSTEM_DIRS) {
    if (fs.existsSync(dir)) args.push("--ro-bind", dir, dir);
  }
  args.push("--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", ...NAMESPACE_FLAGS, "--die-with-parent");
  args.push("/bin/true");
  return args;
}

/**
 * Does bwrap actually *work* on this host — not "is the binary present"?
 *
 * Real bug this exists for, reproduced end to end before it was fixed
 * (and the cause of every CI run on this repo being red since CI was
 * added): `detectSandboxBackend` used to answer "is there a file named
 * bwrap on PATH", and on a host where bwrap is installed but cannot create
 * namespaces — a GitHub Actions runner, an unprivileged container, a
 * kernel with unprivileged user namespaces disabled — it confidently
 * reported `backend: "bwrap", reason: "bubblewrap found on PATH"`. Every
 * shell command the agent then ran was wrapped in bwrap and died with
 * `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, exit 1,
 * no output. The agent was completely unable to run *any* command while
 * reporting itself sandboxed.
 *
 * This is the same class as the `detectKeychainBackend` gotcha already in
 * `HANDOFF.md` ("reports a backend based on PATH alone, not actual
 * reachability"), so it is fixed the same way: actually run the thing and
 * check its exit status.
 *
 * The result is cached per PATH value — the probe forks a process, and
 * this is called from `detectSandboxBackend` on every run and from several
 * test guards.
 */
export function detectBwrapUsable(env: NodeJS.ProcessEnv = process.env): BwrapProbe {
  const pathKey = env.PATH ?? "";
  if (probeCache && probeCache.pathKey === pathKey) return probeCache.result;
  const result = probeBwrap(env);
  probeCache = { pathKey, result };
  return result;
}

/** Test-only: drop the memoized probe result so a test can vary PATH within one process. */
export function resetBwrapProbeCache(): void {
  probeCache = null;
}

function probeBwrap(env: NodeJS.ProcessEnv): BwrapProbe {
  if (!detectBwrapOnPath(env)) {
    return { usable: false, reason: "bubblewrap (bwrap) not found on PATH — install it for OS-level confinement (§12.5)" };
  }

  let proc;
  try {
    proc = spawnSync("bwrap", buildBwrapProbeArgs(), {
      encoding: "utf8",
      timeout: BWRAP_PROBE_TIMEOUT_MS,
      env,
      // Explicit array: `execFileSync`/`spawnSync` otherwise forward the
      // child's stderr to this process's console, and this probe is
      // *expected* to fail routinely on hosts without namespace support.
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err) {
    return { usable: false, reason: `bubblewrap is on PATH but could not be executed: ${(err as Error).message}` };
  }

  if (proc.error) {
    return { usable: false, reason: `bubblewrap is on PATH but could not be executed: ${proc.error.message}` };
  }
  if (proc.status === 0) {
    return { usable: true, reason: "bubblewrap is installed and successfully created a confined namespace" };
  }

  // `reason` deliberately stops short of naming the fallback tier — that is
  // the dispatcher's decision to describe (`tier1.ts`), not this probe's.
  const detail = (proc.stderr ?? "").trim().split("\n")[0] || `exit code ${proc.status}`;
  return {
    usable: false,
    reason: `bubblewrap is installed but cannot confine on this host (${detail}) — common on CI runners and unprivileged containers`
  };
}

export function buildBwrapSpawn(opts: BwrapSpawnOptions): { bin: string; args: string[] } {
  const args: string[] = [];

  for (const dir of READONLY_SYSTEM_DIRS) {
    if (fs.existsSync(dir)) args.push("--ro-bind", dir, dir);
  }

  args.push(
    "--tmpfs",
    "/tmp",
    "--dir",
    opts.homeDir,
    "--setenv",
    "HOME",
    opts.homeDir,
    "--bind",
    opts.workspaceRoot,
    opts.workspaceRoot,
    "--chdir",
    opts.cwd,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    // §12.6: `--unshare-net` is network default-deny at the OS level, not
    // just in the policy engine. Shared with the capability probe above so
    // the probe can never test weaker isolation than the real spawn uses.
    ...NAMESPACE_FLAGS,
    "--die-with-parent" // a killed/crashed parent (agent process) never leaves an orphaned sandboxed child running
  );

  if (opts.enableSeccomp) args.push("--seccomp", "3"); // fd 3 — the caller wires the compiled filter to stdio index 3

  args.push("/bin/sh", "-c", opts.command);

  return { bin: "bwrap", args };
}
