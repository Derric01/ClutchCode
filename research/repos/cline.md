# Cline — repo note

Clone: `cline/cline` @ `a56af4e`, 2026-08-12. Apache-2.0. TypeScript (~2,774 src files). **VS Code extension coding agent — highest-value reference for our editor integration.** **Clone reality (verified):** monorepo with `apps/` (the VS Code app at `apps/vscode/src`, per partial sub-agent read) — a newer layout than older docs assume. Detailed file-line claims below are **partly prior-art / partial-read** and flagged; structure is from this clone.

## architecture
VS Code extension: a webview UI (React) + an extension-host "core" that runs the agent loop, talks to providers, and drives editor APIs (diff view, terminals). Monorepo `apps/` + shared packages.

## runtime model
Runs inside the VS Code extension host (Node). Single agent, human-in-the-loop.

## agent loop shape
Recursive request loop: model streams a message → parse assistant message into text + tool tags → execute one tool (with approval) → feed result → continue. Plan/Act modes separate read-only planning from editing.

## turn/step budgeting
Conversation-scoped; context-window management (below). UNVERIFIED: hard step/cost caps.

## tool system & schemas *(high value: tool-call emulation)*
**XML-style text tool protocol**, not native function-calling: the model emits tags like `<read_file>`, `<write_to_file>`, `<replace_in_file>`, `<execute_command>`, `<ask_followup_question>`, parsed by an assistant-message parser. This is a strong reference for **driving models without native tool calling** (our §4.8), and for robust streaming tag parsing.

## edit format
`<write_to_file>` = whole-file; `<replace_in_file>` = **SEARCH/REPLACE diff blocks** applied by a `constructNewFileContent`-style routine with exact + tolerant matching and failure handling (prior-art/partial). Same family as Aider's editblock.

## filesystem access / shell execution
VS Code fs APIs; a `TerminalManager` integrates real VS Code terminals for `execute_command` (captures output, handles long-running).

## git integration
**Checkpoints via a "shadow git"**: snapshots the workspace so the user can revert agent changes per step (a resilience feature we generalize to worktree isolation, §13). Not per-run worktree branches.

## context management & compaction
Context-window truncation/condensation as the conversation grows; `@`-mentions and file context injection; environment details block.

## permission model *(high value)*
Human-in-the-loop **approval per tool**, with **auto-approve** settings (per-tool allowlists, max requests) — a direct study for our approval UX + fatigue avoidance (§18.3) and policy engine (§12.2).

## sandboxing
None beyond approval; runs with the user's permissions in the editor.

## model/provider abstraction *(high value)*
Many providers incl. Anthropic, OpenAI, OpenRouter, Bedrock, Vertex, **Ollama, LM Studio** — broad local support. Confirms OpenAI-compat + native-local is the right coverage (§4.7).

## config schema
VS Code settings + extension state; per-provider config.

## memory/persistence
Task history + checkpoints; `.clinerules` / `AGENTS.md` (clone has `AGENTS.md`) for project rules.

## workflow/orchestration
Plan vs Act modes; no heavy workflow engine.

## subagents
Not a core multi-agent system (some forks add modes).

## testing of the agent itself
Extension e2e + unit; UNVERIFIED depth.

## evals/benchmarks
Community-driven; no canonical published leaderboard like Aider's.

## observability
In-UI transcript; token/cost display.

## CLI/TUI UX
N/A — it is editor-native (no terminal CLI). (Contrast: we do both, §18.)

## editor integration *(the key section for us)*
Deep VS Code integration: **DiffViewProvider** (native diff review in-editor), terminal integration, webview UI, `@`-file mentions, checkpoints. This is the model for our VS Code extension (§18.5) — but we invert the architecture: our agent logic lives in a **shared runtime behind the Agent API**, and the extension is a thin client, whereas Cline's agent logic lives inside the extension. Ours keeps CLI + editor in one runtime.

## extensibility/plugins
MCP support (`src/services/mcp`) — servers add tools.

## security model
Approval-based; untrusted-repo risk handled by human gate, not sandbox.

## distribution & install
VS Code Marketplace / OpenVSX.

## license
Apache-2.0.

## strengths
Best-in-class VS Code UX; robust XML tool protocol (great for weak models); broad providers incl. local; checkpoints.

## weaknesses (for our design)
Agent logic coupled to the extension (no shared CLI runtime); no OS sandbox; no verification-as-gate / cheat detection; no per-run git worktree.

## reusable ideas
(1) **XML text tool protocol + streaming parser** → our tool-call emulation (§4.8); (2) **auto-approve/allowlist UX** → §18.3/§12.2; (3) **in-editor native diff review** → §18.5; (4) **checkpoints** → generalized to worktree isolation (§13). Divergence to study: Roo/Kilo forks add mode/persona systems.

## explicitly do-not-copy
Don't couple agent logic to the editor (we use a shared runtime + Agent API). Apache-2.0 permits reuse with attribution, but per policy the tool-parser/diff code is **reimplemented clean-room** (LICENSE §3). No sandbox = not safe for untrusted-repo autonomy; we add §12.
