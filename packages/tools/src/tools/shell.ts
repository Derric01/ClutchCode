import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildConfinedSpawn, isDestructiveCommand, scrubEnv } from "@clutchcode/sandbox";
import type { Tool, ToolContext, ToolResult } from "../types.js";
import { fail, ok } from "../types.js";
import { truncate } from "../truncate.js";

export interface ShellArgs {
  cmd: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface ShellData {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_BUDGET = 20_000;

function commandClassOf(cmd: string): string {
  // A stable-enough key for "remember per command-class" (§12.2): the
  // command verb plus its first flag/argument, not the full invocation
  // (so `npm test` and `npm test --watch=false` share a class).
  const parts = cmd.trim().split(/\s+/);
  return parts.slice(0, 2).join(" ") || cmd;
}

// Design note: a nonzero exit code is reported as `data.exitCode`, not as
// `ok: false` — the tool ran successfully; whether a nonzero exit is a
// failure (a test run) or expected (grep with no matches) is a
// classification job for the runtime's error taxonomy (§6.8), not the tool
// layer. Only genuine tool-execution problems (timeout, spawn failure) set
// `ok: false`.
export const shellTool: Tool<ShellArgs, ShellData> = {
  name: "shell",
  description: "Run a shell command inside the workspace, sandboxed and policy-gated.",
  schema: {
    type: "object",
    required: ["cmd"],
    properties: {
      cmd: { type: "string" },
      timeoutMs: { type: "number" },
      cwd: { type: "string" }
    }
  },
  permissionClass: "EXECUTE",
  idempotent: false,

  validate(args) {
    if (typeof args !== "object" || args === null || typeof (args as { cmd?: unknown }).cmd !== "string") {
      return { ok: false, error: { message: "cmd is required and must be a string" } };
    }
    return { ok: true, value: args as ShellArgs };
  },

  async run(args, ctx: ToolContext): Promise<ToolResult<ShellData>> {
    const destructive = isDestructiveCommand(args.cmd);
    const decision = ctx.policy.decide({
      permissionClass: "EXECUTE",
      commandClass: commandClassOf(args.cmd),
      subject: args.cmd,
      repoTrustMode: ctx.repoTrustMode,
      destructive
    });
    if (decision.decision !== "ALLOW") {
      return fail(
        decision.decision === "ASK" ? "needs-approval" : "policy-denied",
        `${decision.reason} (command: ${args.cmd})`
      );
    }

    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = args.cwd ? args.cwd : ctx.workspaceRoot;

    // §12.5/§12.6: wrap under OS confinement (bwrap/Seatbelt) when Tier 1
    // is available; a plain `/bin/sh -c` passthrough otherwise (Tier 0 —
    // the policy engine + env scrubbing above still apply either way).
    // The synthetic `$HOME` lives next to the run's evidence dir — a
    // real, run-scoped, empty directory Seatbelt needs to exist on disk
    // (bwrap creates its own internally via `--dir`, so this is a no-op
    // for that backend beyond staying consistent).
    const homeDir = path.join(ctx.evidenceDir, "..", "sandbox-home");
    if (ctx.sandbox.backend !== "none") fs.mkdirSync(homeDir, { recursive: true });
    const { bin, args: spawnArgs } = buildConfinedSpawn(ctx.sandbox.backend, { workspaceRoot: ctx.workspaceRoot, cwd, command: args.cmd, homeDir });

    const env = scrubEnv(process.env);
    if (ctx.sandbox.backend !== "none") env.HOME = homeDir; // never the real $HOME under Tier 1 (§12.1/§12.3)

    return await new Promise<ToolResult<ShellData>>((resolve) => {
      // `detached: true` puts the child in its own process group so a
      // timeout/cancel can kill the whole group (`kill(-pid, …)`), not just
      // the top-level process — otherwise a shell that doesn't exec-replace
      // itself for a compound command (or, under Tier 1, everything inside
      // the sandbox's own pid namespace) leaves grandchildren running
      // (§6.6: "an in-flight shell command is sent SIGTERM→SIGKILL"). Under
      // bwrap, `--die-with-parent` plus `--unshare-pid` means killing this
      // one process tears down the whole sandboxed tree via the kernel's
      // own pid-namespace cleanup — strictly more reliable than Tier 0's
      // process-group-only cleanup.
      const child = spawn(bin, spawnArgs, {
        cwd,
        env,
        detached: true
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killed = false;

      const killGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          // Group may already be gone, or we lack permission (e.g. sandboxed
          // child under a different session) — fall back to the direct child.
          try {
            child.kill(signal);
          } catch {
            /* already dead */
          }
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        killGroup("SIGTERM");
        setTimeout(() => {
          if (!child.killed) killGroup("SIGKILL");
        }, 3000).unref();
      }, timeoutMs);
      timer.unref?.();

      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));

      const onAbort = () => {
        killed = true;
        killGroup("SIGTERM");
      };
      ctx.signal?.addEventListener("abort", onAbort, { once: true });

      child.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);

        const outTrunc = truncate(stdout, { budget: OUTPUT_BUDGET, kind: "log", evidenceDir: ctx.evidenceDir, label: "shell-stdout" });
        const errTrunc = truncate(stderr, { budget: OUTPUT_BUDGET, kind: "log", evidenceDir: ctx.evidenceDir, label: "shell-stderr" });
        const { text: shownStdout } = ctx.redactor.scrub(outTrunc.shown);
        const { text: shownStderr } = ctx.redactor.scrub(errTrunc.shown);

        const data: ShellData = {
          exitCode: code,
          stdout: shownStdout,
          stderr: shownStderr,
          killed,
          timedOut
        };

        if (timedOut) {
          resolve(fail("timeout", `command timed out after ${timeoutMs}ms: ${args.cmd}`, data));
          return;
        }
        resolve(ok(data, { truncated: outTrunc.truncated || errTrunc.truncated }));
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(fail("spawn-error", String(err), { stdout, stderr }));
      });
    });
  }
};
