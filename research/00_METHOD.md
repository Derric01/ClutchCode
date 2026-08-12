# 00 — Research Method & Provenance

**Project:** ClutchCode — model-agnostic, local-first coding-agent runtime
**Phase:** 0 (Research & Specification only — no implementation)
**Research window:** 2026-08-11 → 2026-08-12 (clones dated 2026-08-12 UTC)
**Author:** lead systems architect (agent), synthesizing from primary source reads.

---

## 1. What I did

1. Verified every reference URL in the prompt with `git ls-remote` before cloning. Recorded the finding that **`xai-org/grok-cli` does not exist** (see §4 below); substituted the community `superagent-ai/grok-cli`.
2. Cloned each verified repo shallow (`--depth 1`) into `/tmp/agent-research/repos/` — **outside** the ClutchCode repo tree. Nothing third-party enters our git history. Confirmed: our repo root contains only `README.md` + `research/`.
3. Recorded per repo: clone date, commit SHA, primary language, source-file magnitude, license + license-file SHA-256.
4. Read, by hand, the six highest-signal files per key repo (tool defs, system prompt(s), main loop, edit/diff application, permission/sandbox, provider adapters, config schema) for the three deepest targets (Aider, Codex, Claude Code), and delegated breadth reads of the remaining repos to parallel sub-agents that wrote `research/repos/*.md` against a fixed extraction schema.
5. Wrote all comparative/cross-cutting analysis and the final `PROJECT_SPEC.md` in a single synthesizing pass (no sub-agent authored a comparison section).

## 2. What I could NOT access / verify (honesty log)

- **Claude Code source code** — NOT PRESENT. The public `anthropics/claude-code` repo contains **no agent source**: only docs, markdown-based plugins (`plugins/**`), `examples/` (hooks, settings, MDM, gateway), a `CHANGELOG.md`, and issue-management scripts. The actual CLI ships as a **minified npm bundle** (`@anthropic-ai/claude-code`), which I did not decompile. All Claude Code architectural claims are therefore from: (a) the readable plugin/agent/hook markdown artifacts in the repo, (b) `CHANGELOG.md` and `SECURITY.md`, (c) published Anthropic documentation and observable behavior. Marked `UNVERIFIED:` wherever a claim would require reading the bundle. License is **proprietary** (Anthropic Commercial ToS) — this is not an open-source project.
- I did not run any of the agents against live model APIs (no eval numbers of my own were generated; benchmark numbers cited are the projects' own published figures, marked as such).
- I did not exhaustively read every file in large repos (Codex ≈3,847 source files, opencode ≈3,291, cline ≈2,774). Claims are scoped to files actually opened, cited as `path:Lstart-Lend`.

## 3. Reference repo inventory (clone date 2026-08-12)

| Repo (dir) | GitHub | Commit SHA | Primary lang | Source files* | License | License SHA-256 (prefix) |
|---|---|---|---|---|---|---|
| aider | Aider-AI/aider | `5dc9490` | Python | ~151 | Apache-2.0 | `cfc7749b…` |
| codex | openai/codex | `7093e8c` | Rust (+TS cli) | ~3,847 | Apache-2.0 | `d17f227e…` |
| claude-code | anthropics/claude-code | `681a8be` | (docs/plugins only) | ~26 (scripts) | **Proprietary** | n/a (Anthropic ToS) |
| openhands | All-Hands-AI/OpenHands | `2e7136c` | Python (+TS UI) | ~1,765 | MIT | (see LICENSE_AND_REUSE) |
| cline | cline/cline | `a56af4e` | TypeScript | ~2,774 | Apache-2.0 | (see LICENSE_AND_REUSE) |
| archon | coleam00/Archon | `21b4703` | Python + TS | ~858 | MIT | (see LICENSE_AND_REUSE) |
| goose | block/goose | `88709b2` | Rust | (see repo note) | Apache-2.0 | (see LICENSE_AND_REUSE) |
| opencode | sst/opencode | `521906f` | TypeScript (+Go tui) | ~3,291 | MIT | (see LICENSE_AND_REUSE) |
| crush | charmbracelet/crush | `804324f` | Go | (see repo note) | (see note) | (see LICENSE_AND_REUSE) |
| continue | continuedev/continue | `5522c6f` | TypeScript | (see repo note) | Apache-2.0 | (see LICENSE_AND_REUSE) |
| swe-agent | SWE-agent/SWE-agent | `3ea751c` | Python | (see repo note) | MIT | (see LICENSE_AND_REUSE) |
| roo-code | RooCodeInc/Roo-Code | `b867ec9` | TypeScript | (see repo note) | Apache-2.0 | (see LICENSE_AND_REUSE) |
| kilocode | Kilo-Org/kilocode | `f711547` | TypeScript | (see repo note) | Apache-2.0 | (see LICENSE_AND_REUSE) |
| gptme | gptme/gptme | `fce2fbe` | Python | (see repo note) | MIT | (see LICENSE_AND_REUSE) |
| smolagents | huggingface/smolagents | `e3a5b89` | Python | (see repo note) | Apache-2.0 | (see LICENSE_AND_REUSE) |
| grok-cli | superagent-ai/grok-cli | `fb97af8` | TypeScript | (see repo note) | MIT | (see LICENSE_AND_REUSE) |
| gemini-cli | google-gemini/gemini-cli | `1ac3377` | TypeScript | (see repo note) | Apache-2.0 | (see LICENSE_AND_REUSE) |

*Source files = count of `.py/.ts/.tsx/.rs/.go` files (rough magnitude, not exact LOC).

**Prior-art repos read for docs/design, not adopted as code sources:**
`SWE-bench/SWE-bench` (`f5daed8`, harness design), `laude-institute/terminal-bench` (`d28711d`), `modelcontextprotocol/modelcontextprotocol` (`5947545`, MCP spec).

## 4. URL verification results

| Prompt URL | Status | Note |
|---|---|---|
| anthropics/claude-code | EXISTS | Docs/plugins only; no agent source; proprietary license |
| openai/codex | EXISTS | Renamed from `codex-cli`; now Rust-first monorepo |
| Aider-AI/aider | EXISTS | Correct |
| All-Hands-AI/OpenHands | EXISTS | Correct (formerly OpenDevin) |
| cline/cline | EXISTS | Correct |
| coleam00/Archon | EXISTS | Correct |
| **xai-org/grok-cli** | **DOES NOT EXIST** | No such repo/org path. `xai-org/grok-build` also absent. Substituted community `superagent-ai/grok-cli` and marked all xAI-CLI claims as community-tool, not official. |

## 5. Extraction schema (identical headings in every `repos/*.md`)

architecture · runtime model · agent loop shape · turn/step budgeting · tool system & schemas · **edit format** · filesystem access · shell execution · git integration · context management & compaction · permission model · sandboxing · model/provider abstraction · **local & open-weight model support** · config schema · memory/persistence · workflow/orchestration · subagents · testing of the agent itself · evals/benchmarks · observability · CLI/TUI UX · editor integration · extensibility/plugins · security model · distribution & install · license · notable tradeoffs · strengths · weaknesses · **reusable ideas** · **explicitly do-not-copy**.

## 6. Ground-truth anchors I verified by hand (used in cross-cutting synthesis)

- **Aider edit format** — `aider/coders/editblock_prompts.py` (SEARCH/REPLACE prompt), `aider/coders/editblock_coder.py:127-240` (fallback cascade: `perfect_replace` → `replace_part_with_missing_leading_whitespace` → drop-blank-line → `try_dotdotdots`; **fuzzy edit-distance matching is deliberately disabled** by an early `return` at `editblock_coder.py:183`). Repo map: `aider/repomap.py:365-529` (tree-sitter tags via `grep_ast` → `networkx.MultiDiGraph` → `nx.pagerank` with personalization on mentioned identifiers/files).
- **Codex** — `codex-rs/apply-patch/` (custom patch format: `parser.rs`, `seek_sequence.rs` fuzzy line-seek, `streaming_parser.rs`); sandbox crates `codex-rs/linux-sandbox/src/{landlock.rs,bwrap.rs}` (Landlock + seccomp + bubblewrap), macOS Seatbelt (`sandbox-exec`) referenced in `codex-rs/exec-server` + `cli/src/debug_sandbox.rs`, `codex-rs/windows-sandbox-rs`. Apache-2.0.
- **Claude Code** — subagent format `plugins/feature-dev/agents/code-reviewer.md` (YAML frontmatter: `name/description/tools/model/color` + system-prompt body; **confidence scoring, report only ≥80**); hook examples `plugins/hookify/examples/*.local.md` (dangerous-rm, sensitive-files) as the permission/guardrail model; `examples/settings/` and `examples/hooks/` for config.
