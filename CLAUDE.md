# CLAUDE.md — working guide for building ClutchCode

> This file is for **Claude Code sessions building this repository**. It is *not* the file our product reads in a user's repo — that convention is `AGENTS.md` (our product standardizes on `AGENTS.md`; this `CLAUDE.md` guides the humans+agents building the product). Keep both; don't confuse them.

## What this project is
**ClutchCode** — an open-source, **local-first coding-agent runtime** that turns any model (frontier API *or* a 14B local model on a gaming laptop) into a competent, verified engineer, and **gets better at your repo the more you use it**. Read `PROJECT_SPEC.md` (architecture) and `EXECUTION.md` (build plan) before writing code. Reuse rules are in `LICENSE_AND_REUSE_ANALYSIS.md` and are binding.

## Current status
- **Phase 0 (research + spec): DONE** — spec, license analysis, and `research/**` are committed.
- **Base decided: fork `openai/codex`** (Apache-2.0, Rust, ratatui TUI, best-in-class sandbox, `app-server`). Verified real & official (~1.35M LOC). We fork the **local-first core** and **delete its cloud/telemetry crates** (`analytics`, `chatgpt`, `cloud-tasks*`, `backend-client`, `aws-auth`, `connectors`, `feedback`).
- **Next: Milestone M0** (fork, carve, de-cloud, green) then **M1** (walking skeleton) per `EXECUTION.md §6`. No product code exists in this repo yet.

## The stack (decided — see `EXECUTION.md §3` and §0.5)
- **Base: fork of `openai/codex`** (Apache-2.0), carved to the local-first core, cloud/telemetry crates removed. Study `research/repos/codex-cli.md` before touching it.
- **Core: Rust** (workspace of crates). **TUI: `ratatui`** (inherited from Codex). **CLI: `clap`**.
- **VS Code extension: TypeScript**, a *thin client* talking to the Rust `agent-server` over **JSON-RPC/ACP**. Do not put agent logic in the extension.
- **Storage: SQLite** (`rusqlite`) + JSONL transcripts + in-repo `AGENTS.md`/`.clutchcode/`.
- **Sandbox: native** Landlock+seccomp (Linux), Seatbelt (mac), bwrap; WSL2 for Windows.
- **Providers: OpenAI-compatible first** (covers Ollama/llama.cpp/vLLM/LM Studio/OpenRouter/Groq/DeepSeek) + native Anthropic + native Ollama + a `fake` provider for tests.
- This **supersedes `PROJECT_SPEC.md` ADR-001** (which picked TypeScript for a fast MVP). The Agent-API boundary makes the switch cheap.

## The one thing that makes us unique — protect it
**Compounding Engineering Memory (CEM)** — `EXECUTION.md §2`. Seven local, correctable, no-training memory components; the two that matter most and that no competitor does well: **failed-approach memory** and **task-recipe distillation**. CEM must be **measurable** (VTCR trend up, steps/task down) — it has a kill-criterion. When in doubt, invest here; this is the moat.

## Golden rules (do not violate)
0. **Fully open source (Apache-2.0), all changes public — never close it.** The moat is the per-user CEM data + execution + community trust, **not** code secrecy. Attribution is mandatory and permanent: preserve upstream `LICENSE`/`NOTICE`, keep `docs/PRIOR_ART.md` + a README "Built on / Credits" section, carry "modified by" notices, never imply endorsement, never copy Claude Code or GPL/AGPL code.
1. **Local-first, no telemetry, no servers, no account.** Ever. The offline test is a release gate.
2. **Verification-gated "done":** a run is successful only if the deterministic gate is green **and** no cheat flags **and** (interactive) the human approved. Never report success on the model's word.
3. **Secrets never enter model context, tool output, transcripts, or logs.** There is a canary test — keep it green.
4. **Clean-room.** Study the reference repos (`/tmp/agent-research/repos/`, re-pin via `scripts/fetch-references.sh`), but **copy no source and no prompt text**. Distinctive subsystems (sandbox, edit-apply, repo-map) are CLEAN-ROOM (author from OS docs/behavior). Prompts are written from scratch. See `LICENSE_AND_REUSE_ANALYSIS.md §3/§7`.
5. **No GPL/AGPL runtime deps.** Keep it Apache-2.0-clean; CI license-scans.
6. **Model-stubbable:** everything below `providers` must be testable with the `fake` provider — no test needs an API key or GPU. Add replay tests as you build.
7. **Honesty in all reports/commits.** Failing tests are reported as failing; skipped steps are stated.
8. **Design for the gaming laptop (Profile B):** 14B Q4_K_M, 12 GB VRAM, ~8k effective context. Never dump the whole repo into context. If a design only works above that bar, it's wrong.

## How to work in this repo
- **Branch:** develop on `claude/coding-agent-architecture-spec-4jqmhx` unless told otherwise; commit often; push with `git push -u origin <branch>`.
- **Commits:** Conventional Commits + DCO `Signed-off-by`. Keep messages honest and scoped.
- **Read before building:** `PROJECT_SPEC.md` for the *what*, `EXECUTION.md` for the *how/order*, the relevant `research/repos/*.md` for the *prior art to study* (not copy).
- **Reference map:** which repo teaches which subsystem is in `EXECUTION.md §5.2`.
- **PR checklist affirmation (every PR):** "contains no code/prompt copied from a reference project; patterns reimplemented independently."

## Build / test / lint commands
> Placeholder until M1 scaffolds the workspace. Update this section the moment `Cargo.toml` exists.
- Build: `cargo build` · Test: `cargo test` (must pass offline, no keys) · Lint: `cargo clippy -- -D warnings` · Format: `cargo fmt`
- Extension (later): `cd apps/vscode && npm install && npm test`
- Reference repos: `bash scripts/fetch-references.sh` (re-pins study clones at recorded SHAs; they live outside the repo tree).

## Directory intent (see `EXECUTION.md §7`)
`crates/runtime` (loop/state), `crates/cem` (⭐ the differentiator), `crates/capability` (probe+adapt), `crates/providers`, `crates/tools`, `crates/sandbox`, `crates/verification`, `crates/git-worktree`, `crates/repo-intel`, `crates/agent-server`, `crates/clutch-cli`, `apps/vscode`, `evals/`.

## When stuck / making a call
- Prefer the simplest thing that works (spec §9 killed the vector DB for a reason).
- Single agent by default; multi-agent only under the spec §7 rule.
- If a decision reverses a spec ADR, record it (like this file records the language reversal).
- Update `EXECUTION.md` milestone status and this file's "Current status" as milestones land.
