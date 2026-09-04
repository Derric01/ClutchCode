import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { client as buildTestClientApp, ndJsonStream, AGENT_METHODS, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { makeSampleRepo } from "./test-helpers.js";

/**
 * Spawns the *real*, compiled `clutchcode` CLI binary (`clutchcode acp`) as
 * an actual child process and drives it over real OS pipes with the
 * genuine ACP wire format — the same upgrade `apps/vscode/src/connection
 * .test.ts` represents over `agent-rpc`'s own in-memory test, applied to
 * the ACP binding. `@clutchcode/acp/src/server.test.ts` already proves
 * `serveAcp` wires Node streams into a working ACP connection; this proves
 * the actual `clutchcode acp` subcommand (real argv parsing, real
 * `process.stdin`/`process.stdout`, real process lifecycle) is the thing
 * an editor would actually spawn. Requires `apps/cli` to have been built
 * (`tsc -b`) first, same as the rest of this monorepo's test run.
 */
const cliEntry = path.resolve(import.meta.dirname, "..", "dist", "cli.js");

describe.skipIf(!fs.existsSync(cliEntry))("clutchcode acp (spawns the real binary, real ACP wire format)", () => {
  let repoPath: string;
  let child: ChildProcessWithoutNullStreams;

  afterEach(() => {
    child?.kill();
    if (repoPath) fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("a spawned real `clutchcode acp` process drives a full run over ndjson stdio", async () => {
    repoPath = makeSampleRepo();
    child = spawn("node", [cliEntry, "acp"], { cwd: repoPath, stdio: ["pipe", "pipe", "pipe"] });

    const clientStream = ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
    );

    const outcome = await buildTestClientApp({ name: "cli-integration-test-client" }).connectWith(clientStream, async (ctx) => {
      const init = await ctx.request(AGENT_METHODS.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });

      const session = await ctx.request(AGENT_METHODS.session_new, {
        cwd: repoPath,
        mcpServers: [],
        _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
      });

      const prompt = await ctx.request(AGENT_METHODS.session_prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "investigate over the real spawned binary" }]
      });

      return { protocolVersion: init.protocolVersion, sessionId: session.sessionId, stopReason: prompt.stopReason };
    });

    expect(outcome.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(typeof outcome.sessionId).toBe("string");
    expect(outcome.stopReason).toBe("end_turn");
  }, 30_000);
});
