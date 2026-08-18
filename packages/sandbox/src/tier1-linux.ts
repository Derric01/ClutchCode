import fs from "node:fs";

/**
 * Linux Tier 1 (PROJECT_SPEC.md §12.5/§12.6): bubblewrap (bwrap) namespace
 * confinement. Verified against a real `bwrap` binary (not just written to
 * spec) — see `tier1.test.ts`, which skips itself if `bwrap` genuinely
 * isn't on PATH rather than faking success.
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

export function detectBwrapOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const pathDirs = (env.PATH ?? "").split(":").filter(Boolean);
  return pathDirs.some((dir) => fs.existsSync(`${dir}/bwrap`));
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
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net", // §12.6: network default-deny at the OS level, not just the policy engine
    "--unshare-cgroup",
    "--die-with-parent" // a killed/crashed parent (agent process) never leaves an orphaned sandboxed child running
  );

  if (opts.enableSeccomp) args.push("--seccomp", "3"); // fd 3 — the caller wires the compiled filter to stdio index 3

  args.push("/bin/sh", "-c", opts.command);

  return { bin: "bwrap", args };
}
