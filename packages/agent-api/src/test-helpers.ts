import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export interface ScriptedServer {
  baseUrl: string;
  /** How many POSTs this server has served so far — useful for asserting a resumed run issued a fresh request. */
  callCount(): number;
  close: () => Promise<void>;
}

/**
 * A minimal local OpenAI-compatible SSE server (mirrors
 * `evals/src/redaction-canary.test.ts`'s helper): returns a different
 * scripted response on each successive POST, so a test can drive a
 * multi-turn run through the real `openai-compatible` provider adapter —
 * the same wire path `Agent.run`/`Agent.resume` use in production — rather
 * than through `FakeProvider`, which `providerKind: "fake"` pins to one
 * fixed no-op turn (§4.7) and so can't script pausing/resuming at all.
 */
export function startScriptedServer(responses: string[][]): Promise<ScriptedServer> {
  let call = 0;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const chunks = responses[Math.min(call, responses.length - 1)]!;
        call += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const c of chunks) res.write(c);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        callCount: () => call,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A trivial-but-real Node repo: `npm test` runs and passes with zero setup, so the pipeline stage genuinely executes. */
export function makeSampleRepo(): string {
  const dir = makeTempDir("clutchcode-agentapi-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "node -e \"console.log('ok')\"" } }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), "# sample\n", "utf8");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial commit"]);
  return dir;
}

/** A repo whose root test *fails* but whose `packages/foo` subdir has its own, passing toolchain — for §13.4 `--scope` tests. */
export function makeMonorepo(): string {
  const dir = makeTempDir("clutchcode-agentapi-monorepo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "root", scripts: { test: "node -e \"process.exit(1)\"" } }, null, 2), "utf8");
  fs.mkdirSync(path.join(dir, "packages", "foo"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "packages", "foo", "package.json"),
    JSON.stringify({ name: "foo", scripts: { test: "node -e \"console.log('ok')\"" } }, null, 2),
    "utf8"
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial commit"]);
  return dir;
}

/** Adds a local bare repo as `origin`, for push/PR tests that need a real (but offline) remote. */
export function addBareOrigin(repoPath: string): string {
  const bareDir = makeTempDir("clutchcode-agentapi-bare-remote-");
  git(repoPath, ["init", "-q", "--bare", "-b", "main", bareDir]);
  git(repoPath, ["remote", "add", "origin", bareDir]);
  return bareDir;
}

export interface ThrowawaySecretService {
  /** Pass this as the `env` argument to any keychain-linux.ts function to reach the throwaway service. */
  env: NodeJS.ProcessEnv;
  close: () => void;
}

/**
 * Spins up a real, throwaway freedesktop Secret Service — a fresh D-Bus
 * session bus + `gnome-keyring-daemon`, rooted at a fresh temp `$HOME` —
 * for tests that need `secret-tool` to have a real backend to talk to
 * (the standard headless-testing trick for libsecret). Shared by
 * `keychain-linux.test.ts` and `credentials.test.ts` so the same
 * setup/teardown recipe isn't duplicated. Caller must check
 * `detectSecretToolOnPath()` first and skip if it's false; this function
 * assumes `secret-tool`/`dbus-daemon`/`gnome-keyring-daemon` are present.
 */
export function startThrowawaySecretService(): ThrowawaySecretService {
  const homeDir = makeTempDir("clutchcode-keychain-test-");
  fs.mkdirSync(path.join(homeDir, ".cache"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".local", "share", "keyrings"), { recursive: true });
  const controlDir = path.join(homeDir, ".cache", "kr");
  fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });

  const dbusOut = execFileSync("dbus-daemon", ["--session", "--fork", "--print-address=1", "--print-pid=1"], { encoding: "utf8" });
  const [address, pidLine] = dbusOut.trim().split("\n");
  const dbusPid = Number(pidLine);

  const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir, DBUS_SESSION_BUS_ADDRESS: address };

  const krOut = execFileSync("gnome-keyring-daemon", ["--unlock", "--components=secrets", `--control-directory=${controlDir}`], {
    input: "\n",
    encoding: "utf8",
    env
  });
  const match = krOut.match(/GNOME_KEYRING_CONTROL=(\S+)/);
  if (match) env.GNOME_KEYRING_CONTROL = match[1];

  // `--` stops pgrep's own option parsing so the `--control-directory=...`
  // pattern isn't mistaken for a pgrep flag.
  const keyringPid = execFileSync("pgrep", ["-f", "--", `control-directory=${controlDir}`], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map(Number)
    .find((n) => Number.isFinite(n));

  return {
    env,
    close: () => {
      if (keyringPid) {
        try {
          process.kill(keyringPid);
        } catch {
          /* already gone */
        }
      }
      try {
        process.kill(dbusPid);
      } catch {
        /* already gone */
      }
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  };
}
