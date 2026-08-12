# OpenAI Codex CLI — repo note

Clone: `openai/codex` @ `7093e8c`, 2026-08-12. Apache-2.0. Rust-first monorepo `codex-rs/` (~3,847 rust files) + TS `codex-cli/` + `sdk/`. Large; claims scoped to files/dirs actually opened.

## architecture
Rust workspace of many crates: `core` (agent/session), `apply-patch` (edit format), `linux-sandbox`/`windows-sandbox-rs`/`exec-server` (sandboxing), `mcp*` (MCP), `exec` (non-interactive), `cli`, `tui`, `app-server` (a JSON-RPC app server binding). TS CLI wraps the Rust binary.

## runtime model
Native Rust binary; session/turn loop in `core`. Strong systems-level control (why they chose Rust: sandboxing).

## agent loop shape
Turn-based conversation loop; the model emits tool calls incl. `apply_patch` and shell `exec`; results fed back. Approval-policy gating around exec.

## turn/step budgeting
Session-scoped; UNVERIFIED: exact step/token/cost caps not read in full.

## tool system & schemas
Tools exposed to the model incl. `apply_patch` and sandboxed shell exec; MCP client/server crates (`codex-mcp`) let it consume/serve MCP tools. `app-server-protocol` defines a JSON-RPC surface.

## edit format *(high value)*
Bespoke **`apply_patch`** format, crate `codex-rs/apply-patch/`: `parser.rs` (`Hunk`, `UpdateFileChunk`, `parse_patch`), `seek_sequence.rs` (**fuzzy line-seek to locate context**), `streaming_parser.rs` (`StreamingPatchParser` for incremental application), `file_update.rs` (derive new contents; `unified_diff_from_chunks`). `lib.rs` re-exports `maybe_parse_apply_patch*` + `verify_apply_patch_args*`. So: a custom patch grammar with tolerant sequence-seeking + verification of args before apply.

## filesystem access
Via sandboxed executor (`exec-server` `fs_sandbox.rs`, `ExecutorFileSystem`) — fs ops go through a sandbox context.

## shell execution
Sandboxed exec with **approval policy modes** (read-only / workspace-write / danger-full-access) — `cli/src/debug_sandbox.rs`, `exec-server`. The escalation model is the notable part.

## git integration
Works in a repo; UNVERIFIED: worktree specifics not read.

## context management & compaction
UNVERIFIED: not read in depth.

## permission model
**Approval policy + sandbox policy modes** are first-class: the user picks how much freedom exec gets; escalation prompts for more. This is a clean model we echo in §12.2/§12.4.

## sandboxing *(high value)*
Real tiered OS sandbox: macOS **Seatbelt** (`sandbox-exec`, referenced in exec paths); Linux crate `codex-rs/linux-sandbox/src/` with **`landlock.rs`** (Landlock LSM), **`bwrap.rs`** (bubblewrap) + seccomp; **`windows-sandbox-rs`**. `exec-server/src/process_sandbox_tests.rs` tests it. Strongest sandbox among the references.

## model/provider abstraction
OpenAI-centric but supports `model_providers` config incl. OpenAI-compatible base_url; UNVERIFIED: exact OSS/Ollama ergonomics not fully traced (there are references to oss/local paths).

## local & open-weight model support
Present via OpenAI-compatible endpoints; UNVERIFIED: depth/quality of local support not verified by reading.

## config schema
`docs/` config; TOML-based home config (`codex-home` crate). UNVERIFIED: full schema not read.

## memory/persistence
Session state; `agent-graph-store`/`agent-identity` crates suggest richer state; UNVERIFIED.

## workflow/orchestration
`collaboration-mode-templates`, `code-mode*` crates hint at modes; UNVERIFIED.

## subagents
UNVERIFIED: not confirmed by reading.

## testing of the agent itself
Extensive Rust tests incl. sandbox tests (`process_sandbox_tests.rs`, `fs_sandbox.rs`).

## evals/benchmarks
UNVERIFIED.

## observability
`analytics` crate exists; UNVERIFIED on default-on telemetry (relevant to our no-telemetry stance).

## CLI/TUI UX
Rust `tui` crate; polished.

## editor integration
`app-server`/`app-server-protocol` = a JSON-RPC surface an editor could drive (parallels our Agent API idea).

## extensibility/plugins
MCP (client + server crates).

## security model
The strongest of the set: OS sandbox tiers + approval policy. Directly informs §12.

## distribution & install
npm wrapper + prebuilt Rust binary; Bazel/Nix build.

## license
Apache-2.0.

## notable tradeoffs
Rust = best sandbox/perf/single-binary, at the cost of a second language for the TS CLI and a higher contributor bar (a tradeoff we weigh in §19 and decide differently).

## strengths
Sandboxing; apply_patch robustness (streaming + seek); approval-policy model; MCP.

## weaknesses
OpenAI-centric; heavier to contribute to; local-model support less of a focus than ours needs.

## reusable ideas
(1) **Sandbox policy modes** (read-only / workspace-write / full) + escalation — mirrored in §12.2/§12.4; (2) **streaming patch parser + tolerant sequence-seek** as an edit-apply technique (studied, not copied); (3) an **app-server JSON-RPC** boundary for editors (parallels §18.1); (4) **verify-args-before-apply** for patches.

## explicitly do-not-copy
The `apply-patch` *code* and Seatbelt/Landlock policy strings are **CLEAN-ROOM-REQUIRED** (LICENSE §3) — reimplement from OS docs, don't lift. Any default-on `analytics` — we ship none (§19/ADR-013).
