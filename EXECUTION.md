# EXECUTION.md — Building ClutchCode (the real product)

**Version:** 1.0 · **Date:** 2026-08-12
**Reads with:** `PROJECT_SPEC.md` (authoritative architecture) and `LICENSE_AND_REUSE_ANALYSIS.md` (binding reuse rules).
**Scope of this doc:** how we go from the finished Phase-0 spec to a **real, shippable product (v1.0)** — not a toy MVP. It names the one thing that makes ClutchCode unique, decides the stack, and lays out a build plan that leverages the reference repos we already cloned.

> This supersedes two things in `PROJECT_SPEC.md`, deliberately and on the record:
> - **ADR-001 (language):** the spec picked TypeScript to optimize a fast MVP. For a *real product with a Codex-class TUI and the strongest sandbox*, we switch the **core to Rust** (see §3). The Agent-API boundary the spec designed makes this cheap — the VS Code extension stays TypeScript and talks to the Rust core over JSON-RPC/ACP, exactly as the spec's §18 anticipated.
> - **Differentiator emphasis:** the spec's §10 "long-term engineering memory" and §23 differentiators are **promoted to the product's headline feature** — *the agent that gets better at your repo the more you use it* (§1–§2 here).

---

## 0. Status — what is finished, what starts now

**Finished (Phase 0, committed & pushed to `claude/coding-agent-architecture-spec-4jqmhx`):**
- `PROJECT_SPEC.md` — full architecture (§1–§33 of the brief), 20 ADRs, registers, self-review.
- `LICENSE_AND_REUSE_ANALYSIS.md` — Apache-2.0 + DCO, per-repo reuse verdicts, clean-room rules.
- `research/**` — provenance (`00_METHOD.md`), 11 repo notes, 6 cross-cutting comparisons, Tier-3 prior art.
- Reference repos cloned to `/tmp/agent-research/repos/` (external to our tree; nothing third-party in our git history).

**Starts now (this doc):** the build. Real product, learning system from day one.

---

## 0.5 Strategy update (product-owner direction): fork-and-extend + bring-your-own-key

Two directives set after the spec, both honored here:

### (a) Build ON TOP of a mature base — don't start from zero
To guarantee ClutchCode is **not inferior to the top tools in any way**, we **fork and extend** a mature, permissively-licensed reference project instead of pure clean-room reimplementation. This is legal for **every top repo except Claude Code** (proprietary):
- **Apache-2.0 (fork freely; keep `LICENSE`+`NOTICE`, state changes, don't use their marks):** Codex, Aider, Cline, Continue, Roo, goose.
- **MIT (fork freely; keep copyright+license):** OpenHands, opencode, Crush, Kilo, gptme, smolagents, SWE-agent.

**Honest costs we accept when forking** (none are blockers): inherit the base's stack + attribution obligations; **strip any telemetry** (e.g. Codex's `analytics`) to honor no-telemetry; **rename** + imply no endorsement; **security-audit the sandbox/exec code we inherit** (we ship a tool that runs LLM code — inherited isolation gets reviewed, not trusted). We record provenance in `docs/PRIOR_ART.md` and preserve upstream `NOTICE`.

**Base repo = DECIDED: fork Codex (`openai/codex`, Apache-2.0).** It uniquely already gives us Rust + `ratatui` TUI (the "like Codex" UI, because it *is*), a real Landlock/seccomp/Seatbelt/bwrap **sandbox**, `apply_patch`, **MCP**, an **app-server** the VS Code extension can hang off, and **multi-provider via OpenAI-compatible config** — all Apache-2.0. We ADD our differentiators (multi-provider BYO-key polish, CEM, verification+cheat-detection, local-first hardening).

**Reality check (verified by cloning it):** Codex is OpenAI's *official* CLI — README says so, `github.com/openai/codex`, Apache-2.0 (LICENSE SHA `d17f227e…`), **~1.35M lines of Rust across ~3,025 files**, with real `tui`/`app-server`/`linux-sandbox`/`bwrap`/`execpolicy`/`apply-patch`/`codex-mcp`/`core` crates. Not a stub. But it is **big and OpenAI-cloud-coupled** — it also carries crates we must drop: `analytics` (telemetry), `chatgpt`, `cloud-tasks`, `backend-client`, `aws-auth`, `connectors`, `feedback`.

**Concrete fork steps (M0 below):** (1) clone at the pinned SHA (`research/00_METHOD.md §3`), re-home under `crates/`; (2) **carve out the local-first core** — KEEP `core`, `tui`, `apply-patch`, `linux-sandbox`+`bwrap`+`execpolicy`, `exec-server`, `codex-mcp`, `file-search`, `git-utils`, `config`, `keyring-store`, `app-server`; **DELETE** the cloud/account/telemetry crates (`analytics`, `chatgpt`, `cloud-tasks*`, `backend-client`, `aws-auth`, `connectors`, `feedback`) so we honor no-telemetry/no-account/local-first; (3) **rename** everything Codex/OpenAI-branded → ClutchCode; remove marks and any endorsement implication; (4) add the **offline release-gate test** (network off + local model → verified task) and a **no-phone-home test**; (5) preserve upstream `LICENSE`+`NOTICE`, write `docs/PRIOR_ART.md` crediting Codex + others; (6) **security-audit the sandbox/exec crates** we inherit before trusting them; (7) get `cargo build`/`clippy -D warnings`/`test` green as ClutchCode; (8) confirm a task runs end-to-end on an OpenAI-compatible endpoint. Only then start layering M1+ (Anthropic native, BYO-key UX, CEM).

### (b) Bring-your-own-key is first-class — any provider, and we're "not less"
**With a user's own frontier key (Claude/GPT/Groq/…), ClutchCode runs the same model the paid tools run — so on capability we are not inferior; we add verification + worktree safety + CEM on top.** The provider layer (spec §4.7) makes this concrete:

| Path | Providers covered | Adapter |
|---|---|---|
| **OpenAI-compatible** (one adapter) | OpenAI, **Groq**, OpenRouter, DeepSeek, Together, Fireworks, Mistral, xAI/Grok, **Ollama, llama.cpp, vLLM, LM Studio** | `providers/openai-compat` (base_url + key) |
| **Anthropic native** | **Claude** (tool use, prompt caching) | `providers/anthropic` |
| **Gemini native** | Google Gemini | `providers/gemini` (Phase 2) |
| **fake** | tests (no key, no GPU) | `providers/fake` |

**BYO-key UX:** `clutch providers add anthropic` → prompt for key → **OS keychain** (env-var escape hatch; `.env.example` shipped, never a real key) → `clutch models` lists what's reachable → `clutch config set model <id>`. `clutch doctor` shows which providers have keys and which local servers are up. Each provider gets a **capability profile** (native tools? parallel? caching? effective context) so the adaptation layer (§4) drives it correctly. **A frontier key and a local model are the same code path** — only the adapter + capability profile differ. This is a **hard requirement from M1** (the OpenAI-compatible adapter) and M2 (Anthropic native + local), not a later add-on.

### (c) Release model = FULLY OPEN (Apache-2.0) — decided; do not drift toward closing it
ClutchCode is **fully open source (Apache-2.0), all changes public.** This is deliberate and load-bearing: the product's reason to exist is being open, local-first, auditable, no-lock-in. **The moat is NOT code secrecy** — it is (1) the per-user **CEM data** that accumulates locally and no competitor can copy (it's the user's own history), (2) **execution quality**, and (3) **community trust**. A competitor reading our code cannot take any of those. Closing the source would forfeit our only edge and turn us into a weak closed competitor to the vendor tools — so we don't. If monetization is ever needed, do **open-core** (sell something *additional* — hosted sync, team analytics, support — never hide the core).

**Attribution is mandatory and permanent** (Apache-2.0 §4 + basic OSS ethics), whether or not code changes:
- Preserve upstream `LICENSE` + `NOTICE` from Codex (and any repo we borrow from); never strip copyright/attribution.
- Carry "modified by ClutchCode" notices on changed files.
- Maintain **`docs/PRIOR_ART.md`** + a README **"Built on / Credits"** section listing every project we fork or port code from.
- **Never** use OpenAI's / others' names or marks to promote ClutchCode or imply endorsement.
- **Never** copy from Claude Code (proprietary) or any GPL/AGPL repo; **no GPL/AGPL runtime deps** (CI scans).

### (d) "Best bits from all the repos" — the explicit port list (layered onto the Codex base)
We take the *best idea* from each and reimplement/port it on top of Codex, crediting each. (Prefer porting the *idea* over copy-pasting code — cleaner, fewer inherited bugs — but permissive code copy is allowed WITH attribution.)

| From | Best bit we take | License → how | Lands in |
|---|---|---|---|
| **Codex** (base) | Rust core, ratatui TUI, OS sandbox, `apply_patch`, MCP, app-server | Apache-2.0 → **fork** + attribute | M0 |
| **Aider** | tree-sitter **PageRank repo map**; per-model **edit-format selection**; the "no fuzzy apply" lesson | Apache-2.0 → reimplement + attribute | M1/M7 |
| **Cline** | **VS Code diff-review UX**; XML **tool protocol** for non-native-tool (weak/local) models | Apache-2.0 → reimplement + attribute | M2/M6 |
| **OpenHands** | resumable **State** object; context **condenser** (compaction) | MIT → reimplement + attribute | M1/M7 |
| **goose** | clean **MCP-extension** model; local-inference seam | Apache-2.0 → study; MCP = open protocol | M2/M7 |
| **Continue** | per-role **model routing** + mature config schema | Apache-2.0 → study | M2/M6 |
| **SWE-agent / SWE-bench** | **eval** trajectory logs + verified-subset harness design | MIT → study for our eval harness | M8 |
| **Claude Code** | confidence-thresholded review *pattern* only | Proprietary → **STUDY-ONLY**, pattern not code/prompt | M4 |

---

## 1. Product thesis (one paragraph)

ClutchCode is a **local-first coding agent that compounds** — it turns any model (a frontier API *or* a 14B model on your gaming laptop) into a competent engineer, and unlike every other coding agent, **it measurably gets better at *your* codebase the more you use it**, by remembering what worked, what failed, your build/test conventions, and distilling repeatable task recipes — all on your machine, with your keys, with no model training and no data leaving the box, and with every change proven by actually running your tests (never "the model said it's done").

## 2. The unique thing: **Compounding Engineering Memory (CEM)**

Every other coding agent starts each session roughly from zero (a `CLAUDE.md`/`AGENTS.md` is static human text; chat history is transient). **CEM makes the agent's competence a function of its history with your repo.** No model fine-tuning — this is *structured, local, correctable memory + retrieval + distillation*, which is why it fits our no-training, local-first, no-server constraints.

### 2.1 The seven CEM components

| # | Component | What it stores | How it makes the agent better | Guardrail |
|---|---|---|---|---|
| 1 | **Learned project profile** | build/test/lint commands, module map, "don't-touch" zones, flaky tests, style rules | agent stops re-discovering how to build/test; fewer wasted steps | provenance + verification oracle re-derives when source changes (§10.3 spec) |
| 2 | **Run & outcome history** | every run: task, plan, diff, verify result, tokens, time, status | "have we done something like this before?" → reuse the successful path | append-only, redacted; queryable by task similarity |
| 3 | **Failed-approach memory** ⭐ | "tried X to fix Y → failed because Z" | agent **avoids repeating dead ends** — the single most novel lever; injected into planning | only recorded when verification *confirms* the failure; expires/decays |
| 4 | **Decision (ADR) memory** | durable architectural choices + rationale | agent respects prior decisions instead of relitigating them | human-editable; conflicts surface to user |
| 5 | **Per-repo capability refinement** | observed edit-format / tool success **on this repo** for each model | edit format + tool transport tuned to *this codebase*, not just the model's generic probe | starts from the global probe (§4.9 spec), refines with evidence |
| 6 | **Retrieval prior** | which files/symbols were relevant to which task types | faster, tighter context selection over time (still no vector DB required) | symbolic/structural keys first; embeddings only if measured need |
| 7 | **Task recipes (distillation)** ⭐ | recurring successful task→steps patterns ("add an endpoint here") | agent proposes a known-good, mostly-deterministic playbook next time | recipes are suggestions, always verified; user can edit/disable |

⭐ = the two components no reference tool does well; they are the defensible core of the differentiator.

### 2.2 Where CEM lives (local, correctable, honest)

- **In the repo (committed, human-owned):** `AGENTS.md` (conventions), `.clutchcode/decisions/*.md` (ADR memory), optionally `.clutchcode/recipes/*.toml` (task recipes) — so the team shares them and reviews them in PRs.
- **In `~/.config/clutchcode` / `~/.local/state/clutchcode` (local, not committed):** run history, failed-approach store, capability refinements, retrieval priors — a per-machine SQLite DB. Never leaves the machine.
- **Never persisted:** secrets, raw provider responses with secrets (spec §10.2).
- **Correctable:** `clutch memory` lists/shows provenance/forgets/edits any learned fact. **Stale memory is worse than none** — verification is the truth oracle; human edits win (spec §10.3).

### 2.3 The claim is measurable (this is what makes it real, not marketing)

CEM ships with its own metric so the promise is falsifiable:
- **VTCR trend** (Verified Task Completion Rate, spec §16) on a repo should **rise** across sessions.
- **Time-to-green** and **steps-per-task** should **fall** on recurring task types.
- `clutch stats` shows the user: *"On this repo you're at 78% first-try verified, down from 61% three weeks ago; avg 4.2 steps/task, down from 7.1."*
If those trends are flat in dogfooding and the eval harness, CEM is not real and we cut it — stated as a kill-criterion, not a hope.

### 2.4 Why it's defensible
- It's **cumulative and local**: a competitor can copy the idea, but the *value* is the user's own accumulated history, which is portable to no other tool. Switching cost grows with use — the good kind of lock-in (data the user owns and can export).
- It needs **no training infra, no cloud, no vector DB** — it fits precisely inside our constraints where a lab-backed tool has no incentive to build it (their moat is the model, not your repo's history).

### 2.5 How we de-risk CEM (start narrow, prove the trend, THEN expand) — senior-level staging
CEM is our biggest differentiator **and** our biggest research risk. The hard, unsolved part is **matching** the current situation to past ones **without a vector DB** — if matching is weak the memory never fires or fires wrongly, and **stale memory hurts more than no memory**. So we do NOT build all seven components at once. We stage it, and each stage is gated on the previous one showing a **measurable** gain (§2.3); if a stage doesn't move VTCR/steps-per-task, we stop there rather than pile on complexity.

| Stage | Components | Matching key (no embeddings) | Risk | Gate to proceed |
|---|---|---|---|---|
| **CEM-1 (M5, must-have)** | learned project profile (#1) + run history (#2) + **failed-approach memory on CONCRETE signals** (#3) | exact **error signature + file path + symbol + approach tag** — deterministic, not fuzzy | low | project profile cuts wasted steps; failed-approach fires correctly on repeat errors |
| **CEM-2 (later)** | per-repo capability refinement (#5) + retrieval prior (#6) + decision memory (#4) | structural keys (paths/symbols/task-type) | medium | measurable VTCR trend up across sessions on a fixed repo |
| **CEM-3 (ambitious, only if 1–2 win)** | **task-recipe distillation** (#7) + semantic task-similarity | learned/optional embeddings **only if** symbolic keys proven insufficient (revisit §9) | high | recipes measurably beat cold planning; false-recipe rate ~0 |

**Anti-stale rules (all stages):** every memory carries provenance + timestamp; verification is the truth oracle (a memory that contradicts a passing/failing check is marked stale and re-derived); failed-approach notes **decay** and are invalidated when the referenced code changes; human edits win; `clutch memory` lets the user inspect/correct/forget. **Kill-criterion stands:** if CEM-1's trend is flat in dogfooding + eval, CEM is not real — cut it and compete on the local-first/agnostic/verified axis instead. Better to ship the provable 20% that delivers most of the value than bet the project on the hardest 80% working first.

### 2.4-note (honesty)
The *concept* and data model are sound; the *matching algorithm* (CEM-2/3) is the least-specified, highest-risk piece and is deliberately deferred until CEM-1 proves the premise. Do not oversell CEM as done — it is a measured bet with a kill-criterion.

---

## 3. Stack decision (real product)

**Decision: Rust core + `ratatui` TUI + TypeScript VS Code extension over a JSON-RPC/ACP agent-server. Storage SQLite. Sandbox = native Landlock/seccomp + Seatbelt + bwrap. Providers via OpenAI-compatible + native Anthropic + native Ollama.**

### 3.1 Why (scored against your stated goals)

| Criterion (your signals) | Rust core (chosen) | Go core (Crush-like) | TS core (spec's MVP pick) |
|---|---|---|---|
| **"UI like Codex"** (polished TUI) | ✅ `ratatui` — exactly Codex's stack | ✅ Bubble Tea (Crush) | ⚠️ Ink — good, less crisp |
| **Real product, not MVP** (perf, polish, single static binary) | ✅ best | ✅ great | ⚠️ needs Bun/SEA |
| **Sandbox** (agent runs LLM code = top risk) | ✅ native Landlock/seccomp bindings (Codex proves it) | ⚠️ shell-out only | ⚠️ shell-out only |
| **VS Code extension** (hard requirement) | ✅ thin TS client over agent-server (Codex `app-server` proves it) | ✅ same | ✅ shared runtime (its one edge) |
| **CEM / learning** (the differentiator) | ✅ SQLite + logic, language-agnostic | ✅ same | ✅ same |
| **Single-binary distribution** | ✅ best | ✅ best | ⚠️ workable |
| **Contributor supply** (OSS constraint) | ⚠️ smaller pool (but real in AI-infra: Codex, goose) | ✅ larger | ✅ largest |

Four of your explicit priorities point to Rust; the only real cost is contributor pool, which is acceptable for a serious product and mitigated by (a) a clean, well-documented workspace, (b) the extension/CLI clients being approachable TypeScript, and (c) the process-boundary escape hatch below.

### 3.2 The boundary that makes this work (and keeps ADR-001's benefit)
The spec's **Agent API as a JSON-RPC/ACP server** (spec §18.1) is the linchpin: the Rust core exposes one protocol; the **CLI/TUI is in-process Rust**, the **VS Code extension is a thin TS client**, and future Zed/Neovim clients speak the same protocol. We lose the "one shared runtime" convenience of all-TS but gain Codex-class UX + sandbox, and the extension stays small enough that the split is cheap. This mirrors Codex's `app-server` and the ACP convergence we found across Codex/OpenHands-canvas/goose.

### 3.3 Escape hatches (owned costs)
- **Contributor ramp:** ship a "good first issue" surface in the TS clients; keep provider adapters and workflows as the approachable Rust modules.
- **A pure-Rust gap** (e.g., a library only in TS/Python): call it as a **process-boundary helper** over stdio — the architecture already uses process boundaries for sandbox + editor clients.
- **If contributor supply ever dominates:** the protocol boundary lets us reimplement the core in another language behind the same API without touching clients. (Reversal cost: high but not fatal — recorded here.)

### 3.4 Key crates (all permissive: MIT/Apache — CI enforces no-GPL, LICENSE §8)
`tokio` (async), `ratatui` + `crossterm` (TUI), `clap` (CLI), `serde`/`serde_json`/`toml` (config+schema), `rusqlite` (storage), `reqwest` (providers), `tree-sitter` + grammars (repo intel), `git2` (git/worktrees), `jsonrpc`/custom (agent-server), `landlock` + `seccompiler` (Linux sandbox), `schemars` (JSON-Schema for tool grammars/config). Study Codex/goose `Cargo.toml` for battle-tested choices — **study, don't copy code** (LICENSE §3).

---

## 4. Architecture at a glance (Rust, updated from spec §24)

```
apps/vscode (TS)  ─┐                          ┌─ clutch (CLI/TUI, ratatui, in-process)
 zed/nvim (later) ─┼── JSON-RPC / ACP ──►  agent-server (crate)  ─┘
                   ┘                              │
                                     ┌────────────▼─────────────┐
                                     │  runtime (state machine, │
                                     │  budgets, loop detect)    │
                                     │        ▲        │         │
                                     │   capability    │ tool    │
                                     │   + CEM ◄───────┤ router  │
                                     └───────┬─────────┴─────────┘
      ┌───────────────┬──────────────┬───────┴────────┬───────────────┐
   providers        tools          sandbox        verification       git
 (openai-compat,  (fs/shell/    (landlock/seccomp/ (build/test/lint/  (worktree
  anthropic,       git/search/   seatbelt/bwrap)    cheat-detect)      isolation)
  ollama, fake)    tests/pkg)                                          
      └───────────────┴──────────────┴────────────────┴───────────────┘
                         ▲                                   │
                         └──── memory + CEM store (SQLite) ──┘  observability (JSONL+SQLite, redacted)
```

**New vs spec:** the **CEM store** is a first-class crate wired into `runtime` (planning reads failed-approach + recipes; verification writes outcomes) and `capability` (per-repo refinement). Everything else maps 1:1 to the spec's layers, now in Rust.

---

## 5. Build strategy — "clone the repos and build on top" (done right)

You asked to clone the other open-source repos and build on top. Here is exactly how, **without violating the reuse rules** we bound ourselves to (clean-room for distinctive expression; permissive libraries and open protocols are fair game).

### 5.1 Keep the references live
The clones live at `/tmp/agent-research/repos/` (re-clone with `research/00_METHOD.md` SHAs for reproducibility). They are **reference material we read, not code we paste** (LICENSE §2/§3). A `scripts/fetch-references.sh` (to be written) re-pins them for any contributor who wants to study.

### 5.2 Subsystem → which repo to study → what we take

| Our subsystem | Primary reference | What to learn | Reuse verdict |
|---|---|---|---|
| Sandbox (Landlock/seccomp/Seatbelt/bwrap) | **Codex** `linux-sandbox/`, exec-server | tier structure, policy modes, escalation | **CLEAN-ROOM** (author from OS docs; don't lift policy strings) |
| Edit format + apply | **Aider** editblock; **Codex** apply-patch | SEARCH/REPLACE cascade; streaming/seek; **fuzzy is disabled on purpose** | **CLEAN-ROOM** (syntax convention OK; matching code ours) |
| Repo map | **Aider** `repomap.py` | tree-sitter tags → graph → PageRank | **CLEAN-ROOM** (idea not protectable) |
| Tool protocol / emulation | **Cline** XML tools | text-protocol for non-native-tool models | **CLEAN-ROOM** + add GBNF constrained decode |
| Agent-server / editor boundary | **Codex** `app-server`; ACP (goose, OpenHands-canvas) | JSON-RPC surface; ACP shape | **REUSE the open protocol**; our impl |
| MCP client | **MCP spec** | protocol conformance | **REUSE the open protocol** |
| Eval harness | **SWE-bench**, **Terminal-Bench**, **SWE-agent** | verified-subset design; trajectory logs | **CLEAN-ROOM** harness; use public task sets per their licenses |
| Verification/review | **Claude Code** code-reviewer (confidence≥80 pattern) | confidence-thresholded review | **STUDY-ONLY** (no prompt text; pattern only) |
| Context condensation | **OpenHands** condenser | checkpoint summarization | **CLEAN-ROOM** |
| CEM (our differentiator) | — none — | genuinely new; **Archon** only for the *task/knowledge data-model shape* | **NOVEL / CLEAN-ROOM** |

### 5.3 Hard rules (from `LICENSE_AND_REUSE_ANALYSIS.md`, binding on every PR)
1. **No source or prompt text copied** from any reference — patterns reimplemented independently; prompts written from scratch. PR checklist affirms it.
2. **Distinctive subsystems are CLEAN-ROOM:** spec author ≠ code author; author writes from behavior/OS-docs, not from the reference's source open in another window.
3. **Permissive libraries + open protocols (MCP/ACP) are fair reuse** with attribution in `docs/PRIOR_ART.md` and Cargo metadata.
4. **No GPL/AGPL runtime deps** (CI license-scanner blocks them; keeps us Apache-2.0-clean).
5. **Fork-and-extend is now allowed and encouraged** on a permissively-licensed base (§0.5) — this supersedes the earlier "no wholesale fork" stance. When we fork: preserve `LICENSE`+`NOTICE`, record provenance in `docs/PRIOR_ART.md`, strip telemetry, rename, and **security-audit inherited sandbox/exec code**. We still write our *differentiators* (CEM, verification, multi-provider polish) as clean, owned code, and prompt text is still authored from scratch (Claude Code prompts remain STUDY-ONLY).

---

## 6. Execution plan (to a real v1.0, phased, CEM from the start)

Effort tags are rough (small ≈ days, medium ≈ 1–2 wks, large ≈ 3–4 wks) for a small committed team. Each milestone has a **dogfood checkpoint** — we use ClutchCode to build ClutchCode as early as possible.

### M0 — Fork, carve, de-cloud, green · medium
- **Goal:** a clean, renamed, telemetry-free ClutchCode that builds and runs a task on an OpenAI-compatible endpoint — the trustworthy foundation.
- **Build:** the 8 fork steps in §0.5 — clone Codex at the pinned SHA, **keep the local-first core crates, delete the cloud/account/telemetry crates**, rename, preserve `LICENSE`/`NOTICE` + `docs/PRIOR_ART.md`, security-audit the inherited sandbox, CI green (`fmt`/`clippy -D warnings`/`test`).
- **DoD:** `clutch` builds; **no network egress at rest** (no-phone-home test green); a task runs against an OpenAI-compatible base_url; the offline release-gate test scaffold exists. **This is the "not a fake stub, and now it's ours and clean" checkpoint.**

### M1 — Walking skeleton (the loop that edits & verifies) · large
- **Goal:** `clutch run "<task>"` on a Rust/TS repo → inspect → SEARCH/REPLACE edit → shell/test → show diff → approve → commit, all in an isolated **git worktree**.
- **Build:** `runtime` state machine + `RunState` (SQLite), `providers` (OpenAI-compat + `fake`), `tools` (fs/shell/search/tests), edit-apply cascade (clean-room), `git` worktree isolation, `verification` (build/test), minimal `ratatui` TUI, `agent-server` skeleton.
- **CEM seed:** the run/outcome tables exist from day one (component #2) even if unused yet.
- **Studies:** Aider (edit), Codex (worktree/exec), SWE-agent (loop).
- **DoD:** fixes a real bug on a sample repo, verified + committed; **replay tests** (recorded transcript vs `fake`) green offline. **Dogfood #1: the team fixes a ClutchCode bug with ClutchCode.**

### M2 — Local models + capability adaptation · large
- **Goal:** point at **Ollama/llama.cpp**, run fully offline; edit-format + tool transport adapt to the model.
- **Build:** `capability` crate (probe + profile persistence), edit-format selector + fallback→whole-file→escalate, **tool-call emulation + GBNF constrained decoding** for weak models, context budgeter (never-dump-repo), Anthropic native adapter, `clutch doctor` (detect GPU/VRAM, recommend+pull model, probe, verify offline path).
- **Studies:** Aider per-model edit table, Cline XML tools, goose local-inference.
- **DoD:** **offline release-gate test passes** (network off, Ollama, task verified) on a 14B Q4_K_M at 8k. **Dogfood #2: run a session entirely on a local model.**

### M3 — Sandbox + permissions (make it safe to run untrusted repos) · medium-large
- **Goal:** tiered sandbox default-on; policy engine; egress default-deny; destructive-command gate; secret denylist + redaction canary.
- **Build:** `sandbox` (Tier-0 policy always; Tier-1 Seatbelt on mac, Landlock+seccomp+bwrap on Linux; WSL2 doc for Windows), child-env scrubbing, permission classes + approval UX (batch-by-class), trusted/untrusted repo modes.
- **Studies:** Codex sandbox (clean-room).
- **DoD:** canary-key test proves no secret reaches context/logs; confinement tests pass; `git ls-files`-style egress test blocks exfil.

### M4 — Verification you can trust + **cheat detection** · medium-large
- **Goal:** completion contract = green gate **+ no cheating + human approval**.
- **Build:** full pipeline (lint/typecheck/static/scan), toolchain autodetect (cached w/ provenance), test selection (impacted-first), **cheat detectors** (deleted tests, weakened asserts, added skips, swallowed errors, edited snapshots), repair loop caps, failure taxonomy.
- **Studies:** SWE-bench (test-based truth), Claude Code reviewer (confidence pattern).
- **DoD:** labeled cheat-corpus caught with low false-positives; a run that games tests is blocked.

### M5 — **CEM v1: the differentiator lands** · large
- **Goal:** the agent visibly improves across sessions on a repo.
- **Build:** all seven CEM components — learned project profile, run/outcome history, **failed-approach memory** (recorded only on verified failure; injected into planning), decision memory (`.clutchcode/decisions`), per-repo capability refinement, retrieval prior, **task-recipe distillation** (`.clutchcode/recipes`); `clutch memory` (list/forget/correct) and `clutch stats` (VTCR/time-to-green trends).
- **Studies:** none for the novel parts; Archon for the task/knowledge data-model shape only.
- **DoD:** on a fixed repo, **VTCR trend rises and steps/task falls** across a scripted multi-session eval (this is the CEM kill-criterion, §2.3). **Dogfood #3: measure our own repo's trend over the M1–M5 build history.**

### M6 — VS Code extension (the second interface) · medium-large
- **Goal:** run tasks, stream, review diffs, approve — inside VS Code, on the same Rust core.
- **Build:** `apps/vscode` TS extension: spawns/attaches the agent-server, native VS Code diff review, approval buttons, inline verify results, worktree-safe; publish to Marketplace + OpenVSX.
- **Studies:** Cline VS Code UX (DiffViewProvider), Codex app-server, ACP.
- **DoD:** a full task (task→diff→approve→commit) runs in VS Code against the same core the CLI uses.

### M7 — Workflows + repo intelligence tier-1 · medium
- **Build:** built-in workflows (default/quickfix/review-only) as typed Rust + JSON-Schema user workflows; PageRank repo map (on-demand, cached) when repos exceed the size threshold. Still **no vector DB** unless §16.2 retrieval metric proves need.

### M8 — Eval harness + published "local-model usability" result · medium
- **Build:** SWE-bench-Verified subset + Terminal-Bench-style + our realistic-task suite; per-model scoreboard; **publish the VTCR delta** (14B naked vs under ClutchCode) with methodology. This is the proof of the whole premise.

### M9 — Release engineering + hardening → **v1.0** · medium-large
- **Build:** signed single-binary releases (mac/Linux/Windows-WSL2) + Homebrew/Scoop + npm wrapper for the extension; external security review of §12/§16; docs site; `docs/PRIOR_ART.md` attribution; Windows/WSL2 hardening.
- **DoD = the v1.0 launch bar (§10).**

**Optional later:** M10 multi-agent (only under the spec §7 rule — genuinely parallel/independent work), M11 Zed/Neovim clients, M12 Docker Tier-2 sandbox.

---

## 7. Repo layout (Rust workspace + TS extension)

```
clutchcode/                      # Apache-2.0, DCO, monorepo
├── Cargo.toml                   # workspace
├── crates/
│   ├── clutch-cli/              # `clutch` binary: CLI + ratatui TUI (in-process client)
│   ├── agent-server/            # JSON-RPC/ACP server (editor clients)
│   ├── runtime/                 # state machine, budgets, loop detection (fake-provider testable)
│   ├── capability/              # capability matrix, probe, per-repo refinement
│   ├── cem/                     # ⭐ Compounding Engineering Memory (the differentiator)
│   ├── providers/               # openai-compat, anthropic, ollama, fake
│   ├── tools/                   # fs/shell/git/search/tests/pkg + truncation
│   ├── sandbox/                 # landlock/seccomp/seatbelt/bwrap tiers
│   ├── verification/            # pipeline + toolchain detect + cheat detection
│   ├── git-worktree/            # worktree isolation, checkpoints, diff, delivery
│   ├── repo-intel/              # ripgrep + tree-sitter (+ pagerank map later)
│   ├── memory/                  # session/project memory, AGENTS.md handling
│   ├── observability/           # JSONL + SQLite events, redaction, inspect/replay
│   └── workflows/               # typed built-ins + JSON-Schema loader
├── apps/
│   └── vscode/                  # TypeScript VS Code extension (thin agent-server client)
├── evals/                       # eval suite + scoreboard + recorded-transcript replay
├── scripts/fetch-references.sh  # re-pin the study repos at recorded SHAs
├── docs/ (+ docs/adr, docs/PRIOR_ART.md)
├── examples/                    # sample repos + AGENTS.md + recipes
└── CLAUDE.md  AGENTS.md  PROJECT_SPEC.md  EXECUTION.md  LICENSE_AND_REUSE_ANALYSIS.md
```

## 8. Engineering standards & golden rules (binding)

1. **Model-stubbable everywhere:** every crate below `providers` is testable with `fake` — no test needs an API key or a GPU (spec §2). Replay tests land in M1.
2. **Verification-gated "done":** no run is success unless the deterministic gate is green **and** no cheat flags **and** (interactive) human-approved (spec §14.7).
3. **Local-first, no telemetry, no servers** — ever. The offline test is a release gate (spec §17).
4. **Secrets never reach context/logs** — canary test in CI (spec §5.2).
5. **Clean-room + no copied code/prompts** — PR checklist affirmation (LICENSE §3/§7).
6. **Every user-facing agent post/commit is honest about status** — failing tests are reported as failing.
7. **CEM must be correctable** — stale memory is a bug; `clutch memory` + verification-oracle re-derivation.
8. **Conventional commits + DCO sign-off** on every commit; CI runs fmt/clippy/test + license-scan.

## 8.5 Testing & QA strategy — test cases + end-to-end

Testing is not an afterthought; it's how the core invariant (§8.1 model-stubbable) is enforced. The rule: **everything below `providers` is tested offline, deterministically, with no API key and no GPU.** Real-model runs are additive, not the CI gate.

### 8.5.1 The test pyramid (what runs, where)

| Layer | What it covers | Deterministic? | Runs in CI (no key/GPU)? |
|---|---|---|---|
| **Unit** | tool functions, edit-apply cascade, state-machine transitions, budget guard, loop detector, redactor, cheat detectors | yes | **yes — every PR** |
| **Property/fuzz** | edit-apply vs malformed model output; patch idempotency; parser never panics/mis-applies | yes | yes |
| **Replay/integration** | the whole runtime loop driven by **recorded transcripts against `FakeProvider`** — plans, tool calls, repair, verify, git — zero tokens | yes | **yes — the workhorse** |
| **Provider contract** | each adapter (OpenAI-compat, Anthropic) vs a recorded/mock server: request shape, streaming, tool-call parse, error mapping | yes | yes |
| **Security** | secret canary, sandbox confinement, egress deny, destructive gate | yes | yes (Linux/mac runners) |
| **E2E** | real `clutch run` on sample repos with `fake` or a small local model: full journey in a worktree | mostly (fake) / seeded (local) | fake=yes; local=nightly |
| **Eval (M8)** | VTCR on SWE-bench subset + realistic suite + the CEM trend test | seeded/averaged | scheduled (needs runners) |
| **Cross-platform** | sandbox on macOS (Seatbelt) / Linux (Landlock+seccomp+bwrap) / Windows-WSL2 | yes | matrix runners |

### 8.5.2 The golden end-to-end test cases (concrete — these are the acceptance suite)

Each is a scripted scenario with explicit assertions. They double as regression tests and as the demo script.

1. **Bug fix (happy path):** sample repo with a failing test → agent makes the *minimal* edit → tests pass → diff shown → approve → commit. **Assert:** main working tree untouched (worktree isolation), verification green, exactly one commit, diff is minimal.
2. **Cheat caught:** task where the lazy path is to delete/skip the failing test. **Assert:** the diff-based cheat detector flags it and **blocks** DONE-SUCCESS even though "tests pass."
3. **Offline / local (release gate):** network fully blocked at OS level + Ollama 14B → task completes verified. **Assert:** no egress attempted; verified completion. *This test gates every release.*
4. **Edit-format fallback:** `FakeProvider` emits a malformed SEARCH block → **Assert:** structured repair prompt → then whole-file fallback → then human escalation; **never a silent mis-apply** (the Aider lesson).
5. **Budget/cost ceiling:** `FakeProvider` loops forever → **Assert:** step + cost budget halts the run and escalates; no runaway.
6. **Secret redaction canary:** inject a fake key into env **and** into a file the agent reads → **Assert:** the canary string appears in **no** context, transcript, or log artifact across the whole run.
7. **Sandbox confinement:** agent attempts to write outside the worktree / read `~/.ssh` / `curl` an external host → **Assert:** each is denied and logged.
8. **Resume:** `Ctrl-C` mid-run → `clutch resume <id>` → completes from `RunState`. **Assert:** no duplicated edits, final state correct.
9. **Dirty working tree:** uncommitted user changes at start → **Assert:** they are preserved (stash-and-base-on-HEAD), never lost or silently included.
10. **Steering:** inject guidance mid-run → **Assert:** folded into the next step without killing the run.
11. **Provider parity:** the *same* task via OpenAI-compat vs Anthropic native → **Assert:** both reach verified completion (capability adaptation works across providers).
12. **CEM-1 (from M5):** run a scenario that hits the same error twice across two sessions → **Assert:** failed-approach memory fires on the second run and the agent avoids the recorded dead end; **and** a stale memory (code changed) is correctly invalidated, not blindly trusted.

### 8.5.3 CI discipline & per-milestone gates
- **Every PR:** `fmt` + `clippy -D warnings` + unit + property + **replay** + contract + security (offline, no keys). Red = no merge.
- **Nightly/scheduled:** E2E with a small local model (seeded, averaged over K runs for nondeterminism) + the offline release-gate case + cross-platform sandbox matrix.
- **Per milestone, DoD includes named tests:** M0 → no-phone-home + build-green; M1 → cases 1,4,5,6,8,9 + replay; M3 → cases 6,7 + confinement matrix; M4 → case 2 + the labeled **cheat corpus** (curated positive/negative examples, tuned for low false-positives); M5 → case 12 + the CEM trend eval; M8 → the VTCR scoreboard.
- **Coverage philosophy:** not 100%-for-its-own-sake; concentrate on the risky subsystems — **edit-apply, sandbox, redaction, verification, CEM matching** — where a bug is dangerous or silent.

### 8.5.4 Honest testing gaps (named, not hidden)
- **Cross-platform E2E needs real runners** (macOS/Linux/Windows) — CI cost we must budget; sandbox correctness can't be fully proven in one OS.
- **Local-model E2E is nondeterministic** → we seed + average + assert on *distributions/tolerances*, not exact output; flaky-test discipline applies.
- **The CEM trend test is itself research** — a scripted multi-session harness with enough signal above local-model noise; designing it rigorously is real work, budgeted in M5/M8.

## 9. Risks & de-risking

| Risk | De-risk |
|---|---|
| CEM doesn't actually improve outcomes (the whole bet) | measure from M5 with a scripted multi-session eval; **kill-criterion** if trend is flat (§2.3) |
| Failed-approach memory becomes stale/misleading | record only verified failures; decay + provenance; verification overrides memory |
| Rust slows contribution | approachable TS clients; documented crates; "good first issue" in clients/providers |
| Local 14B too weak even adapted | constrained decoding + edit-format fallback; publish the honest VTCR delta (M8) — if small, pivot to privacy/agnostic axis |
| Sandbox escape / security incident | external review (M9); §12.7 honesty; default-deny egress |
| Scope sprawl (it's a big product) | the milestone gates + "no wholesale fork" + non-goals (spec §27) |

## 10. Definition of "v1.0 real product" (the launch bar)

v1.0 ships when **all** hold:
1. `clutch run` completes the full journey (inspect→edit→run→test→repair→diff→approve→commit) reliably on real repos in **≥3 languages**.
2. **Offline path works** end-to-end on a 14B local model (release-gate test green).
3. **Sandbox** Tier-1 on mac + Linux; WSL2 documented for Windows; canary + confinement tests green.
4. **Verification + cheat detection** enforce the completion contract.
5. **CEM** demonstrably raises VTCR / lowers steps-per-task across sessions on a repo (published result).
6. **VS Code extension** does a full task against the same core; on Marketplace + OpenVSX.
7. **Single-binary signed releases** for mac/Linux (+WSL2), Homebrew/Scoop.
8. **No telemetry, no account, no server**; docs + `PRIOR_ART.md` attribution complete.

That is a real product — not an MVP.
