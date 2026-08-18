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
  close: () => Promise<void>;
}

/**
 * A minimal local OpenAI-compatible SSE server (same self-contained pattern
 * as `@clutchcode/agent-api`'s own `test-helpers.ts` — duplicated rather
 * than imported, since packages in this monorepo don't import each other's
 * test helpers across the `@clutchcode/*` package boundary). Lets a test
 * script a real tool call (a real edit, a real checkpoint) through the real
 * `openai-compatible` provider adapter, which `providerKind: "fake"` can't
 * do — it's pinned to one fixed no-op turn.
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
  const dir = makeTempDir("clutchcode-vscode-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "node -e \"console.log('ok')\"" } }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), "# sample\n", "utf8");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial commit"]);
  return dir;
}

/** A real local bare remote wired up as `origin` — for `prTask` tests, so `agent pr`'s push has something real to push to. Returns the bare repo's path (caller cleans it up). */
export function addBareOrigin(repoPath: string): string {
  const bareDir = makeTempDir("clutchcode-vscode-bare-remote-");
  git(repoPath, ["init", "-q", "--bare", "-b", "main", bareDir]);
  git(repoPath, ["remote", "add", "origin", bareDir]);
  return bareDir;
}
