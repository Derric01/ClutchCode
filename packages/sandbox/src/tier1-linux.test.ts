import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildBwrapProbeArgs, buildBwrapSpawn, detectBwrapOnPath, detectBwrapUsable, resetBwrapProbeCache } from "./tier1-linux.js";

describe("detectBwrapOnPath", () => {
  it("finds a real binary on PATH (this repo's dev container has bubblewrap installed)", () => {
    // Not mocked deliberately: a false positive here would mean every
    // other test in this file silently skips instead of proving anything.
    expect(detectBwrapOnPath()).toBe(true);
  });

  it("returns false when PATH has no bwrap", () => {
    expect(detectBwrapOnPath({ PATH: "/definitely/not/a/real/dir" })).toBe(false);
  });
});

describe("detectBwrapUsable — capability, not presence", () => {
  afterEach(() => resetBwrapProbeCache());

  it("probes with the same namespace flags the real spawn uses, so it can't test weaker isolation", () => {
    // The whole point of the probe is that it fails wherever the real
    // spawn would. If these two ever diverge it silently stops proving
    // anything, so the overlap is asserted rather than assumed.
    const probeArgs = buildBwrapProbeArgs();
    const realArgs = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "true", homeDir: "/home/sandboxed" }).args;
    for (const flag of ["--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-net", "--unshare-cgroup"]) {
      expect(probeArgs, `probe is missing ${flag}`).toContain(flag);
      expect(realArgs).toContain(flag);
    }
    expect(probeArgs.at(-1)).toBe("/bin/true");
  });

  it("reports usable on this host, where bwrap really can confine", () => {
    const probe = detectBwrapUsable();
    expect(probe.usable).toBe(true);
    expect(probe.reason).toMatch(/successfully created a confined namespace/);
  });

  it("reports NOT usable when bwrap is on PATH but cannot actually confine", () => {
    // The bug this whole probe exists for, reproduced: a `bwrap` that is
    // present and executable but fails exactly the way a GitHub Actions
    // runner's does. `detectBwrapOnPath` says yes; the probe must say no,
    // and must carry the real reason rather than a generic one.
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-fake-bwrap-"));
    try {
      const stub = path.join(fakeBin, "bwrap");
      fs.writeFileSync(stub, "#!/bin/sh\necho 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2\nexit 1\n", "utf8");
      fs.chmodSync(stub, 0o755);

      const env = { PATH: `${fakeBin}:/usr/bin:/bin` };
      expect(detectBwrapOnPath(env)).toBe(true); // presence check is fooled...
      const probe = detectBwrapUsable(env); // ...the capability probe is not.
      expect(probe.usable).toBe(false);
      expect(probe.reason).toMatch(/cannot confine on this host/);
      expect(probe.reason).toMatch(/RTM_NEWADDR/);
    } finally {
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("reports NOT usable, without spawning anything, when bwrap isn't installed at all", () => {
    const probe = detectBwrapUsable({ PATH: "/definitely/not/a/real/dir" });
    expect(probe.usable).toBe(false);
    expect(probe.reason).toMatch(/not found on PATH/);
  });
});

describe("buildBwrapSpawn", () => {
  it("binds the workspace read-write, sets a synthetic HOME, and unshares net/pid", () => {
    const { bin, args } = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "echo hi", homeDir: "/home/sandboxed" });
    expect(bin).toBe("bwrap");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--unshare-pid");
    expect(args).toContain("--die-with-parent");
    const homeIdx = args.indexOf("--dir");
    expect(args[homeIdx + 1]).toBe("/home/sandboxed");
    const bindIdx = args.indexOf("--bind");
    expect(args[bindIdx + 1]).toBe("/tmp/ws");
    expect(args[bindIdx + 2]).toBe("/tmp/ws");
    // The actual command is the final three args: /bin/sh -c <command>.
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "echo hi"]);
  });

  it("only ro-binds system dirs that actually exist, never guessing", () => {
    const { args } = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "true", homeDir: "/home/x" });
    // /usr and /etc exist on any Linux box (including this one); a
    // fabricated path must never show up as a --ro-bind target.
    expect(args).toContain("/usr");
    expect(args).not.toContain("/this/path/does/not/exist");
  });

  it("omits --seccomp entirely when enableSeccomp isn't set (§12.6 opt-in, no surprise behavior change)", () => {
    const { args } = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "true", homeDir: "/home/x" });
    expect(args).not.toContain("--seccomp");
  });

  it("adds --seccomp 3 when enableSeccomp is set (the fd itself is wired and proven end to end in seccomp-linux.test.ts)", () => {
    const { args } = buildBwrapSpawn({ workspaceRoot: "/tmp/ws", cwd: "/tmp/ws", command: "true", homeDir: "/home/x", enableSeccomp: true });
    const idx = args.indexOf("--seccomp");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("3");
    // Still ends with the command — --seccomp must land before the positional /bin/sh -c args, not after.
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "true"]);
  });
});

describe("buildBwrapSpawn — real confinement, run against the actual bwrap binary", () => {
  // `detectBwrapUsable`, not `detectBwrapOnPath`: on a host where bwrap is
  // installed but cannot create namespaces (a GitHub Actions runner, an
  // unprivileged container) the presence check said yes and every test
  // below then failed with `bwrap: loopback: Failed RTM_NEWADDR` instead of
  // skipping. That is what kept this repo's CI red on `main`. These tests
  // still run for real wherever bwrap genuinely works — including this dev
  // container, where the assertion above proves the probe returns usable,
  // so a regression that made everything skip would itself fail.
  const maybeIt = detectBwrapUsable().usable ? it : it.skip;

  let workspaceRoot: string;
  let outsideFile: string;

  function setup(): void {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-tier1-ws-"));
    fs.writeFileSync(path.join(workspaceRoot, "in-workspace.txt"), "workspace content\n", "utf8");
    outsideFile = fs.mkdtempSync(path.join(os.tmpdir(), "clutchcode-tier1-outside-")) + "/secret.txt";
    fs.writeFileSync(outsideFile, "should never be readable\n", "utf8");
  }

  function run(command: string): string {
    const { bin, args } = buildBwrapSpawn({ workspaceRoot, cwd: workspaceRoot, command, homeDir: "/home/clutchcode-sandboxed" });
    return execFileSync(bin, args, { encoding: "utf8" });
  }

  maybeIt("can read a file inside the workspace", () => {
    setup();
    expect(run("cat in-workspace.txt")).toBe("workspace content\n");
  });

  maybeIt("cannot read a file outside the workspace, even with an absolute path", () => {
    setup();
    expect(() => run(`cat ${outsideFile}`)).toThrow();
  });

  maybeIt("cannot reach the network", () => {
    setup();
    // node is under /opt or /usr on most installs, both ro-bound; a fetch
    // to a real host must fail purely from network namespace isolation,
    // not DNS/connectivity flakiness in the test environment.
    const out = run(`node -e "fetch('http://93.184.216.34', {signal: AbortSignal.timeout(2000)}).then(()=>console.log('REACHED')).catch(()=>console.log('BLOCKED'))"`);
    expect(out.trim()).toBe("BLOCKED");
  });

  maybeIt("HOME inside the sandbox is empty, not the real one", () => {
    setup();
    expect(run("ls -A $HOME").trim()).toBe("");
  });

  maybeIt("a write inside the workspace is real and visible outside the sandbox afterward", () => {
    setup();
    run("echo written > new-file.txt");
    expect(fs.readFileSync(path.join(workspaceRoot, "new-file.txt"), "utf8")).toBe("written\n");
  });
});
