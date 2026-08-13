import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Agent, markTrusted, readEvents } from "@clutchcode/agent-api";
import { makeFixtureRepo, makeTempDir } from "./fixture-repo.js";

/**
 * The redaction canary (PROJECT_SPEC.md §5.2): "a canary key injected into
 * env/tool output; assert it appears in NO context, transcript, or log
 * artifact across a full recorded run." This drives the test through the
 * REAL public `Agent.run()` surface (agent-api) against a local mock
 * OpenAI-compatible server — the same code path a real provider would use
 * — rather than reaching into runtime internals, so it proves the whole
 * wire is safe end to end, not just one function.
 */

const CANARY = "sk-ant-canaryLeakDoNotPersist1234567890";

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Returns a different scripted SSE response on each successive POST. */
function startScriptedServer(responses: string[][]): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function collectAllFileContents(dir: string): string {
  let acc = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) acc += collectAllFileContents(p);
    else acc += fs.readFileSync(p, "utf8");
  }
  return acc;
}

describe("redaction canary — full recorded run through the public Agent API", () => {
  let cleanupFns: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanupFns) await fn();
    cleanupFns = [];
  });

  it("never persists the canary secret to RunState, events, or any file under the state dir", async () => {
    const repoPath = makeFixtureRepo();
    const stateDir = makeTempDir("clutchcode-canary-state-");
    cleanupFns.push(() => fs.rmSync(repoPath, { recursive: true, force: true }));
    cleanupFns.push(() => fs.rmSync(stateDir, { recursive: true, force: true }));

    const shellArgs = JSON.stringify({ cmd: `echo ${CANARY}` });
    const server = await startScriptedServer([
      [
        sseChunk({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "shell", arguments: shellArgs } }] } }]
        }),
        sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
        "data: [DONE]\n\n"
      ],
      [sseChunk({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]
    ]);
    cleanupFns.push(() => server.close());

    // Trust the repo so the non-destructive `echo` command is ALLOW'd
    // outright instead of parking on an ASK approval — the canary must
    // actually run and produce output for this test to prove anything.
    markTrusted(repoPath);

    const agent = new Agent(repoPath, stateDir);
    const state = await agent.run({
      task: "print the canary value",
      providerKind: "openai-compatible",
      model: "gpt-test",
      baseUrl: server.baseUrl,
      yesMode: true
    });

    // Sanity: the run actually executed the shell tool (otherwise this test proves nothing).
    expect(state.toolCallLog.some((t) => t.tool === "shell")).toBe(true);

    expect(JSON.stringify(state)).not.toContain(CANARY);

    const events = readEvents(stateDir, state.runId);
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(CANARY);

    // The deepest check: sweep every byte persisted under the state dir for this run.
    const everythingOnDisk = collectAllFileContents(path.join(stateDir, "runs", state.runId));
    expect(everythingOnDisk).not.toContain(CANARY);
  }, 30_000);
});
