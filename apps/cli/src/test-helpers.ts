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
  callCount(): number;
  close: () => Promise<void>;
}

/** A minimal local OpenAI-compatible SSE server: a different scripted response per successive POST (mirrors `@clutchcode/agent-api`'s test helper of the same name). */
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

export function makeSampleRepo(): string {
  const dir = makeTempDir("clutchcode-cli-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "node -e \"console.log('ok')\"" } }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), "# sample\n", "utf8");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial commit"]);
  return dir;
}

/** Adds a local bare repo as `origin`, for `agent pr` tests that need a real (but offline) remote. */
export function addBareOrigin(repoPath: string): string {
  const bareDir = makeTempDir("clutchcode-cli-bare-remote-");
  git(repoPath, ["init", "-q", "--bare", "-b", "main", bareDir]);
  git(repoPath, ["remote", "add", "origin", bareDir]);
  return bareDir;
}
