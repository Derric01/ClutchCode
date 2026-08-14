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
