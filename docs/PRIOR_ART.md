# Prior Art & Attribution

Per `LICENSE_AND_REUSE_ANALYSIS.md §3` and ADR-014/ADR-016, ClutchCode's
implementation is clean-room: no third-party source or prompt text is
copied. This document records, per subsystem, which reference project's
*publicly documented behavior* informed the design, so provenance is
auditable.

| Subsystem | Idea studied from | What we took | What we did NOT take |
|---|---|---|---|
| SEARCH/REPLACE edit format + apply cascade | Aider (`editblock_coder.py`, studied via its published behavior/docs — see `research/repos/aider.md`) | The `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` interchange convention (a de facto standard, not protectable) and the *shape* of a match cascade (exact → whitespace-tolerant → blank-line-drop → explicit elision, no fuzzy step) | Aider's source code; its fuzzy-matcher (deliberately excluded, "no fuzzy apply" learned lesson, ADR-002) |
| Tool-call text protocol for models without native tool calling | Cline's XML tool protocol (behavior studied via `research/repos/cline.md`) | The idea of a single strict action-block-per-turn text protocol | Cline's source, its exact XML schema/prompt text |
| Explicit resumable run state | OpenHands' `AgentController` / `State` object (behavior studied via `research/repos/openhands.md`) | The idea that agent state should be a first-class, persisted, resumable object | OpenHands' source, its Action/Observation class hierarchy |
| Workflow stage concept | Archon (behavior studied via `research/repos/archon.md`) | The idea of explicit, inspectable, resumable task/stage state | Archon's source (a knowledge-base/task service, not a code editor) |
| Tiered OS sandbox | Codex's Seatbelt/Landlock/bwrap usage (behavior studied via `research/repos/codex-cli.md`) | The idea of tiering OS sandbox primitives with Docker as an optional stronger tier, not the default | Codex's source, its exact policy strings |
| PageRank repo map (Phase 7, not Phase 1) | Aider's `repomap.py` (behavior studied) | The idea of ranking symbols via PageRank over an import/symbol graph | Aider's source |
| Landlock rung of the Tier-1 sandbox (§12.6) | DeepSeek Harness `native/landlock-run` + `sandbox-local` (behavior studied via `research/repos/deepseek-harness.md`) | Nothing copied — the **published npm package is consumed as a dependency** (`@deepseek-ai/node-addon-landlock-run`, BSD-3-Clause), plus the *architectural* idea that a Landlock launcher should self-restrict-then-`exec` and fail closed | Their `sandbox-local` provider source, their argv/grant construction, their runner-classification code, and the C source itself (never vendored) |
| Sandbox runner-failure classification (§12.6) | DeepSeek Harness postmortem 0004 (published incident writeup) | The *lesson only*: runner failure must be **status-gated** evidence (a specific exit code **and** a fatal line, with exact informational lines excluded), never a substring bag — and that stderr is an in-band channel a confined child can forge | Their `RunnerFailureRule` type, signature lists, or any classification code — ours is written from our own `ToolResult`/`classifyFailure` shapes |
| ACP editor binding (§18.1) | The open **Agent Client Protocol** spec + official `@agentclientprotocol/sdk`; DeepSeek Harness `packages/acp` studied as a working consumer | The **protocol itself** — this is conformance to an open spec, the same verdict as MCP, not a clean-room case | DeepSeek's ACP server implementation, its bridge/codec internals, and its Cordis service wiring |
| Tool-result pruning as a distinct compaction stage (§4.5) | DeepSeek Harness `compaction-tool-result-pruner` behind a `ctx.toolResultPruner` seam (behavior studied) | The idea that pruning *tool results* is a cheaper, earlier lever than compacting conversation history wholesale | Their pruner implementation, heuristics, and seam/DI structure |
| Provider stop/finish-reason conformance surface (§4.7) | `@earendil-works/pi-ai` (behavior studied via `research/repos/pi-agent-harness.md`); each case then verified against the **provider's own** published API documentation | The *enumeration of edge cases* a provider adapter must handle (`pause_turn`, `aborted`, `content_filter`, `refusal`, …) — a fact about third-party APIs, not their expression — used to drive our own table-driven conformance tests | pi-ai's adapter source, its mapping functions, its faux provider, and its dependency set |

Rule of thumb enforced by code review: **patterns in, expression out.** If a
PR's diff is close enough to a reference project's source that it reads as a
derivative, it is rejected regardless of license compatibility. Every
*codebase* above is "STUDY-ONLY" per `LICENSE_AND_REUSE_ANALYSIS.md §2`; the
two exceptions in the table are not codebases — **open protocols** (MCP, ACP)
which are meant to be implemented, and one **npm dependency consumed, never
vendored** (`@deepseek-ai/node-addon-landlock-run`), which is governed by
`LICENSE_AND_REUSE_ANALYSIS.md §2a` rather than the clean-room rules — adding a
dependency is not reusing its source.
