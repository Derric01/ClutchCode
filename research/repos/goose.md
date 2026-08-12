# Goose (Block) — repo note (Tier-2: extensibility / MCP model)

Clone: `block/goose` @ `88709b2`, 2026-08-12. Apache-2.0. Rust. **Verified crates** (`goose/crates/…` → top-level crate dirs): `goose`, `goose-cli`, `goose-mcp`, `goose-providers`, `goose-provider-types`, `goose-context-management`, `goose-local-inference`, `goose-acp-macros`, `goose-sdk`, `goose-download-manager`. Claims are structure-derived + prior art.

## architecture
Rust agent with a **strongly MCP-centric extension model** — capabilities are added as MCP "extensions." Crate split shows deliberate seams: providers, provider-types, context-management, local-inference, mcp, acp.

## agent loop / runtime
Native Rust; tool-use loop where tools come from MCP extensions. `goose-cli` is the terminal entry.

## tool system & schemas *(the reason to study Goose)*
**MCP is first-class**, not an add-on: `goose-mcp` + extensions. New tools = new MCP extensions, no core change — the cleanest realization of "MCP as the third-party boundary" (our §11.2/ADR-017).

## edit format / fs / shell
Via MCP extensions (developer extension provides fs/shell/edit). Details UNVERIFIED.

## context management
Dedicated `goose-context-management` crate — a named subsystem (parallels our §10 compaction). UNVERIFIED internals.

## model/provider abstraction & local support *(high value)*
`goose-providers` + `goose-provider-types` (formats incl. databricks, openai, etc.) + **`goose-local-inference`** — explicit local-model support as its own crate. Confirms local-first is a served need.

## editor / ACP
`goose-acp-macros` — **ACP support** (third project after OpenHands canvas + our target). Reinforces ACP as the editor/agent boundary (§18.5).

## config / memory / observability
TOML config; UNVERIFIED depth.

## security/sandbox
UNVERIFIED; permission prompts around tool use.

## distribution
Rust binary + installer; desktop app.

## license
Apache-2.0.

## strengths
Cleanest MCP-extension architecture; explicit local-inference + provider-types seams; ACP.

## weaknesses (for our design)
Rust (second-language cost for a VS Code extension — the tradeoff we decide differently, §19); depth of verification/sandbox UNVERIFIED.

## reusable ideas
(1) **MCP-as-core-extension-boundary** with clean provider/context crates (§11.2); (2) a **dedicated local-inference module** (validates §4.10); (3) **ACP** convergence (§18.5).

## explicitly do-not-copy
Rust-core assumption (conflicts with our shared-TS-runtime dual-interface decision, §19). Reimplement any studied pattern clean-room (Apache-2.0 + our policy).
