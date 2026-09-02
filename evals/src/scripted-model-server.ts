import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local, scripted, OpenAI-compatible model server.
 *
 * This is the seam that lets the eval harness be tested end-to-end without
 * a real model, **without mocking anything below the model boundary** —
 * exactly the split `CLAUDE.md`'s testing philosophy asks for. Requests go
 * over real HTTP through the real `OpenAICompatibleProvider` SSE parser,
 * into the real `Agent.run` path, against a real git repository, real
 * tools, and a real deterministic gate. Only the model's *content* is
 * canned. (`evals/src/redaction-canary.test.ts` established this pattern;
 * this generalizes it so more than one test can use it.)
 *
 * Not a `.test.ts` file so it can be imported by any of them.
 */

export type ScriptedModelTurn =
  | { kind: "tool_call"; id: string; name: string; args: unknown }
  | { kind: "text"; text: string };

export interface ScriptedModelServer {
  baseUrl: string;
  /** How many chat completions the runtime actually asked for. */
  requestCount(): number;
  close(): Promise<void>;
}

export interface ScriptedModelServerOptions {
  /**
   * Pick the turn from the request itself instead of from a global call
   * counter. The §16.4 A/B drives **two arms through one endpoint** — the
   * ClutchCode arm sends a `tools` array and takes as many turns as its
   * loop needs, the naked arm sends none and takes exactly one — so a test
   * that scripts both cannot key on `callIndex` alone without silently
   * depending on how many turns the harness happens to take.
   *
   * Returning `undefined` falls back to `turns[callIndex]`.
   */
  route?: (request: { body: string; callIndex: number }) => ScriptedModelTurn | undefined;
}

const USAGE = { prompt_tokens: 120, completion_tokens: 40 };

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function chunksFor(turn: ScriptedModelTurn): string[] {
  if (turn.kind === "text") {
    return [sse({ choices: [{ delta: { content: turn.text }, finish_reason: "stop" }], usage: USAGE }), "data: [DONE]\n\n"];
  }
  return [
    sse({
      choices: [{ delta: { tool_calls: [{ index: 0, id: turn.id, function: { name: turn.name, arguments: JSON.stringify(turn.args) } }] } }]
    }),
    sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: USAGE }),
    "data: [DONE]\n\n"
  ];
}

/**
 * Serves `turns[i]` for the i-th completion request. Requests past the end
 * of the script get a final plain-text turn, so a runtime that asks one
 * more question than the script anticipated ends the run cleanly instead
 * of hanging — a benchmark must never deadlock on its own fixture.
 */
export function startScriptedModelServer(turns: ScriptedModelTurn[], opts: ScriptedModelServerOptions = {}): Promise<ScriptedModelServer> {
  let calls = 0;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer | string) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const routed = opts.route?.({ body, callIndex: calls });
        const turn = routed ?? turns[calls] ?? { kind: "text" as const, text: "(script exhausted — stopping)" };
        calls += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of chunksFor(turn)) res.write(chunk);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        requestCount: () => calls,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}
