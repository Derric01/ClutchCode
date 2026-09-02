import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  HermesStreamParser,
  buildHermesToolSystemPrompt,
  extractHermesToolCalls,
  renderHermesToolCalls,
  renderHermesToolResponse,
  toHermesRequestMessages
} from "./hermes.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { collect, type Delta, type NormalizedRequest } from "./types.js";

/**
 * Hermes tool-call format (§4.7/§4.9). Fixtures are modeled on the token
 * layout the upstream `chat_templates` produce — the format, which is
 * REUSE-eligible as an open protocol; no upstream code or prompt text.
 *
 * NOT verified against a live model: no Ollama, no GPU, no weights here. See
 * the header of `hermes.ts`.
 */

const CALL_EDIT = '<tool_call>\n{"name": "edit_file", "arguments": {"path": "greeter.txt", "edits": [{"search": "Hello", "replace": "Hi"}]}}\n</tool_call>';
const SCRATCH_PAD = "<scratch_pad>\nGoal: change the greeting\nActions:\n- r1 = functions.edit_file(path=\"greeter.txt\")\nObservation: None\nReflection: the edit_file tool is relevant\n</scratch_pad>";

describe("extractHermesToolCalls", () => {
  it("extracts a call and strips the scratch_pad reasoning block instead of leaking it", () => {
    const res = extractHermesToolCalls(`${SCRATCH_PAD}\n${CALL_EDIT}`);

    expect(res.calls).toEqual([
      {
        id: "hermes_call_1",
        name: "edit_file",
        argsJson: JSON.stringify({ path: "greeter.txt", edits: [{ search: "Hello", replace: "Hi" }] })
      }
    ]);
    expect(res.text).not.toContain("scratch_pad");
    expect(res.text).not.toContain("Reflection");
    expect(res.malformedRegions).toEqual([]);
  });

  it("extracts several calls from one turn, keeping surrounding prose in order", () => {
    const msg = [
      "First I will read it.",
      '<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>',
      "Then the other one.",
      '<tool_call>\n{"name": "read_file", "arguments": {"path": "b.ts"}}\n</tool_call>',
      "Done."
    ].join("\n");

    const res = extractHermesToolCalls(msg);

    expect(res.calls.map((c) => c.argsJson)).toEqual(['{"path":"a.ts"}', '{"path":"b.ts"}']);
    expect(res.calls.map((c) => c.id)).toEqual(["hermes_call_1", "hermes_call_2"]);
    expect(res.text).toContain("First I will read it.");
    expect(res.text).toContain("Then the other one.");
    expect(res.text.trim().endsWith("Done.")).toBe(true);
  });

  /**
   * The reason the upstream extractor was deliberately not ported. It wraps
   * the whole assistant message in a synthetic `<root>` and strict-XML-parses
   * it, so every one of these — a bare `<`, a bare `&`, an unclosed generic,
   * a shell redirect, JSX — would make the parse throw and discard the
   * perfectly valid tool call sharing the message. A coding agent emits this
   * content constantly.
   */
  it("survives a message full of code that would break an XML-based extractor", () => {
    const codey = [
      "Here is the problem — `a < b && c > d` is parsed wrong, and so is this:",
      "```ts",
      "const xs: Array<string = [];      // unclosed generic, on purpose",
      "if (a < b && b > c) { run(); }",
      "const el = <Foo bar={x} />;       // JSX",
      "```",
      "And in the shell: `cat a.txt > b.txt 2>&1`.",
      "Let me fix it:",
      CALL_EDIT
    ].join("\n");

    const res = extractHermesToolCalls(codey);

    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]!.name).toBe("edit_file");
    // Every hostile fragment survives verbatim in the text stream.
    expect(res.text).toContain("Array<string = [];");
    expect(res.text).toContain("<Foo bar={x} />");
    expect(res.text).toContain("cat a.txt > b.txt 2>&1");
    expect(res.text).toContain("a < b && c > d");
  });

  it("treats an unparseable region as one failed call, not a failed message", () => {
    const msg = [
      '<tool_call>\n{"name": "read_file", "arguments": {oops not json}}\n</tool_call>',
      '<tool_call>\n{"name": "read_file", "arguments": {"path": "ok.ts"}}\n</tool_call>'
    ].join("\n");

    const res = extractHermesToolCalls(msg);

    // The good call still lands...
    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]!.argsJson).toBe('{"path":"ok.ts"}');
    // ...and the bad one is surfaced verbatim rather than silently dropped.
    expect(res.malformedRegions).toHaveLength(1);
    expect(res.text).toContain("oops not json");
    expect(res.text).toContain("<tool_call>");
  });

  it("rejects a region whose JSON is valid but carries no tool name", () => {
    const res = extractHermesToolCalls('<tool_call>\n{"arguments": {"path": "a.ts"}}\n</tool_call>');
    expect(res.calls).toEqual([]);
    expect(res.malformedRegions).toHaveLength(1);
  });

  it("accepts arguments as an already-encoded JSON string, and a call with no arguments at all", () => {
    const res = extractHermesToolCalls(
      ['<tool_call>{"name": "read_file", "arguments": "{\\"path\\": \\"a.ts\\"}"}</tool_call>', '<tool_call>{"name": "run_tests"}</tool_call>'].join("\n")
    );

    expect(res.calls[0]!.argsJson).toBe('{"path": "a.ts"}');
    expect(res.calls[1]).toEqual({ id: "hermes_call_2", name: "run_tests", argsJson: "{}" });
  });

  it("surfaces a call truncated mid-stream verbatim instead of emitting a half-built call", () => {
    const res = extractHermesToolCalls('Working on it.\n<tool_call>\n{"name": "edit_file", "arg');

    expect(res.calls).toEqual([]);
    expect(res.malformedRegions).toHaveLength(1);
    expect(res.text).toContain("Working on it.");
    expect(res.text).toContain('<tool_call>\n{"name": "edit_file", "arg');
  });

  it("closes an unterminated scratch_pad implicitly so it cannot swallow the tool call after it", () => {
    const res = extractHermesToolCalls(`<scratch_pad>\nGoal: do the thing\n${CALL_EDIT}`);

    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]!.name).toBe("edit_file");
    expect(res.text).not.toContain("Goal: do the thing");
  });

  it("recovers when one tool_call region is never closed before the next one opens", () => {
    const msg = '<tool_call>\n{"name": "broken"\n<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>';

    const res = extractHermesToolCalls(msg);

    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]!.name).toBe("read_file");
    expect(res.malformedRegions).toHaveLength(1);
  });

  it("leaves a message with no tool call completely untouched", () => {
    const prose = "No tools needed here. The answer is 42 — and 3 < 4 & 5 > 4.";
    expect(extractHermesToolCalls(prose)).toEqual({ text: prose, calls: [], malformedRegions: [] });
  });
});

describe("HermesStreamParser (incremental — no upstream reference for this)", () => {
  function drain(chunks: string[]): Delta[] {
    const parser = new HermesStreamParser();
    const out: Delta[] = [];
    for (const c of chunks) out.push(...parser.push(c));
    out.push(...parser.end());
    return out;
  }

  function textOf(deltas: Delta[]): string {
    return deltas.filter((d) => d.type === "text").map((d) => (d as { text: string }).text).join("");
  }

  it("produces the identical result when every tag is split one character per chunk", () => {
    const whole = `Let me look.\n${SCRATCH_PAD}\n${CALL_EDIT}\nAll set.`;

    const perChar = drain([...whole]);
    const oneShot = drain([whole]);

    // Text-delta *granularity* legitimately differs (one delta per chunk);
    // what must not differ is the text itself or any tool-call delta.
    expect(textOf(perChar)).toBe(textOf(oneShot));
    expect(perChar.filter((d) => d.type !== "text")).toEqual(oneShot.filter((d) => d.type !== "text"));

    expect(perChar.filter((d) => d.type === "tool_call_start")).toHaveLength(1);
    expect(textOf(perChar)).not.toContain("scratch_pad");
    expect(textOf(perChar)).toContain("Let me look.");
    expect(textOf(perChar)).toContain("All set.");
  });

  it("reassembles a call whose opening tag is split across a chunk boundary", () => {
    const deltas = drain(["Before <to", "ol_call>", '{"name": "run_tests", "arguments": {}}', "</tool", "_call> after"]);

    const start = deltas.find((d) => d.type === "tool_call_start");
    expect(start).toEqual({ type: "tool_call_start", id: "hermes_call_1", name: "run_tests" });
    expect(textOf(deltas)).toBe("Before  after");
  });

  /**
   * The chunk-boundary hazard specific to a coding agent: text ending in `<`
   * must be held back (it might be the start of a tag) but must still be
   * emitted, in order, once the next chunk proves it is not.
   */
  it("holds back a partial-tag suffix without ever losing or reordering the text", () => {
    expect(textOf(drain(["const xs: Array<", "string> = [];"]))).toBe("const xs: Array<string> = [];");
    expect(textOf(drain(["a <", "b"]))).toBe("a <b");
    expect(textOf(drain(["trailing <tool_"]))).toBe("trailing <tool_");
    // The space before the tag is ordinary text and is kept; only the block goes.
    expect(textOf(drain(["x <scratch", "_pad>hidden</scratch_pad>y"]))).toBe("x y");
  });

  it("emits a call atomically — start, delta and end together, never a half-open call", () => {
    const deltas = drain([`${CALL_EDIT}`]);
    const kinds = deltas.map((d) => d.type);
    expect(kinds).toEqual(["tool_call_start", "tool_call_delta", "tool_call_end"]);
  });

  it("is idempotent on end(), so a provider may flush it more than once", () => {
    const parser = new HermesStreamParser();
    // A trailing "<" is held back mid-stream (it might open a tag), so this
    // is text that only end() can release.
    expect(parser.push("hello <")).toEqual([{ type: "text", text: "hello " }]);
    expect(parser.end()).toEqual([{ type: "text", text: "<" }]);
    expect(parser.end()).toEqual([]);
  });

  it("counts emitted calls and malformed regions separately", () => {
    const parser = new HermesStreamParser();
    parser.push(`${CALL_EDIT}<tool_call>nope</tool_call>`);
    parser.end();
    expect(parser.toolCallCount).toBe(1);
    expect(parser.malformedRegions).toHaveLength(1);
  });
});

describe("buildHermesToolSystemPrompt / renderers", () => {
  const tools = [{ name: "read_file", description: "Read a file.", parameters: { type: "object", properties: { path: { type: "string" } } } }];

  it("declares tools inside <tools> as OpenAI-shaped function schemas", () => {
    const prompt = buildHermesToolSystemPrompt(tools);

    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("</tools>");
    const declared = prompt.slice(prompt.indexOf("<tools>"), prompt.indexOf("</tools>"));
    const line = declared.split("\n").find((l) => l.startsWith("{"))!;
    expect(JSON.parse(line)).toEqual({
      type: "function",
      function: { name: "read_file", description: "Read a file.", parameters: tools[0]!.parameters }
    });
  });

  it("round-trips: a rendered call parses back to the same name and arguments", () => {
    const rendered = renderHermesToolCalls([{ name: "read_file", argsJson: '{"path":"a.ts"}' }]);
    const back = extractHermesToolCalls(rendered);
    expect(back.calls).toEqual([{ id: "hermes_call_1", name: "read_file", argsJson: '{"path":"a.ts"}' }]);
  });

  it("wraps a tool result in <tool_response>", () => {
    expect(renderHermesToolResponse("ok")).toBe("<tool_response>\nok\n</tool_response>");
  });
});

describe("toHermesRequestMessages", () => {
  const request: NormalizedRequest = {
    model: "m",
    messages: [
      { role: "system", content: "You are careful." },
      { role: "user", content: "Read a.ts" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", argsJson: '{"path":"a.ts"}' }] },
      { role: "tool", toolCallId: "c1", content: "file contents" }
    ],
    tools: [{ name: "read_file", description: "Read a file.", parameters: { type: "object" } }]
  };

  it("merges the tool declaration into the caller's own system prompt rather than adding a second one", () => {
    const out = toHermesRequestMessages(request);
    expect(out.filter((m) => m.role === "system")).toHaveLength(1);
    expect(out[0]!.content).toContain("You are careful.");
    expect(out[0]!.content).toContain("<tools>");
  });

  it("renders assistant tool calls as <tool_call> text with no native tool_calls field left", () => {
    const assistant = toHermesRequestMessages(request).find((m) => m.role === "assistant")!;
    expect(assistant.toolCalls).toBeUndefined();
    expect(assistant.content).toContain('<tool_call>\n{"name":"read_file","arguments":{"path":"a.ts"}}\n</tool_call>');
  });

  it("returns tool results as a user turn wrapped in <tool_response> (no orphan tool-role message)", () => {
    const out = toHermesRequestMessages(request);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(out[out.length - 1]).toEqual({ role: "user", content: "<tool_response>\nfile contents\n</tool_response>" });
  });

  it("adds a system turn when the caller supplied none", () => {
    const out = toHermesRequestMessages({ ...request, messages: [{ role: "user", content: "hi" }] });
    expect(out[0]!.role).toBe("system");
    expect(out[0]!.content).toContain("<tools>");
  });
});

// --- Provider integration, over the real SSE path ---------------------------

/** Streams `content` as SSE, chopped into `size`-char chunks so tags straddle boundaries. */
function startChunkedServer(content: string, size: number, finishReason = "stop"): Promise<{ baseUrl: string; bodies: string[]; close: () => Promise<void> }> {
  const bodies: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let b = "";
      req.on("data", (d) => (b += d));
      req.on("end", () => {
        bodies.push(b);
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const piece of content.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? []) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, bodies, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

describe("provider integration (§4.7)", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("OllamaProvider reads a Hermes-shaped stream as real tool calls (the gap this closes)", async () => {
    const server = await startChunkedServer(`${SCRATCH_PAD}\n${CALL_EDIT}`, 7);
    close = server.close;

    const provider = new OllamaProvider({ baseUrl: server.baseUrl });
    const res = await collect(provider.chat({ model: "hermes-3", messages: [], tools: [] }));

    expect(res.toolCalls).toEqual([
      {
        id: "hermes_call_1",
        name: "edit_file",
        argsJson: JSON.stringify({ path: "greeter.txt", edits: [{ search: "Hello", replace: "Hi" }] })
      }
    ]);
    // The GOAP reasoning block no longer leaks into user-visible output.
    expect(res.text).not.toContain("scratch_pad");
    expect(res.text).not.toContain("Reflection");
    // The server said "stop"; a Hermes model has no way to say "tool_calls".
    expect(res.finishReason).toBe("tool_use");
  });

  it("OpenAICompatibleProvider still defaults to native — <tool_call> stays plain text unless opted in", async () => {
    const server = await startChunkedServer(CALL_EDIT, 7);
    close = server.close;

    const provider = new OpenAICompatibleProvider({ baseUrl: server.baseUrl });
    const res = await collect(provider.chat({ model: "gpt-test", messages: [] }));

    expect(res.toolCalls).toEqual([]);
    expect(res.text).toContain("<tool_call>");
    expect(res.finishReason).toBe("stop");
  });

  it('"auto" leaves the request untouched — native tool schemas are still sent', async () => {
    const server = await startChunkedServer("nothing to see", 5);
    close = server.close;

    const provider = new OpenAICompatibleProvider({ baseUrl: server.baseUrl, toolProtocol: "auto" });
    await collect(
      provider.chat({ model: "m", messages: [{ role: "user", content: "hi" }], tools: [{ name: "read_file", description: "d", parameters: { type: "object" } }] })
    );

    const body = JSON.parse(server.bodies[0]!);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("read_file");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it('"hermes" moves the schemas into the system prompt and sends no tools field', async () => {
    const server = await startChunkedServer("ok", 5);
    close = server.close;

    const provider = new OpenAICompatibleProvider({ baseUrl: server.baseUrl, toolProtocol: "hermes" });
    await collect(
      provider.chat({ model: "m", messages: [{ role: "user", content: "hi" }], tools: [{ name: "read_file", description: "d", parameters: { type: "object" } }] })
    );

    const body = JSON.parse(server.bodies[0]!);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("<tools>");
    expect(body.messages[0].content).toContain('"name":"read_file"');
  });

  it("still reassembles a native tool call in auto mode (no regression for a model that answers natively)", async () => {
    const server = await new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
      const s = http.createServer((req, res) => {
        req.on("data", () => {});
        req.on("end", () => {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n');
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
          res.end("data: [DONE]\n\n");
        });
      });
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address() as AddressInfo;
        resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((r) => s.close(() => r())) });
      });
    });
    close = server.close;

    const provider = new OpenAICompatibleProvider({ baseUrl: server.baseUrl, toolProtocol: "auto" });
    const res = await collect(provider.chat({ model: "m", messages: [] }));

    expect(res.toolCalls).toEqual([{ id: "call_abc", name: "read_file", argsJson: '{"path":"a.ts"}' }]);
    expect(res.finishReason).toBe("tool_use");
  });

  it("does not lose a call truncated by the stream ending — it comes back as text, not silence", async () => {
    const server = await startChunkedServer('Working.\n<tool_call>\n{"name": "edit_file", "argu', 6);
    close = server.close;

    const provider = new OllamaProvider({ baseUrl: server.baseUrl });
    const res = await collect(provider.chat({ model: "hermes-3", messages: [] }));

    expect(res.toolCalls).toEqual([]);
    expect(res.text).toContain("Working.");
    expect(res.text).toContain('{"name": "edit_file", "argu');
  });
});
