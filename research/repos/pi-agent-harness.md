# pi agent harness (`@earendil-works`) — repo note (Tier-1: mature provider layer, already a shared dependency)

Clone: `Derric01/pi_coding_agent` @ `f13e6a8` (2026-05-09), a **fork** of the upstream pi agent harness — `LICENSE` is **MIT, © 2025 Mario Zechner**, and `README.md`/`package.json` identify it as `pi-monorepo` publishing `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` (<https://pi.dev>). TypeScript, ~662 src files, packages: `agent`, `ai`, `coding-agent`, `tui`, `web-ui`. **Verified structure** (cloned at the live remote HEAD and read, not inferred).

**Provenance note, stated because it changes the verdict:** this was initially assumed to be first-party work by this project's author. It is not — it is a fork of a third party's MIT project, so the ordinary §2 STUDY-ONLY default applies in full, exactly as it does to Aider or opencode. The one exception is the *published npm package* `@earendil-works/pi-ai`, which is a dependency question under §2a rather than a copying question.

**Cross-signal worth recording:** the DeepSeek Harness note (`deepseek-harness.md`, same research round) lists a `llm-pi-ai` package in its capability-seams graph — i.e. DeepSeek's harness *depends on this same `@earendil-works/pi-ai`* for its LLM adapter seam. Two independently-built, serious harnesses converging on one provider library is a stronger signal about that library than either project alone.

## architecture
Conventional TS monorepo (npm, biome, husky, vitest) — no DI container, unlike DeepSeek Harness. Clean split: `ai` (provider transport) → `agent` (runtime, tool calling, state) → `coding-agent` (the CLI product) → `tui`/`web-ui` (front-ends). That layering is close to ours (`providers` → `runtime` → `agent-api` → `cli`/`vscode`), independently arrived at.

## runtime model
`@earendil-works/pi-agent-core` is "agent runtime with tool calling and state management." Self-described as a **self-extensible** coding agent: `.pi/extensions/*.ts` are user-dropped TypeScript extensions loaded by the running agent (`docs/extensions.md`), and `.pi/prompts/*.md` are short prompt templates invoked by name — the same shape as our project skills, but agent-loaded at runtime rather than harness-loaded.

## agent loop / tools / edit format
`packages/agent` + `packages/coding-agent`. Documented surface includes `docs/compaction.md`, `docs/session-format.md`, `docs/rpc.md`, `docs/sdk.md`, `docs/custom-provider.md`, `docs/keybindings.md`. Their test convention is notable and matches ours: `test/suite/harness.ts` plus a **faux provider** (`packages/ai/src/providers/faux.ts`), with the standing rule "do not use real provider APIs, real API keys, or paid tokens" — an independent arrival at our `FakeProvider` discipline. Regressions are filed as `test/suite/regressions/<issue-number>-<slug>.test.ts`.

## model/provider abstraction *(the reason to study this repo)*
`@earendil-works/pi-ai` — "Unified LLM API with automatic model discovery and provider configuration," **v0.84.2 on npm, 41 published versions, MIT** (verified against `registry.npmjs.org`). Provider adapters: `anthropic`, `openai-completions`, `openai-responses`, `openai-codex-responses`, `azure-openai-responses`, `google`, `google-vertex`, `amazon-bedrock`, `mistral`, `cloudflare`, `github-copilot-headers`, plus `faux`. Also carries `oauth.ts`, `env-api-keys.ts`, `api-registry.ts`, `session-resources.ts`, and a **generated model catalog** (`models.generated.ts`, produced by `scripts/generate-models.ts` and never hand-edited — an enforced rule in their `AGENTS.md`).

Its stop/finish-reason vocabulary is materially wider than ours: `stop`, `end_turn`, `stop_sequence`, `max_tokens`, `length`, `tool_use`, `tool_calls`, `refusal`, `content_filter`, **`pause_turn`**, **`aborted`**, and a not-yet-in-SDK-types `sensitive` category mapped to error.

## storage
`docs/session-format.md` documents an on-disk session format; `.jsonl` files present. Not read in depth this pass — UNVERIFIED.

## config
`.pi/` directory convention (extensions, prompts, per-tool gitignores). `docs/settings.md`, `docs/models.md`, `docs/providers.md`.

## CLI/TUI UX
`packages/tui` (terminal) and `packages/web-ui` — both front-ends over the same core, same bet as our Agent API (§18.1). Fully configurable keybindings are an enforced rule in their `AGENTS.md` ("Never hardcode key checks … All keybindings must be configurable").

## editor integration
`docs/rpc.md` + `docs/sdk.md` — an RPC surface and an embeddable SDK. Not read in depth; relevant to §18.1 but the ACP row (see `deepseek-harness.md`) is the stronger lead there.

## security/sandbox
Not a focus of this repo as far as the structure shows — no sandbox package. Our §12 story is stronger; nothing to take here.

## license
**MIT, © 2025 Mario Zechner** (the fork carries the upstream LICENSE unchanged). Apache-2.0-compatible. `@earendil-works/pi-ai` is MIT on npm as well.

## strengths
A mature, single-purpose, widely-consumed provider abstraction with far broader provider coverage and a wider error/stop vocabulary than ours; a generated model catalog; a faux-provider test discipline matching our own; genuinely good agent-development rules in `AGENTS.md`.

## weaknesses (for our design)
`pi-ai`'s dependency footprint is heavy — `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `@mistralai/mistralai`, `undici`, `proxy-agent`, `partial-json`, `zod-to-json-schema`, `typebox`. That is a poor fit for a project that hand-assembled a seccomp BPF filter in TypeScript specifically to avoid adding one runtime dependency (§12.6), and it would pull three cloud-vendor SDKs into a local-first tool (§17). Its provider set is also broader than §4.7 needs. The parent repo auto-closes issues/PRs from new contributors by default, so upstream engagement is not a realistic path for us.

## reusable ideas
1. **Use `pi-ai` as a differential *conformance oracle*, not a dependency.** Its stop-reason vocabulary is a ready-made checklist for the exact defect class round 3 found six instances of in our own adapters (streams ending without a terminal chunk silently reported as a normal `"stop"`; `content_filter`/`refusal` falling through to `default`). Extract the *list of cases* — expression stays ours — and add a table-driven conformance test per adapter. This targets our proven-weakest area at zero dependency cost.
2. **`pause_turn` is in their vocabulary and absent from ours** — see the "what's left" row this note generated. Real, latent, currently unreachable.
3. **A generated model catalog complements, not replaces, the §4.9 capability probe.** We probe because we do not know a model's context window / capabilities a priori and fall back to provider defaults (ADR-015). A catalog for *known hosted* models plus probing for *unknown/local* ones is strictly better than probing everything, and their "generator script is the source of truth, never edit the generated file" rule is the right way to keep it honest.
4. **Regression-test naming by issue number** (`<issue>-<slug>.test.ts`) — a cheap convention that makes "which bug does this test pin?" answerable at a glance.

## explicitly do-not-copy
Do **not** vendor `pi-ai` source or port its adapters — MIT still means STUDY-ONLY under §2, and our adapters are already written and tested. Do not adopt its dependency set (see weaknesses). Do not copy provider adapter code, the faux provider, or prompt/extension text. Taking the *enumeration of protocol edge cases* is taking a fact about third-party APIs (Anthropic's and OpenAI's own documented stop reasons), not their expression — and the authoritative source for each case should be the provider's own documentation, which is where the `pause_turn` semantics below were actually verified.
