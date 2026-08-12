# opencode (sst) — repo note (Tier-2: TUI-first, provider-agnostic)

Clone: `sst/opencode` @ `521906f`, 2026-08-12. MIT. TypeScript (~3,291 src files) + a Go TUI. **Verified structure:** monorepo dirs incl. `core`, `cli`, `client`, `codemode`, `desktop`, `console`, `containers`, `effect-drizzle-sqlite`, many translated READMEs. Structure-derived + prior art.

## architecture
Provider-agnostic coding agent with a **client/server split**: a `core`/server exposes an API; clients include a **Go TUI** and others. Uses **Effect** (TS effect system) + **Drizzle + SQLite** (`effect-drizzle-sqlite`) for storage. `containers/` suggests optional container execution.

## runtime model
Server (TS/Node, Effect) + thin clients (TUI in Go) — a **client/server boundary** very close to our Agent-API idea (§18.1), validating that shape.

## agent loop / tools / edit format
Tool-use loop; provider-agnostic; edit via search/replace-family. Details UNVERIFIED.

## model/provider abstraction *(high value)*
Explicitly **provider-agnostic** (many providers incl. local via OpenAI-compat/Ollama). Reinforces §4.7.

## storage
**SQLite via Drizzle** — validates our SQLite choice (§19/ADR-007) for a local-first tool.

## config
JSON/TS config; per-provider. UNVERIFIED schema.

## CLI/TUI UX *(the reason to study it)*
**TUI-first ergonomics** with a clean server/client separation, so multiple front-ends (TUI, desktop, editor) share one core — the same architectural bet we make (§18), independently arrived at.

## editor integration
`desktop` + `client` packages; client/server API makes editor clients feasible.

## security/sandbox
`containers/` optional; UNVERIFIED default posture.

## license
MIT.

## strengths
Clean **core/server + multi-client** architecture; provider-agnostic; SQLite; polished TUI.

## weaknesses (for our design)
Effect adds a learning curve for contributors; verification/cheat-detection not a focus (UNVERIFIED); mixed TS+Go increases surface.

## reusable ideas
(1) **core/server + thin clients** (validates our Agent API + CLI/TUI/VS Code clients, §18.1); (2) **SQLite via a typed query layer** (§19); (3) **provider-agnostic from day one** (§4.7).

## explicitly do-not-copy
Don't mandate Effect or a Go TUI (contributor-supply cost); keep one language for the shared runtime (§19). Reimplement studied patterns clean-room (MIT + policy).
