# Claude Code — repo note (DOCS/PLUGINS ONLY; no agent source)

Clone: `anthropics/claude-code` @ `681a8be`, 2026-08-12. **License: PROPRIETARY** (Anthropic Commercial ToS, `LICENSE.md`). **The repo contains NO agent source** — only docs, markdown-based plugins, examples, and issue-scripts. The CLI ships as a minified npm bundle NOT in this repo and NOT decompiled. Everything below is **docs/behavior-derived** or read from the markdown artifacts; anything needing the bundle is `UNVERIFIED:`.

## architecture
UNVERIFIED (bundle). Doc-derived: a single-binary/npm CLI agent with a tool-use loop, subagents (Task), hooks, plugins, MCP, and a settings hierarchy.

## runtime model
Doc-derived: interactive terminal agent + non-interactive/`-p` print mode + an Agent SDK.

## agent loop shape
Doc-derived: tool-use loop (model calls Read/Edit/Write/Bash/Glob/Grep/WebFetch/Task; results fed back). `/compact` compresses context. Plan mode gates edits.

## turn/step budgeting
UNVERIFIED.

## tool system & schemas
Doc-derived tool set: Read, Edit, Write, Bash, Glob, Grep, WebFetch, Task (subagent), TodoWrite, etc. Subagent tool whitelists are visible in plugin agent files (`plugins/*/agents/*.md` frontmatter `tools:`).

## edit format
UNVERIFIED (bundle). Behavior: string-replace style `Edit` (old_string/new_string) + whole-file `Write`.

## filesystem access / shell execution
Doc-derived: direct fs tools; Bash tool with permission prompts + hooks. Hook examples in repo gate dangerous commands (`plugins/hookify/examples/dangerous-rm.local.md`, `sensitive-files-warning.local.md`).

## git integration
Doc-derived: commits on request; PR creation via `gh`. Not worktree-isolated by default (UNVERIFIED).

## context management & compaction
Doc-derived: `/compact`, auto-compaction, `CLAUDE.md` project memory injected.

## permission model *(readable as artifacts)*
Permission modes (default / acceptEdits / plan / bypassPermissions) — doc-derived. **Hooks** are the readable guardrail mechanism: `examples/hooks/`, `examples/settings/`, and `plugins/hookify/**` show PreToolUse/PostToolUse/Stop hooks that can block or warn. `examples/mdm/` = enterprise managed policy.

## sandboxing
UNVERIFIED in this repo; doc-derived: a sandbox/bash mode exists on some platforms. Not readable here.

## model/provider abstraction
Anthropic-model-only (proprietary). `examples/gateway/` shows routing via an LLM gateway (Bedrock/Vertex/proxy) but the model family is Claude. **No open/local model support** — a key contrast motivating our project (§1.1).

## local & open-weight model support
**None** (proprietary, Claude-only).

## config schema
`settings.json` hierarchy (user/project/enterprise), `.claude/` dir, `.claude-plugin/marketplace.json`. `examples/settings/` shows structure.

## memory/persistence
`CLAUDE.md` project-memory convention (the pattern we adapt to `AGENTS.md`, §10.1). Session history UNVERIFIED.

## workflow/orchestration
Doc-derived: plan mode; output styles; skills; commands. Plugins bundle commands/agents/hooks/skills.

## subagents *(readable)*
Subagents defined as markdown: `plugins/feature-dev/agents/{code-explorer,code-architect,code-reviewer}.md` — YAML frontmatter (`name/description/tools/model/color`) + system-prompt body. `code-reviewer.md` uses **confidence scoring, reports only issues ≥80** — a false-positive-reduction technique we borrow (as a pattern) for verification/review (§14).

## testing / evals / observability
UNVERIFIED (bundle).

## CLI/TUI UX
Doc-derived: polished terminal UX; slash commands; plan mode; output styles.

## editor integration
Doc-derived: VS Code + JetBrains extensions, and IDE integrations; also the ecosystem for "Claude in …".

## extensibility/plugins *(readable, high value)*
**Plugin system is fully readable as markdown**: a plugin = `commands/` (slash commands) + `agents/` (subagents) + `hooks/` + `skills/**/SKILL.md` + `output-styles/`, distributed via `.claude-plugin/marketplace.json`. This markdown-as-extension model is elegant and worth studying (as a pattern).

## security model
Permission modes + hooks + enterprise MDM policy. Hooks-as-guardrails is the readable, reusable idea.

## distribution & install
npm (`@anthropic-ai/claude-code`) bundle; not open source.

## license
**Proprietary — Anthropic Commercial ToS.** STUDY-ONLY. No code or prompt reuse.

## notable tradeoffs
Best-in-class on its own model; closed; single-vendor; no local models — exactly the gaps our project targets.

## strengths
Polished UX; plugin/hook/subagent extensibility; strong prompt engineering; MCP + IDE breadth.

## weaknesses (for our user)
Proprietary, Claude-only, no local/offline, telemetry posture set by vendor. Cannot be self-hosted with your own model.

## reusable ideas (patterns only)
(1) **Markdown-as-extension** (agents/commands/hooks/skills as files) — informs our declarative workflows + MCP boundary; (2) **hooks as permission/guardrail layer**; (3) **CLAUDE.md project memory** → our `AGENTS.md` standard; (4) **confidence-thresholded review** (report only high-confidence issues) for §14.

## explicitly do-not-copy
Everything expressive is **STUDY-ONLY**: no code (there is none to copy anyway), and **no prompt text** from the agent `.md` files (copyrightable, LICENSE §7). Do not imply Anthropic endorsement (LICENSE §6). Do not adopt Claude-only assumptions.
