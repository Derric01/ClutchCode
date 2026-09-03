import type { Delta, NormalizedMessage, NormalizedRequest, ToolSchema } from "./types.js";

/**
 * Hermes tool-call format (PROJECT_SPEC.md §4.7 provider abstraction, §4.9
 * check 3 "tool-protocol validity") — the de-facto wire format for
 * open-weight models.
 *
 * Tools are declared in the **system** prompt inside `<tools> </tools>` as
 * OpenAI-shaped function-schema JSON; the model answers with one or more
 * `<tool_call>{"name": …, "arguments": {…}}</tool_call>` regions; results go
 * back inside `<tool_response> </tool_response>`. Hermes-3 may emit an
 * optional `<scratch_pad> </scratch_pad>` GOAP reasoning block before the
 * calls, which must be stripped rather than leaked to the user.
 *
 * Why this file exists: `OpenAICompatibleProvider` parses only OpenAI-shaped
 * `delta.tool_calls`, so a local model speaking this format was read as
 * **plain prose** — no tool calls at all, and the `<scratch_pad>` block
 * leaking verbatim into user-visible output. The §4.9 probe then scored such
 * a model `toolTransport: "none"`, which cascades into a weaker edit format
 * (§4.4) and a smaller context budget (§4.5), systematically under-rating a
 * genuinely capable model. Reproduced before this module was written; see the
 * `docs/PROJECT_LOG.md` entry.
 *
 * ## Reuse posture
 *
 * The **format** is an open protocol and is REUSE-eligible, the same posture
 * as MCP/ACP (`LICENSE_AND_REUSE_ANALYSIS.md`). The upstream **parser
 * implementation is deliberately not ported**: NousResearch's
 * `utils.py::validate_and_extract_tool_calls` wraps the whole assistant
 * message in a synthetic `<root>` element and strict-XML-parses it. For a
 * *coding* agent that fails constantly — any message carrying a bare `<`,
 * `&`, an unclosed generic (`Array<string`), a shell redirect or JSX makes
 * the XML parse throw, discarding a perfectly valid tool call that merely
 * shared a message with a code block. This scanner is therefore **lexical**:
 * it finds `<tool_call>` regions by position, JSON-parses *only* a region's
 * contents, never parses the surrounding prose at all, and treats an
 * unparseable region as **one failed call rather than a failed message**.
 * All prompt text below is written from scratch per ADR-016.
 *
 * ## VERIFICATION STATUS — read before trusting the live-model claim
 *
 * Every behavior in this file is unit-tested against captured/templated
 * payloads modeled on the upstream `chat_templates` token layout, streamed
 * through the real `sse.ts` path with tags deliberately split across chunk
 * boundaries. **It has never been run against a live open-weight model**:
 * this environment has no Ollama, no GPU and no weights. The parser is
 * verified; the end-to-end claim "a real Hermes-3 / Qwen / vLLM
 * `--tool-call-parser hermes` deployment drives our tools correctly" is
 * **NOT verified here** and must not be stated as if it were.
 */

const TOOL_CALL_OPEN = "<tool_call>";
const TOOL_CALL_CLOSE = "</tool_call>";
const SCRATCH_PAD_OPEN = "<scratch_pad>";
const SCRATCH_PAD_CLOSE = "</scratch_pad>";
const TOOLS_OPEN = "<tools>";
const TOOLS_CLOSE = "</tools>";
const TOOL_RESPONSE_OPEN = "<tool_response>";
const TOOL_RESPONSE_CLOSE = "</tool_response>";

/**
 * How a provider should speak tools to the model.
 *
 * - `"native"` — OpenAI-shaped `tools` in the request, `delta.tool_calls` in
 *   the response. The historical (and still default) behavior.
 * - `"hermes"` — we own the whole protocol as plain text: tools declared in
 *   the system prompt, no `tools` field on the request, results rendered as
 *   `<tool_response>`. For a server that applies a generic completion
 *   template and has no tool support of its own.
 * - `"auto"` — the request is left exactly as `"native"` builds it, and the
 *   response is *additionally* scanned for Hermes-shaped calls. Purely
 *   receptive: it costs nothing when the model answers natively, and catches
 *   a model that ignores the `tools` field and emits `<tool_call>` instead.
 */
export type ToolProtocol = "native" | "hermes" | "auto";

/** One successfully parsed `<tool_call>` region. */
export interface HermesToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments, matching `ToolCallRequest.argsJson`. */
  argsJson: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse one region's contents (the text between the tags).
 *
 * Strict `JSON.parse` only — deliberately. Upstream falls back to Python's
 * `ast.literal_eval` to salvage single-quoted dict output, but (a) the
 * dominant server-side implementation of this format, vLLM's
 * `--tool-call-parser hermes`, is strict JSON, so strictness is what the
 * ecosystem actually converges on, and (b) shipping an expression evaluator
 * on a path that turns model output into tool invocations is not a trade
 * this project makes. A region that fails to parse is surfaced verbatim
 * rather than dropped (see `HermesStreamParser`), so §4.8's repair loop can
 * ask the model to re-emit it.
 */
export function parseHermesToolCallRegion(raw: string, id: string): HermesToolCall | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const { name, arguments: args } = parsed;
  if (typeof name !== "string" || name.length === 0) return null;

  // `arguments` may arrive as an object (the documented shape), as an
  // already-JSON-encoded string (what the OpenAI wire format uses, and what
  // some Hermes-templated servers copy), or be absent for a no-arg tool.
  let argsJson: string;
  if (typeof args === "string") argsJson = args;
  else if (args === undefined || args === null) argsJson = "{}";
  else argsJson = JSON.stringify(args);

  return { id, name, argsJson };
}

/**
 * Length of the longest suffix of `buf` that is a proper prefix of one of
 * `tags` — i.e. how much trailing text might still turn out to be the start
 * of a tag once the next chunk arrives, and so must not be emitted as text
 * yet. Returns 0 when nothing is pending.
 */
function pendingTagPrefixLength(buf: string, tags: readonly string[]): number {
  let longest = 0;
  for (const tag of tags) {
    const max = Math.min(tag.length - 1, buf.length);
    for (let k = max; k > longest; k--) {
      if (buf.endsWith(tag.slice(0, k))) {
        longest = k;
        break;
      }
    }
  }
  return longest;
}

/** Index of whichever of `needles` occurs first in `hay`, or null. */
function firstIndexOf(hay: string, needles: readonly string[]): { index: number; needle: string } | null {
  let best: { index: number; needle: string } | null = null;
  for (const needle of needles) {
    const idx = hay.indexOf(needle);
    if (idx === -1) continue;
    if (!best || idx < best.index) best = { index: idx, needle };
  }
  return best;
}

type ParserState = "text" | "tool_call" | "scratch_pad";

/**
 * Incremental Hermes extractor for a streamed response.
 *
 * **This part has no upstream reference** — NousResearch's parser is
 * whole-message only. Chunk-boundary handling is ours, and it is the part
 * most likely to harbour bugs, so it is tested with every tag deliberately
 * split across `sse.ts` chunk boundaries.
 *
 * Design decisions worth stating, because each rules out a subtler failure:
 *
 * - **A call is emitted atomically at its closing tag.** `tool_call_start`,
 *   `tool_call_delta` and `tool_call_end` are yielded together once the
 *   region parses. Emitting `start` early (as soon as a `"name"` became
 *   readable) would look nicer in a UI but lets a region that later fails to
 *   parse leave a half-open call behind — `collect()` would hand
 *   `AgentLoop` a tool call with empty arguments, which it would then try to
 *   execute. Never emitting a call we cannot complete is worth more than the
 *   progress indicator.
 * - **Nothing the model wrote is ever silently dropped.** An unparseable or
 *   unterminated region is re-emitted verbatim, tags included, as ordinary
 *   text, and recorded in `malformedRegions`.
 * - **A `<scratch_pad>` is implicitly closed by a `<tool_call>`.** Otherwise
 *   one unclosed reasoning block would swallow every tool call after it.
 * - **A `<tool_call>` is implicitly closed by the next `<tool_call>`**, for
 *   the same reason: one malformed region must not eat the rest of the turn.
 */
export class HermesStreamParser {
  private state: ParserState = "text";
  /** Text seen but not yet classified (may end mid-tag). */
  private buffer = "";
  /** Contents of the region currently open. */
  private region = "";
  private callCounter = 0;
  private readonly malformed: string[] = [];

  constructor(private readonly idPrefix = "hermes_call") {}

  /** Regions that were found but could not be turned into a call. */
  get malformedRegions(): readonly string[] {
    return this.malformed;
  }

  /** How many calls have been successfully emitted so far. */
  get toolCallCount(): number {
    return this.callCounter;
  }

  /** Feed the next chunk of assistant text; returns the deltas it resolves. */
  push(chunk: string): Delta[] {
    const out: Delta[] = [];
    if (chunk.length === 0) return out;

    if (this.state === "text") this.buffer += chunk;
    else this.region += chunk;

    this.drain(out);
    return out;
  }

  /** Flush at end of stream. Anything still open is surfaced, never dropped. */
  end(): Delta[] {
    const out: Delta[] = [];

    if (this.state === "tool_call") {
      // Truncated mid-call (a length cap, a dropped connection). Surface the
      // raw region so the turn is recoverable rather than mysteriously empty.
      this.malformed.push(this.region);
      out.push({ type: "text", text: TOOL_CALL_OPEN + this.region });
      this.region = "";
      this.state = "text";
    } else if (this.state === "scratch_pad") {
      // Reasoning is never user-visible, terminated or not — discarding an
      // unterminated one is the documented behavior, not an oversight.
      this.region = "";
      this.state = "text";
    }

    if (this.buffer.length > 0) {
      out.push({ type: "text", text: this.buffer });
      this.buffer = "";
    }
    return out;
  }

  private drain(out: Delta[]): void {
    // Each iteration resolves one state transition; the loop ends when the
    // remaining buffer cannot be classified without more input.
    for (;;) {
      if (this.state === "text") {
        const hit = firstIndexOf(this.buffer, [TOOL_CALL_OPEN, SCRATCH_PAD_OPEN]);
        if (hit) {
          const before = this.buffer.slice(0, hit.index);
          if (before.length > 0) out.push({ type: "text", text: before });
          this.region = this.buffer.slice(hit.index + hit.needle.length);
          this.buffer = "";
          this.state = hit.needle === TOOL_CALL_OPEN ? "tool_call" : "scratch_pad";
          continue;
        }
        // No tag. Emit everything that cannot still become one.
        const pending = pendingTagPrefixLength(this.buffer, [TOOL_CALL_OPEN, SCRATCH_PAD_OPEN]);
        const emittable = this.buffer.slice(0, this.buffer.length - pending);
        if (emittable.length > 0) out.push({ type: "text", text: emittable });
        this.buffer = this.buffer.slice(this.buffer.length - pending);
        return;
      }

      if (this.state === "tool_call") {
        // A second `<tool_call>` before the close means the first was never
        // terminated — recover instead of swallowing the rest of the turn.
        const hit = firstIndexOf(this.region, [TOOL_CALL_CLOSE, TOOL_CALL_OPEN]);
        if (!hit) return;

        const contents = this.region.slice(0, hit.index);
        const rest = this.region.slice(hit.index + hit.needle.length);

        if (hit.needle === TOOL_CALL_CLOSE) {
          const call = parseHermesToolCallRegion(contents, `${this.idPrefix}_${this.callCounter + 1}`);
          if (call) {
            this.callCounter++;
            out.push({ type: "tool_call_start", id: call.id, name: call.name });
            out.push({ type: "tool_call_delta", id: call.id, argsDelta: call.argsJson });
            out.push({ type: "tool_call_end", id: call.id });
          } else {
            this.malformed.push(contents);
            out.push({ type: "text", text: TOOL_CALL_OPEN + contents + TOOL_CALL_CLOSE });
          }
          this.region = "";
          this.buffer = rest;
          this.state = "text";
          continue;
        }

        // Implicit close: surface the abandoned region, reopen a fresh one.
        this.malformed.push(contents);
        out.push({ type: "text", text: TOOL_CALL_OPEN + contents });
        this.region = rest;
        continue;
      }

      // scratch_pad — swallowed entirely; a `<tool_call>` closes it implicitly.
      const hit = firstIndexOf(this.region, [SCRATCH_PAD_CLOSE, TOOL_CALL_OPEN]);
      if (!hit) return;
      if (hit.needle === SCRATCH_PAD_CLOSE) {
        this.buffer = this.region.slice(hit.index + hit.needle.length);
        this.region = "";
        this.state = "text";
        continue;
      }
      this.region = this.region.slice(hit.index + hit.needle.length);
      this.state = "tool_call";
    }
  }
}

export interface ExtractedHermesMessage {
  /** The message with tool-call regions and scratch-pad reasoning removed. */
  text: string;
  calls: HermesToolCall[];
  /** Region contents that were found but could not be parsed into a call. */
  malformedRegions: string[];
}

/**
 * Whole-message extraction, built on the same streaming parser so the two
 * can never drift apart. Useful for non-streamed responses and for asserting
 * parser behavior directly.
 */
export function extractHermesToolCalls(message: string): ExtractedHermesMessage {
  const parser = new HermesStreamParser();
  const deltas = [...parser.push(message), ...parser.end()];

  let text = "";
  const calls: HermesToolCall[] = [];
  let current: HermesToolCall | null = null;
  for (const d of deltas) {
    if (d.type === "text") text += d.text;
    else if (d.type === "tool_call_start") current = { id: d.id, name: d.name, argsJson: "" };
    else if (d.type === "tool_call_delta" && current) current.argsJson += d.argsDelta;
    else if (d.type === "tool_call_end" && current) {
      calls.push(current);
      current = null;
    }
  }
  return { text, calls, malformedRegions: [...parser.malformedRegions] };
}

/**
 * Declare the available tools the way this format expects: inside
 * `<tools> </tools>` in the **system** prompt, as OpenAI-shaped function
 * schemas.
 *
 * The instruction text is **written from scratch** (ADR-016) — upstream's
 * `prompt_assets/sys_prompt.yml` and the prompt text embedded in their chat
 * templates are study-only, and prompts are copyrightable independently of
 * the code license.
 */
export function buildHermesToolSystemPrompt(tools: ToolSchema[]): string {
  const declarations = tools
    .map((t) => JSON.stringify({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
    .join("\n");

  return [
    "You can call the tools declared below. Their signatures are given as JSON function schemas, one per line:",
    TOOLS_OPEN,
    declarations,
    TOOLS_CLOSE,
    "",
    `To call a tool, emit a ${TOOL_CALL_OPEN} block containing a single JSON object with a "name" key and an "arguments" object, then close it with ${TOOL_CALL_CLOSE}:`,
    TOOL_CALL_OPEN,
    '{"name": "tool_name", "arguments": {"first_argument": "value"}}',
    TOOL_CALL_CLOSE,
    "",
    "Rules:",
    "- Emit one block per call. Several blocks in a turn are allowed when the calls are independent.",
    "- The block must contain only that JSON object — no prose, no code fences, no comments.",
    "- Use only the argument names the schema declares, and do not invent values you were not given.",
    `- A tool's output comes back to you inside ${TOOL_RESPONSE_OPEN} ${TOOL_RESPONSE_CLOSE}. Read it before deciding what to do next.`,
    "- When no tool applies, answer in plain prose and emit no block at all."
  ].join("\n");
}

/** Render a tool result the way this format returns one to the model. */
export function renderHermesToolResponse(content: string): string {
  return `${TOOL_RESPONSE_OPEN}\n${content}\n${TOOL_RESPONSE_CLOSE}`;
}

/** Render an assistant turn's tool calls back into the wire format, for history replay. */
export function renderHermesToolCalls(calls: Array<{ name: string; argsJson: string }>): string {
  return calls
    .map((c) => {
      let args: unknown;
      try {
        args = JSON.parse(c.argsJson);
      } catch {
        args = {};
      }
      return `${TOOL_CALL_OPEN}\n${JSON.stringify({ name: c.name, arguments: args })}\n${TOOL_CALL_CLOSE}`;
    })
    .join("\n");
}

/**
 * Rewrite a normalized request for `"hermes"` protocol mode: tools move into
 * the system prompt, assistant tool calls and tool results become tagged
 * text, and nothing is left for a `tools` request field to carry.
 *
 * Results are returned as a **user**-role message rather than a `tool`-role
 * one on purpose. In this mode we have already assumed the server applies no
 * tool-aware chat template (otherwise it would need a `tools` request field
 * to render `<tools>` at all), so a `tool`-role message would either be
 * rejected for having no matching native call id, or double-wrapped by a
 * template that adds the tags itself. A user turn carrying the tagged text is
 * accepted by every chat endpoint and renders identically.
 */
export function toHermesRequestMessages(request: NormalizedRequest): NormalizedMessage[] {
  const tools = request.tools ?? [];
  const out: NormalizedMessage[] = [];

  if (tools.length > 0) {
    const preamble = buildHermesToolSystemPrompt(tools);
    const firstSystem = request.messages.findIndex((m) => m.role === "system");
    if (firstSystem === -1) {
      out.push({ role: "system", content: preamble });
    } else {
      // Merge into the caller's own system prompt rather than adding a second
      // system turn — some servers only honor the first one.
      const existing = request.messages[firstSystem]!;
      out.push({ role: "system", content: `${existing.content}\n\n${preamble}`.trim() });
    }
    for (let i = 0; i < request.messages.length; i++) {
      if (i === firstSystem) continue;
      out.push(convertHermesMessage(request.messages[i]!));
    }
    return out;
  }

  return request.messages.map(convertHermesMessage);
}

function convertHermesMessage(m: NormalizedMessage): NormalizedMessage {
  if (m.role === "tool") {
    return { role: "user", content: renderHermesToolResponse(m.content) };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    const rendered = renderHermesToolCalls(m.toolCalls);
    return { role: "assistant", content: m.content ? `${m.content}\n${rendered}` : rendered };
  }
  return m;
}
