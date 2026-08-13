# Prior Art & Attribution

ClutchCode is built on and studies excellent open-source work. This file records what we **fork**,
what we **study**, and how — as required by the upstream licenses (Apache-2.0 / MIT) and by our own
attribution rule (`LICENSE_AND_REUSE_ANALYSIS.md`, golden rule #0 in `CLAUDE.md`).

> **Status: seeded in Phase 0; populated during M0 (fork) and updated as each subsystem is built.**
> When code from a permissive repo is ported, add the file/module + upstream commit here.

**ClutchCode is not affiliated with or endorsed by any project or company listed below.**

## Fork base
- **OpenAI Codex CLI** — https://github.com/openai/codex — **Apache-2.0** — pinned commit
  `7093e8c480715667a5a75b602fd8c9ca2cad1780`.
  ClutchCode's runtime **forks** the Codex local-first core (Rust, `ratatui` TUI, OS sandbox,
  `apply_patch`, MCP, `app-server`). The cloud/telemetry/account crates are **removed**
  (`analytics`, `chatgpt`, `cloud-tasks*`, `backend-client`, `aws-auth`, `connectors`, `feedback`).
  Upstream `LICENSE` and `NOTICE` are preserved (root `/LICENSE`, and `/NOTICE` to be added at M0
  with Codex's NOTICE content). "Modified by ClutchCode" notices carried on changed files.

## Studied and reimplemented independently (no source or prompt text copied)
| Project | License | What we learned |
|---|---|---|
| [Aider](https://github.com/Aider-AI/aider) | Apache-2.0 | SEARCH/REPLACE edit format + apply cascade (no fuzzy); tree-sitter PageRank repo map; per-model edit-format selection |
| [Cline](https://github.com/cline/cline) | Apache-2.0 | VS Code diff-review UX; XML tool protocol for non-native-tool (weak/local) models |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | MIT | Resumable State object; context condenser (compaction) |
| [goose](https://github.com/block/goose) | Apache-2.0 | MCP-extension model; local-inference seam |
| [Continue](https://github.com/continuedev/continue) | Apache-2.0 | Per-role model routing; config schema |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) / SWE-bench | MIT | Agent-Computer Interface; verified-subset eval harness design |
| [Model Context Protocol](https://modelcontextprotocol.io) | open spec | Implemented to spec (protocol conformance, not copied) |
| Claude Code | Proprietary | **STUDY-ONLY** — patterns only (confidence-thresholded review; memory convention). No code or prompt text. |

Provider/model names (Claude, GPT, Gemini, Grok, etc.) are trademarks of their owners, used only to
describe compatibility; no endorsement implied.
