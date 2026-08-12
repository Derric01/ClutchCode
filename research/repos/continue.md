# Continue — repo note (Tier-2: model routing & config schema)

Clone: `continuedev/continue` @ `5522c6f`, 2026-08-12. Apache-2.0. TypeScript. **Verified:** `core/` with subdirs `llm`, `config`, `indexing`, `autocomplete`, `context`, `edit`, `nextEdit`, `commands`, `diff`; a `binary/` (headless core); and a **`CLA.md`** (uses a CLA). Structure-derived + prior art.

## architecture
An IDE-integrated assistant (VS Code + JetBrains) with a **shared `core`** consumed by editor extensions and a headless `binary` — a core/clients split like ours. Focus areas: chat, autocomplete, edit, and `nextEdit`.

## runtime model
`core` runs in-process in the extension or as a headless binary; editors are clients.

## agent loop / edit format
Edit + `nextEdit` modules; autocomplete pipeline; more assistant-than-autonomous-agent historically. Details UNVERIFIED.

## tool system
Context providers + tools; MCP support. `context/` is a first-class subsystem.

## model/provider abstraction & routing *(the reason to study it)*
`core/llm` supports many providers incl. local (Ollama/LM Studio/OpenAI-compat). Continue's **config-driven model selection/routing** (per-role models: chat vs autocomplete vs edit vs embed) is the notable idea — informs our capability-aware per-role model config (§4.6/§4.7).

## config schema *(high value)*
Rich, documented config (models, context providers, slash commands, rules) — a mature schema to study for our §19 config decision. Historically JSON/YAML/TS config.

## indexing
`core/indexing/` — includes embeddings-based codebase retrieval (a counterpoint we weigh in §9; Continue is more RAG-forward than we choose to be).

## memory
Rules/prompt files; `AGENTS.md`/`.continuerules`-style conventions.

## editor integration
Deep VS Code + JetBrains; core/clients split.

## license / contributor model
Apache-2.0 **but uses a CLA** (`CLA.md`) — a contrast to our **DCO** choice (LICENSE §4); Continue is a company-led project where a CLA fits their model; ours deliberately avoids the capture signal.

## strengths
Mature multi-provider routing + config schema; deep editor integration; core/clients split; autocomplete.

## weaknesses (for our design)
More assistant/autocomplete than verification-first autonomous agent; RAG-forward indexing (dependency weight we avoid by default, §9); CLA friction.

## reusable ideas
(1) **Per-role model config/routing** (chat/edit/embed) → §4.6; (2) a **mature config schema** to learn from → §19; (3) **core + multi-editor clients** → §18.1.

## explicitly do-not-copy
The **CLA** contributor model (we use DCO, §4 of license analysis); **embeddings-by-default** indexing (§9). Reimplement studied patterns clean-room.
