import fs from "node:fs";
import { PassThrough, Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client as buildTestClientApp, ndJsonStream, AGENT_METHODS, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { serveAcp, type AcpServerHandle } from "./server.js";
import { makeSampleRepo, makeTempDir } from "./test-helpers.js";

/**
 * Proves `serveAcp` wires real Node `stdin`/`stdout`-shaped streams (a
 * `PassThrough` pair here, standing in for a spawned child process's real
 * pipes exactly as `@clutchcode/agent-rpc`'s own `integration.test.ts`
 * does) into a working ACP connection over the actual newline-delimited-JSON
 * wire format — not just that `buildAcpApp`'s in-process handlers are
 * correct (`agent-methods.test.ts` already covers that exhaustively). Real
 * bytes flow through real `Readable.toWeb`/`Writable.toWeb` conversions
 * here; nothing about the transport is mocked.
 */
describe("serveAcp (§18.1 ACP binding, stdio wiring)", () => {
  let repoPath: string;
  let stateDir: string;
  let server: AcpServerHandle;

  beforeEach(() => {
    repoPath = makeSampleRepo();
    stateDir = makeTempDir("clutchcode-acp-server-state-");
  });

  afterEach(() => {
    server?.close();
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("a real ACP client speaking ndjson over piped Node streams can drive a full run through serveAcp", async () => {
    const toServer = new PassThrough(); // bytes the client writes land here; this is the server's `stdin`
    const toClient = new PassThrough(); // bytes the server writes land here; this is the client's inbound stream

    server = serveAcp({ stateDir }, toServer, toClient);

    const clientStream = ndJsonStream(
      Writable.toWeb(toServer) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(toClient) as unknown as ReadableStream<Uint8Array>
    );

    const outcome = await buildTestClientApp({ name: "server-test-client" }).connectWith(clientStream, async (ctx) => {
      const init = await ctx.request(AGENT_METHODS.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });

      const session = await ctx.request(AGENT_METHODS.session_new, {
        cwd: repoPath,
        mcpServers: [],
        _meta: { "clutchcode/provider": "fake", "clutchcode/model": "n/a" }
      });

      const prompt = await ctx.request(AGENT_METHODS.session_prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "investigate over real stdio" }]
      });

      return { protocolVersion: init.protocolVersion, sessionId: session.sessionId, stopReason: prompt.stopReason };
    });

    expect(outcome.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(typeof outcome.sessionId).toBe("string");
    expect(outcome.stopReason).toBe("end_turn");
  }, 30_000);

  it("close() stops the server from processing further stdin writes", async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    server = serveAcp({ stateDir }, toServer, toClient);

    server.close();

    // A request written after close() should get no response — proven by
    // racing it against a short timer instead of asserting a specific
    // error, since "no more bytes will ever come" has no single failure
    // shape to assert on.
    const gotResponse = new Promise<boolean>((resolve) => {
      toClient.once("data", () => resolve(true));
      setTimeout(() => resolve(false), 300);
    });
    toServer.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: AGENT_METHODS.initialize, params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} } })}\n`);

    expect(await gotResponse).toBe(false);
  });
});
