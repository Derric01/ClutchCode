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

**Base repo = the pivotal decision (see below / confirm before M1).** Leading candidate: **fork Codex** — it uniquely already gives us Rust + `ratatui` TUI (the "like Codex" UI, because it *is*), a real Landlock/seccomp/Seatbelt/bwrap **sandbox**, `apply_patch`, **MCP**, an **app-server** the VS Code extension can hang off, and **multi-provider via OpenAI-compatible config** — all Apache-2.0. We then ADD our differentiators (multi-provider BYO-key polish, CEM, verification+cheat-detection, local-first hardening). Alternative if VS-Code-first + fastest multi-provider matters more than a Codex-class TUI: **fork Cline** (Apache-2.0, TS, already multi-provider incl. Claude/GPT/Groq/Ollama, already VS Code-native).

### (b) Bring-your-own-key is first-class — any provider, and we're "not less"
**With a user's own frontier key (Claude/GPT/Groq/…), ClutchCode runs the same model the paid tools run — so on capability we are not inferior; we add verification + worktree safety + CEM on top.** The provider layer (spec §4.7) makes this concrete:

| Path | Providers covered | Adapter |
|---|---|---|
| **OpenAI-compatible** (one adapter) | OpenAI, **Groq**, OpenRouter, DeepSeek, Together, Fireworks, Mistral, xAI/Grok, **Ollama, llama.cpp, vLLM, LM Studio** | `providers/openai-compat` (base_url + key) |
| **Anthropic native** | **Claude** (tool use, prompt caching) | `providers/anthropic` |
| **Gemini native** | Google Gemini | `providers/gemini` (Phase 2) |
| **fake** | tests (no key, no GPU) | `providers/fake` |

**BYO-key UX:** `clutch providers add anthropic` → prompt for key → **OS keychain** (env-var escape hatch; `.env.example` shipped, never a real key) → `clutch models` lists what's reachable → `clutch config set model <id>`. `clutch doctor` shows which providers have keys and which local servers are up. Each provider gets a **capability profile** (native tools? parallel? caching? effective context) so the adaptation layer (§4) drives it correctly. **A frontier key and a local model are the same code path** — only the adapter + capability profile differ. This is a **hard requirement from M1** (the OpenAI-compatible adapter) and M2 (Anthropic native + local), not a later add-on.

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
