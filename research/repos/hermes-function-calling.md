# Hermes Function Calling (NousResearch) — repo note (Tier-1: the de-facto open-weight tool-call format)

Studied at `ea3c472` (2025-12-22), ~848K, MIT © 2024 Nous Research.
Upstream: <https://github.com/NousResearch/Hermes-Function-Calling>

## why this repo matters to us

Not for its agent loop — it does not have one worth borrowing. It matters
because it defines the **wire format that most open-weight models now emit
when they call a tool**, and `@clutchcode/providers` currently cannot read
that format at all. vLLM ships `--tool-call-parser hermes`; llama.cpp,
SGLang and a long tail of Ollama modelfiles emit the same shape. Any local
model speaking it is, to us today, emitting plain prose.

## the format

Tools are declared in the **system** prompt inside `<tools> </tools>`, as
OpenAI-shaped function-schema JSON. A call is emitted as XML-tagged JSON:

    <tool_call>
    {"name": "get_stock_fundamentals", "arguments": {"symbol": "TSLA"}}
    </tool_call>

Results are returned to the model inside `<tool_response> </tool_response>`.
Multiple calls per turn are explicitly allowed ("You may call one or more
functions"). Hermes-3 adds an optional `<scratch_pad> </scratch_pad>`
reasoning block (a GOAP frame: Goal / Actions / Observation / Reflection)
emitted *before* the tool calls — so a parser must tolerate and strip it
rather than choke on it or leak it into user-visible output.

## runtime model / agent loop

`functioncall.py` runs a recursive loop with a `max_depth` bound. On a
parse or schema-validation failure it does **not** abort: it feeds the
error back to the model as a `<tool_response>` containing the traceback
plus "Please call this function again with correct arguments". That is a
sound instinct and maps onto machinery we already have (§14's repair
loop) — worth noting as convergent evidence, not as something to import.

## the thing most worth learning — their parser is fragile, and we must not copy it

`utils.py::validate_and_extract_tool_calls` wraps the **whole assistant
message** in a synthetic `<root>` element and runs it through a strict XML
parser (`ET.fromstring`), then walks `.//tool_call`.

For their demo domain (stock quotes, weather) that holds. For **a coding
agent it would fail constantly**: our assistant messages routinely contain
prose and code with bare `<`, `>` and `&`, unclosed generics like
`Array<string`, shell redirects, and JSX — every one of which makes a
strict XML parse of the surrounding text throw, discarding a
perfectly-valid tool call that happened to share a message with a code
block. This is a genuine design lesson from reading it, and it inverts the
obvious "just port their extractor" instinct.

**Our approach must instead:** scan for `<tool_call>` … `</tool_call>`
regions lexically, parse *only* the region contents as JSON, never
XML-parse the surrounding prose, and treat an unparseable region as one
failed call rather than a failed message.

## license

**MIT**, © 2024 Nous Research — permissive, attribution-only, compatible
with our Apache-2.0. Legally we *may* copy code. See the reuse verdict in
`LICENSE_AND_REUSE_ANALYSIS.md`: the **format** is a protocol and is
REUSE-eligible (same posture as MCP/ACP); their **implementation** is not
worth reusing on merit, per the fragility above. Their **system prompt
text is not to be copied** — ADR-016 requires our prompts be written from
scratch, and prompts are copyrightable regardless of the code license.

## strengths

- A real, widely-adopted standard with independent implementations to
  cross-check against (vLLM's parser, the published chat templates).
- Chat templates (`chat_templates/*.j2`) document the exact token layout
  per family — useful as a *specification* to test our parser against.
- `<scratch_pad>` shows the format anticipates reasoning-before-calling,
  which fits our planning heuristic rather than fighting it.

## weaknesses (for our design)

- XML-root parsing, as above — unusable for our content domain.
- No streaming story: the reference parser is whole-message only. We
  stream (`sse.ts`, `tool_call_start`/`_delta`/`_end`), so incremental
  extraction across chunk boundaries is **our** problem to solve and has
  no reference here.
- Python/Pydantic-centric; nothing transferable at the code level.

## reusable ideas

1. The format itself (tag names, JSON shape, `<tools>` declaration site).
2. Feeding parse/validation errors back as a tool result instead of
   failing the turn — convergent with §14, cite as corroboration.
3. Their chat templates as **test fixtures** for our parser: real token
   layouts we can assert against without a live model.

## explicitly do-not-copy

- `utils.py`'s XML-root extraction (fragile — see above).
- `prompt_assets/sys_prompt.yml` and any README prompt text (ADR-016).
- `functioncall.py`'s loop — we have our own, better-bounded one.
