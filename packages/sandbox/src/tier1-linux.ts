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
 * fs/net/pid isolation below doesn't depend on it. Landlock/seccomp
 * layering (§12.6) is a further-hardening follow-up, not yet wired here —
 * flagged, not silently skipped.
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
    "--die-with-parent", // a killed/crashed parent (agent process) never leaves an orphaned sandboxed child running
    "/bin/sh",
    "-c",
    opts.command
  );

  return { bin: "bwrap", args };
}
