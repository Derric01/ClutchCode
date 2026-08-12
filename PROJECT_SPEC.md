# ClutchCode — Project Specification

**A model-agnostic, local-first coding-agent runtime and harness.**

**Version:** 1.0 (Phase 0 — Research & Specification)
**Date:** 2026-08-12
**Status:** Draft for review. Authoritative deliverable of Phase 0. No production code exists or ships with this document.
**Audience:** (1) a future implementation agent that must build Phase 1 from this document with no further questions; (2) a skeptical senior engineer deciding whether this project should exist.

> This document optimizes for the skeptic. Where the honest conclusion is "don't build it," it says so (see §9 Repository Intelligence — no vector DB; §7 Multi-Agent — single agent by default; §23 — why this might fail). Every reference-project claim is traceable to a file listed in `research/00_METHOD.md §6` or marked `UNVERIFIED:`.

---

## Table of Contents

1. Product Definition — and why it deserves to exist
2. Core Architectural Principle — the model is replaceable
3. Target Users & Hardware Profiles (A–D)
4. **Model Capability Tiers & the Adaptation Layer** (the heart)
5. Credentials & Trust Boundaries
6. Agent Runtime
7. Multi-Agent Architecture — and the argument against it
8. Workflow Engine
9. Repository Intelligence — the case against a vector DB
10. Memory
11. Tool System
12. Sandbox & Security
13. Git Architecture
14. Verification
15. Observability
16. Evaluation — the North Star
17. Local-First Architecture
18. CLI/TUI & VS Code — Interface Strategy & UX
19. Technology Selection
20. Repository Structure
21. MVP Boundary & Phasing Table
22. Non-Goals
23. Competitive Analysis — differentiators & failure modes
24. Final Architecture
25. Implementation Roadmap
26. Architecture Decision Records (ADRs)
27. ASSUMPTIONS register
28. OPEN QUESTIONS register
29. SELF-REVIEW

**Confidence legend:** each major recommendation is tagged **[C:High]**, **[C:Med]**, or **[C:Low]**; anything below High states why.

---

## 1. Product Definition — and why it deserves to exist

**One paragraph a stranger can repeat:**
ClutchCode is an open-source, local-first *coding-agent runtime* — the harness layer that sits between a language model and a codebase and turns *any* model, including a 14B model running on your own gaming-laptop GPU, into a competent engineer that inspects, edits, runs, tests, repairs, and verifies code on your machine. It is model-agnostic (frontier API or fully offline local), it never phones home, you own your keys and your data, and it proves work is done by *running the build and tests* rather than trusting the model's claim. You drive it from a terminal or from a VS Code extension; both speak to the same runtime.

**What it is NOT:** "another AI coding CLI." The CLI is a thin client. The product is the **runtime + capability-adaptation layer + verification harness** underneath it. The model is a replaceable component (§2).

### 1.1 Why would anyone use this instead of just running Claude Code or Codex?

Bluntly: for a user pointed at a frontier model with a budget, **Claude Code and Codex are and will remain better** — they are backed by the labs that make the models, ship faster, and tune the prompt to one model family. If ClutchCode's only honest answers were "it's free" and "it's open," that would not justify the project. So here are the three capabilities that *do* justify it, each of which the vendor CLIs structurally will not prioritize:

1. **True offline / local-model operation as a first-class path, not an afterthought.** Claude Code is proprietary and Anthropic-model-only (`research/repos/claude-code.md`); Codex is OpenAI-centric. Neither's business incentive is to make a *14B local model on your GPU* work well. ClutchCode's capability-adaptation layer (§4) exists specifically to close the gap between a weak local model and a competent agent — that is the product. A homelab user (Profile D) or a privacy-bound developer can run it **fully disconnected** (§17), which the vendor CLIs cannot do.
2. **Provider neutrality with per-model capability adaptation.** One harness, any provider, and the *edit format / tool protocol / context budget adapt to what the model can actually do* (§4). Switching models is a config change, not a new tool. Vendor CLIs are structurally single-vendor.
3. **Deterministic verification you can trust and audit, with no telemetry.** "Done" means the build/tests/lint passed and a human approved the diff (§14), and the full decision trail is replayable locally (`agent inspect`) with zero data leaving the machine (§15, §19). This is a stronger, auditable completion contract than "the model said it finished."

If a reader rejects all three as insufficient for *their* use case (frontier model, cloud-fine, budget-fine), they are right to use the vendor CLI. We do not claim to beat a lab's own harness on the lab's own model. **[C:High]**

### 1.2 Why would anyone use this instead of Aider or OpenHands? (the real competitors)

Aider and OpenHands — both open source, both excellent — are the honest competition, not the vendor CLIs.

- **vs Aider (Apache-2.0, Python, terminal):** Aider is superb at edit formats and repo mapping (we study it heavily, §4/§9) but is architecturally a *pair-programming chat with edit application and optional auto-test*, not a **verification-first, sandboxed, resumable agent runtime**. ClutchCode differentiators: (a) a **first-class verification pipeline with cheating-detection** (§14) — Aider runs lint/test but does not systematically detect an agent deleting a failing test or weakening an assertion; (b) **OS-level sandboxing tiers** (§12) — Aider executes shell with confirm-only, no confinement; (c) **git worktree isolation per run** so your working tree can never be corrupted (§13); (d) a **VS Code extension** sharing the same runtime (Aider's editor story is thin). Where Aider stays better: raw edit-application maturity and its published edit-format leaderboard — we adopt its *lessons*, not its lead.
- **vs OpenHands (MIT, Python, Docker-first):** OpenHands has the strongest research pedigree (CodeAct, Action/Observation ACI, SWE-bench positioning; `research/repos/openhands.md`) but its **default isolation is a Docker container**, which is a heavy default on a laptop and a non-starter for many Profile-B/C users who "simply turn it off." ClutchCode differentiators: (a) **laptop-appropriate tiered sandbox with Docker optional, not default** (§12); (b) **local-model-first capability adaptation** — OpenHands runs local models but does not systematically down-adapt edit format / context budget for an 8k-context 14B model (§4); (c) **CLI/TUI + VS Code as the primary surface** vs OpenHands' web-app orientation. Where OpenHands stays better: its Docker runtime is genuinely stronger isolation than our default tier, and its benchmark infrastructure is more mature.

**The defensible core in one line:** *the layer that makes a weak/local model behave like a competent, verified, sandboxed engineer on your own machine, driven from terminal or editor.* Everything else in this spec serves that line. Claimed differentiators that could not be substantiated are killed in §23.4.

---

## 2. Core Architectural Principle — the model is a replaceable component

```
Model  →  Agent Runtime  →  Tools  →  Execution Env  →  Verification  →  Git / Delivery
         (capability-aware)  (typed)   (sandboxed)      (deterministic)   (worktree)
```

**Design invariant:** every layer *below* the model must be testable with the model stubbed out.

How it is enforced (this is a testability contract, not a slogan):

1. **Deterministic tool layer.** Tools (§11) are pure-ish functions of `(args, workspace state) → typed result`. No tool calls the model. Each tool has unit tests that never touch a provider. **[C:High]**
2. **Recorded-transcript replay.** Every run persists a full event log (§15). The runtime can be re-driven from a recorded transcript against a **fake provider** that replays the recorded model turns, so runtime logic (state machine, budgets, loop detection, verification, git) is tested with zero tokens and full determinism (§16.3). **[C:High]**
3. **Fake provider.** The provider interface (§4.7) has a `FakeProvider` implementation used in CI: scripted responses, injectable malformed outputs (to test edit-format fallback and repair), injectable latency/errors (to test budgets and error taxonomy). **[C:High]**

Consequence: a contributor can change the workflow engine or sandbox and prove correctness **without an API key and without a GPU**. This is what "model-agnostic" means operationally.

---

## 3. Target Users & Hardware Profiles

Primary user: **an individual developer on their own machine.** Not an enterprise, not a platform team. Every tradeoff below names the profile it serves.

| Profile | Machine | Model reality | Design consequence |
|---|---|---|---|
| **A** | Apple Silicon, 16–36 GB unified memory | Local 7B–32B quantized via Ollama/MLX; frontier API for hard tasks | Metal/MLX serving; unified-memory sizing; "local for easy, escalate to API for hard" routing (§4.6) |
| **B** | **Linux/Windows + 8–16 GB VRAM NVIDIA — the gaming laptop** | Local 7B–14B quantized; llama.cpp/vLLM/Ollama; CUDA | **First-class.** 12 GB VRAM at Q4_K_M with 8k–16k context is the *canonical constraint we design against* (see §4.10). Every context/edit-format decision must survive here. |
| **C** | Any laptop, no usable GPU | API-only: Anthropic/OpenAI/Google/xAI/OpenRouter/DeepSeek/Groq | **Most common.** Must work with an API key and nothing else. No GPU code paths on the critical path. |
| **D** | Homelab/workstation, 48 GB+ VRAM | Local 70B-class or MoE; full offline | **Ideological core.** "Disconnect the network, point at Ollama, finish a task" is a *tested requirement* (§17). |

**Explicit gaming-laptop (Profile B) commitment.** The single hardest realistic target is *a 14B model, Q4_K_M, on 12 GB VRAM, at 8k effective context.* The spec's §4 (edit-format fallback, tool-call emulation, aggressive context budgeting, capability probe) exists primarily to make that machine complete real tasks. If a design choice works only above that bar, it is wrong. **[C:High]** The product must degrade in capability across A→D but **never break**; Profile C is the common case and Profile D is the reason the project exists.

**User journey supported end-to-end:**
`install → configure credentials OR pull a local model → point at a repo → give a task → agent inspects, edits, executes, tests, repairs, verifies → human reviews diff → approve → commit.`

---

## 4. Model Capability Tiers & the Adaptation Layer *(the heart)*

"Model-agnostic" is a lie unless the harness adapts to what each model can actually do. A GPT-class frontier model with native parallel tool-calling and a Qwen-14B-Q4 on a gaming laptop cannot be driven by the same code path. This section defines the **capability matrix**, the **adaptation layer** that reads it, and the **graceful-degradation** rules.

### 4.1 The capability matrix (per provider/model)

Each dimension is probed (§4.9) or configured, and stored in a persisted **capability profile**.

| Dimension | Values | Why it changes harness behavior |
|---|---|---|
| Native tool/function calling | native / JSON-mode-only / none | Selects tool transport (§4.8): native schemas vs constrained JSON vs text-protocol emulation |
| Parallel tool calls | yes / no | If no, serialize tool requests; never emit multi-call plans |
| Structured-output reliability | high / medium / low | Gates JSON tools; low → text protocol + strict parser |
| Constrained decoding available | GBNF (llama.cpp) / outlines / JSON-schema (vLLM) / none | If available, **enforce** tool/edit grammar at decode time — the biggest reliability win for local models |
| Advertised vs **effective** context | e.g. 32k advertised / ~8–12k effective | Budget against *effective*; degradation starts well before the limit |
| Prompt caching | anthropic / openai / none | Order the prompt cache-friendly; measure cache hit for cost (§15) |
| Reasoning/thinking mode | none / hidden / visible-tokens | Affects loop parsing (don't parse thinking as tool calls) and budget |
| Long-prompt instruction fidelity | high / medium / low | Low → shorter system prompt, fewer simultaneous rules, more reminders |
| Cost / latency / tok-s | $/Mtok in·out, ms, tok/s | Feeds routing (§4.6) and budgets (§6) |
| **Diff-application accuracy** | measured % | **The single strongest predictor of coding-agent success** — selects edit format (§4.4) and fallbacks |

**Provider snapshot (illustrative; values are configured/probed, not hard-coded, and marked `UNVERIFIED:` as point-in-time).** This table is a *shape*, populated at runtime by the probe:

| Model (example) | Native tools | Parallel | Constrained decode | Effective ctx | Default edit format |
|---|---|---|---|---|---|
| Frontier API (Claude/GPT/Gemini class) | native | yes | provider JSON schema | large | search/replace or native-tool edit |
| Mid API (DeepSeek/Groq-hosted) | native/JSON | often | JSON schema | medium | search/replace |
| Local 32B (Profile A/D) | JSON-mode | sometimes | GBNF via llama.cpp | 8–32k | search/replace |
| **Local 14B Q4 (Profile B)** | **often none/weak** | **no** | **GBNF (enforce)** | **~8–12k** | **search/replace, whole-file fallback** |
| Local 7B (Profile B/C floor) | none | no | GBNF (enforce) | ~4–8k | whole-file for small files; line-anchored |

### 4.2 The adaptation layer (architecture)

```
                 ┌────────────────────────────┐
   task + repo → │  Runtime (state machine)   │
                 └─────────────┬──────────────┘
                               │ needs: edit N files, run cmd, ...
                 ┌─────────────▼──────────────┐
                 │   ADAPTATION LAYER          │  reads capability profile:
                 │  • edit-format selector     │   - picks edit format (4.4)
                 │  • tool transport selector  │   - picks tool transport (4.8)
                 │  • context budgeter (4.5)   │   - sets token windows
                 │  • prompt assembler         │   - sizes system prompt to fidelity
                 └─────────────┬──────────────┘
                               │ format-specific request
                 ┌─────────────▼──────────────┐
                 │  Provider adapter (4.7)     │  native tools / JSON / text
                 └─────────────┬──────────────┘
                               │ raw model output
                 ┌─────────────▼──────────────┐
                 │  Parser + validator + repair│  (4.4, 4.8) — strict, with fallback
                 └────────────────────────────┘
```

The adaptation layer is the product's crown jewel. It is **pure and model-stubbable** (§2): given a capability profile and an intent, it deterministically chooses transport/format/budget.

### 4.3 Edit format — comparison and failure modes

Edit-application accuracy dominates coding-agent success. Prior art read directly: **Aider's SEARCH/REPLACE** (`aider/coders/editblock_prompts.py`, application cascade `editblock_coder.py:127-240`), **Codex's `apply_patch`** (`codex-rs/apply-patch/`), **Cline's XML `<replace_in_file>`** (`research/repos/cline.md`).

| Edit format | How it works | Failure modes | Best for | Token cost |
|---|---|---|---|---|
| **Whole-file rewrite** | Model re-emits entire file | Truncation at token limit; silent drift in untouched code; expensive | Tiny files; weakest models; new files | High |
| **Unified diff** | Standard `@@` hunks | Hallucinated context lines; line-number drift; whitespace mismatch; models miscount hunks | Models trained on diffs; small changes | Low |
| **Search/Replace blocks** | Exact `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` | SEARCH must match char-for-char; whitespace drift; ambiguous (multiple matches); model omits lines | **Most models, most tasks** — the pragmatic default | Low–med |
| **Line-anchored patch** | Replace by line range/anchor | Anchor ambiguity; line drift after prior edit | Structured tools; when line numbers are stable | Low |
| **Structured JSON edits** | `{path, find, replace}` array | JSON escaping of code (quotes/newlines) breaks weak models; verbose | Models with strong JSON/constrained decode | Med–high |

**Key learned lesson (verified):** Aider's fuzzy edit-distance matching is **deliberately disabled** by an early `return` at `editblock_coder.py:183`. Fuzzy "closest match" application silently applies edits to the *wrong* location. **Do-not-copy:** do not add fuzzy/edit-distance edit application as a silent fallback. Our fallbacks are *exact-with-tolerances* (whitespace, blank-line) then *fail loudly and re-prompt*, never "apply to the nearest thing." **[C:High]**

### 4.4 Our edit-format selection & fallback (the algorithm)

We adopt **Search/Replace as the default** (interoperable convention across Aider/Cline; the marker syntax itself is not protectable, the matching code is clean-room per LICENSE §3). Selection and fallback are driven by the capability profile:

```
select_edit_format(profile, file):
    if profile.constrained_decode and profile.diff_acc >= 0.85: return SEARCH_REPLACE (grammar-enforced)
    if profile.diff_acc >= 0.75:                                return SEARCH_REPLACE
    if file.is_new or file.loc <= WHOLE_FILE_LOC_CAP(profile):  return WHOLE_FILE
    if profile.diff_acc >= 0.5:                                 return SEARCH_REPLACE (with tighter reminders)
    else:                                                       return WHOLE_FILE (chunked if needed)

apply(edit):
    cascade (from Aider, reimplemented clean-room, §LICENSE):
      1. exact match (char-for-char)                    # perfect_replace
      2. tolerate uniform leading-whitespace drift       # match_but_for_leading_whitespace
      3. drop a spurious leading blank line, retry
      4. handle explicit "..." elision if present
      # NO fuzzy edit-distance step (learned lesson)
    on miss:
      → structured failure: which SEARCH block failed, with the nearest *non-applied* context shown
      → REPAIR PROMPT: re-send the specific block with the actual current file content window
      → after MAX_EDIT_RETRIES (default 2): downgrade edit format one tier (SEARCH_REPLACE → WHOLE_FILE)
      → after downgrade also fails: escalate to human (§14) — never guess a location
```

`WHOLE_FILE_LOC_CAP(profile)` scales with effective context (e.g. ~400 LOC at 8k, larger at 32k) so a whole-file rewrite can never blow the window. **[C:High]** The **repeated-failure fallback** (downgrade format, then escalate) is the mechanism that keeps a weak model usable instead of looping.

### 4.5 Context budgeting for 8k–32k local models

**Hard rule: the agent never gets the whole repo dumped into context.** Ever. Not even on a frontier model (it wastes cache and money; on local it is fatal). **[C:High]**

Budget model (fractions of *effective* context, configurable, defaults tuned for Profile B 8–12k):

| Segment | Share (8k profile) | Contents |
|---|---|---|
| System prompt + tool schemas | ~15% | Sized down for low instruction-fidelity models (§4.1) |
| Repo map / retrieval | ~20% | Ranked symbols/files (§9), NOT file bodies unless opened |
| Open file windows | ~30% | Only the *windows* being edited, not whole files |
| Conversation/tool history | ~25% | Compacted with checkpoints (§10) |
| Reserved for model output | ~10% | Room for the edit + reasoning |

Techniques (all mandatory for local tiers): **aggressive retrieval** (open only what's needed), **file-window discipline** (read/edit windows, not whole files, above a LOC threshold), **summarization checkpoints** (compact tool history into a running summary at thresholds, §10), and **truncation of tool output at the source** (§11.3 — a 50k-line test log is summarized before it ever reaches context). Retrieval budget scales *down* automatically as effective context shrinks.

### 4.6 Model routing (local-for-easy, escalate-for-hard) — optional, off by default

Profiles A/D can run a cheap local model for inspection/simple edits and **escalate** hard steps to a stronger local or API model. This is **opt-in** (`[routing]` config), never automatic without consent (privacy + cost). Escalation triggers: repeated edit failure, verification failure loop, explicit "hard" task tag. Default: single configured model. **[C:Med]** (routing adds complexity; MVP ships single-model, routing is Phase 2+.)

### 4.7 Provider abstraction

A single `Provider` interface; adapters below it. **OpenAI-compatible-first** because it covers the long tail (OpenRouter, Groq, DeepSeek, Together, vLLM `--api`, llama.cpp `llama-server`, LM Studio, and Ollama's `/v1` endpoint) with one adapter.

```
interface Provider {
  id, capabilityDefaults
  chat(request: NormalizedRequest): AsyncStream<Delta>   // text + tool-call deltas
  supportsNativeTools, supportsParallelTools, supportsConstrainedDecode
}
Adapters (MVP): OpenAICompatible (covers most), Anthropic (native), Ollama (native+model mgmt).
Adapters (Phase 2): GeminiNative, plus constrained-decode hooks (GBNF/outlines/JSON-schema).
FakeProvider (CI): scripted, fault-injecting (§2).
```

Provider selection, base_url, and keys come from config (§18) + credential store (§5). **[C:High]**

### 4.8 Tool-call emulation for models without native tool calling

Many local models (Profile B/C floor) have no reliable native tool calling. We define a **strict text protocol** with a strict parser and a repair loop.

```
Protocol (emulation mode): the model emits exactly one action block:

  <tool name="edit_file">
  <arg name="path">src/foo.ts</arg>
  <arg name="body">
  <<<<<<< SEARCH
  ...
  =======
  ...
  >>>>>>> REPLACE
  </arg>
  </tool>

Parser rules:
  - Exactly one <tool> block per turn (enforced; multi-block → repair).
  - Unknown tool / missing required arg → structured error → REPAIR PROMPT with the schema.
  - If constrained decoding is available (GBNF), the grammar ENFORCES this shape at decode time
    (near-eliminates parse failures on local models — the single biggest local-model reliability lever).
  - Retry budget: MAX_TOOL_PARSE_RETRIES (default 2) → then simplify (fewer tools exposed) → then escalate.
```

This is informed by Cline's XML tool protocol (`research/repos/cline.md`) — reimplemented clean-room. The **constrained-decoding enforcement** is our addition and the reason a 7B/14B can drive tools reliably. **[C:High]**

### 4.9 The capability probe (`agent models probe`)

A short, local, ~2-minute benchmark run **once per new model** to populate its capability profile, persisted in config so it is not re-run.

Probe checks (deterministic scoring, no human):
1. **Valid search/replace emission** — give a tiny file + change, score exact-applicable blocks over N trials → `diff_acc`.
2. **Stop-condition obedience** — does it stop when told, or ramble/loop? → `instruction_fidelity`.
3. **Tool-protocol validity** — native tool call vs JSON vs needs-emulation → `tool_transport`.
4. **JSON structured-output reliability** — emit a schema-constrained object → `structured_output`.
5. **Context probe** — needle-in-haystack at increasing lengths → `effective_context` estimate.
6. **Loop check** — repeated identical action detection sanity.

Output: a `CapabilityProfile` written to `~/.config/clutchcode/models/<id>.toml`. Re-runnable with `--force`. **[C:High]** This is how the harness "learns" a model instead of assuming.

### 4.10 Installing & serving open models (Profiles A, B, D)

Concrete guidance the tool encodes in `agent doctor` and docs.

| Server | Platforms | Strength | ClutchCode adapter | Notes |
|---|---|---|---|---|
| **Ollama** | mac/Linux/Win | Easiest pull/run; model mgmt | native + `/v1` | Default recommendation for Profiles A/B; `agent models pull` wraps it |
| **llama.cpp / llama-server** | all | GBNF constrained decode; fine control | OpenAI-compatible | Best for enforcing tool/edit grammar on weak models |
| **vLLM** | Linux + CUDA | Throughput; JSON-schema guided decode | OpenAI-compatible | Profile D / power users |
| **LM Studio** | mac/Win/Linux | GUI; OpenAI endpoint | OpenAI-compatible | Friendly for Profile B beginners |
| **MLX / mlx-lm** | Apple Silicon | Fastest on Metal | OpenAI-compatible/native | Profile A |
| Any OpenAI-compatible | all | — | OpenAI-compatible | Universal escape hatch |

**Quantization guidance (encoded in `agent doctor`):**

| Quant | Quality | VRAM (14B approx) | When |
|---|---|---|---|
| Q4_K_M | Good, standard | ~9–10 GB | **Default for 12 GB VRAM (Profile B)** — leaves room for KV cache |
| Q5_K_M | Better | ~11–12 GB | 16 GB VRAM |
| Q6_K | Near-FP16 | ~13–14 GB | 16–24 GB |
| FP16 | Reference | ~28 GB | Profile D only |

**VRAM estimation (encoded):** `weights(quant) + KV_cache(context, layers, heads)`. `agent doctor` estimates: for a 14B Q4_K_M at 8k context, ~10 GB weights + ~1–2 GB KV ≈ fits 12 GB with headroom; at 16k KV grows and may spill — doctor warns and suggests lowering context or quant. **Context-length config** and **KV-cache footprint** are surfaced explicitly so a Profile-B user isn't silently OOM'd.

**Recommended default model per profile (illustrative, `UNVERIFIED:` point-in-time — doctor picks from a maintained list):**

| Profile | Default local model class | Context | Edit format |
|---|---|---|---|
| A (24–36 GB unified) | 14B–32B coder, Q4/Q5 | 16–32k | search/replace |
| **B (12 GB VRAM)** | **14B coder, Q4_K_M** | **8–16k** | **search/replace + whole-file fallback, GBNF-enforced** |
| C (no GPU) | — (API only) | provider | native/search-replace |
| D (48 GB+) | 32B–70B / MoE coder | 32k+ | search/replace |

**`agent doctor` goal: a working local setup in under five minutes.** It: detects OS/GPU/VRAM; checks for Ollama/llama.cpp/LM Studio; recommends a model+quant for the detected VRAM; pulls it (`agent models pull`); runs the capability probe (§4.9); writes config; and prints "you can now run `agent run` fully offline." **[C:High]**

---

## 5. Credentials & Trust Boundaries

Users bring their own keys. **No project backend exists to send them to** — this is a stated, testable property (§17, §21).

### 5.1 Credential storage (precedence)

1. **OS keychain first** — macOS Keychain, Linux libsecret (Secret Service), Windows Credential Manager. **[C:High]**
2. **Encrypted file store fallback** — `~/.config/clutchcode/credentials.age` (age/libsodium-encrypted) when no keychain is available (headless Linux, some Profile-D servers). Key derived from a machine-bound secret + optional passphrase.
3. **Environment variables** — escape hatch (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, …), for CI/scripting.

We ship `.env.example` with placeholder names only; **a real key is never written to it** (a unit test asserts the file contains no value matching a key pattern).

### 5.2 Secret redaction as a pipeline stage

Redaction is a **named stage**, not scattered `if` checks. Every string crossing a boundary passes through `Redactor.scrub()`:

```
Boundaries that MUST redact (each has a test):
  → model context assembly (prompt)        # keys never enter the model prompt
  → tool output ingestion (before context) # a leaked key in `env` output is scrubbed
  → transcript/event writes (§15)          # keys never hit disk logs
  → crash reports / error surfaces
Redactor:
  - known credential values from the store (exact match, highest precision)
  - high-entropy + provider-prefix patterns (sk-, AKIA, ghp_, xai-, AIza, etc.)
  - replaces with «REDACTED:provider» preserving shape for debuggability
Tested by: a "canary key" injected into env/tool output; assert it appears in NO
  context, transcript, or log artifact across a full recorded run. (§16.3 replay.)
```

**[C:High]** The canary test is the enforcement mechanism, not the code review.

### 5.3 Filesystem denylist (agent cannot read secrets by default)

By default the agent is **prevented from reading**: `.env*` (except `.env.example`), `~/.aws`, `~/.ssh`, `~/.config/gcloud`, `~/.kube`, `~/.docker/config.json`, the OS keychain, our own `credentials.age`, shell history (`.bash_history`, `.zsh_history`, `.python_history`), `.git-credentials`, `.netrc`, browser profiles.

- Enforced at the **tool layer** (read/glob/grep all consult the denylist) *and* at the **sandbox layer** (§12, filesystem confinement) — defense in depth. A denylist check in the tool is bypassable by a shell command; the sandbox mount/Landlock rule is not.
- **Override path:** explicit, per-path, logged: `agent config allow-read <path>` or an interactive one-time approval that is recorded in the run's event log. Never a blanket "allow all." **[C:High]**

### 5.4 Trust-boundary diagram (names every party that sees code or keys)

```
┌───────────────────────────────────────────────────────────────────────┐
│  USER'S MACHINE (the only place keys and code live at rest)            │
│                                                                        │
│  ┌───────────┐   keys    ┌──────────────────┐                          │
│  │ OS keychain│◄────────►│  ClutchCode       │   code (files, diffs)    │
│  │/age store  │          │  harness process  │◄────────────────────────┼─┐
│  └───────────┘           │  (redaction here) │                          │ │
│                          └───────┬───────────┘                          │ │
│                                  │ spawns                               │ │
│                          ┌───────▼───────────┐   executes LLM cmds      │ │
│                          │  Sandbox           │  (confined fs/net)       │ │
│                          │ (bwrap/seatbelt/…) │                          │ │
│                          └───────┬───────────┘                          │ │
│                                  │ prompt (REDACTED, no keys)           │ │
│                                  ▼                                      │ │
│                       ── network egress (default-deny) ──               │ │
└───────────────────────────────────┼───────────────────────────────────┘ │
                                     │ (only if provider is remote)         │
                          ┌──────────▼───────────┐                          │
                          │  MODEL PROVIDER       │  sees: the prompt =      │
                          │ (Anthropic/OpenAI/…)  │  code snippets + task    │
                          │  OR: localhost server │  (NEVER sees API keys of │
                          │  (Ollama/llama.cpp) → │   *other* providers;     │
                          │  sees data, no egress │   sees its OWN auth key) │
                          └──────────────────────┘                          │
   Local model path: data never leaves the machine. ◄───────────────────────┘
   No ClutchCode server exists. No telemetry endpoint exists. (§19, §21)
```

**Parties, exhaustively:** (1) the user's OS (keychain, filesystem); (2) the ClutchCode harness process; (3) the sandbox (a child of the harness); (4) the chosen model provider — **and nothing else.** With a local model, party (4) is `localhost` and data never leaves.

### 5.5 What the provider necessarily sees (user-facing honesty obligation)

`agent doctor` and docs disclose, per selected provider: it receives **your prompt** (task text + the code snippets/file windows the agent chose to include + tool results the agent fed back). It does **not** receive your API keys for other providers, your denylisted files, or files the agent never opened. Retention/training posture is disclosed per provider (see `LICENSE_AND_REUSE_ANALYSIS.md §5`), with the honest note that free-tier Gemini may train on submitted data and **local models see nothing off-machine**. `UNVERIFIED:` exact current provider policies must be re-checked at ship time (OPEN QUESTION, owner: maintainers). **[C:High]** on the obligation; **[C:Med]** on specific policy wording.

---

## 6. Agent Runtime

### 6.1 The loop

```
Task → Understand → Plan(optional) → Inspect → Act(tools) → Edit → Test →
Analyze-failure → Repair → Verify → Summarize
```

Compared against reference loops (details in `research/cross-cutting/agent-loop-comparison.md`):

| Project | Loop shape | Planning | Resumable state | Notable |
|---|---|---|---|---|
| Aider | chat → edit → (optional) lint/test → reflect (bounded `num_reflections`) | architect/editor 2-model split optional | chat history file | tight, edit-centric |
| OpenHands | event-stream; AgentController consumes events, emits Actions; State object | agent-dependent | **explicit State** (strong) | Action/Observation ACI |
| Cline | recursive request loop; parse assistant msg → tool → approval → continue | Plan/Act modes | task history + checkpoints | HITL approval per tool |
| Codex | turn/session loop in Rust core; apply_patch + sandboxed exec | — | session | tiered sandbox |
| ClutchCode | **explicit state machine + persisted RunState (below)** | optional, model-call, cheap-task-aware | **RunState (first-class)** | verification-gated completion |

### 6.2 State machine & the persisted `RunState` (what makes `resume` possible)

```
States: CREATED → UNDERSTANDING → PLANNING → INSPECTING → ACTING → EDITING
        → VERIFYING → (REPAIRING → EDITING)* → AWAITING_APPROVAL → COMMITTING → DONE
        with edges to: PAUSED (steering), ESCALATED (human), FAILED, CANCELLED.

RunState (persisted after every transition; JSON in SQLite, §15):
  run_id, task, workflow_id, provider, model, capability_profile_id,
  state, step_index, budgets{steps,wallclock,tokens,cost} + consumed,
  worktree_path, base_commit, plan[], open_windows[], edit_history[],
  tool_call_log[], verification_results[], summary_checkpoints[],
  loop_detector_state, last_error{class,detail}, escalation_reason?
```

`resume` reloads `RunState`, re-attaches the worktree (§13), and continues from the last committed state. Because transitions persist, a crash or `Ctrl-C` loses at most the in-flight step. **[C:High]**

### 6.3 Budgets — and what happens at each limit

| Budget | Default | On limit |
|---|---|---|
| **Step budget** | 50 tool steps | Pause → summarize progress → ask human to extend or stop |
| **Wall-clock** | 20 min | Same pause/escalate |
| **Token budget** | per-run cap (config) | Compact context (§10); if still over, escalate |
| **Cost ceiling** | e.g. $2.00 (API); $0 for local | **Hard stop + require explicit approval to continue** — protects Profile C from a runaway bill |

All four are enforced in one `BudgetGuard` checked at every step. Local models set cost=0 but keep step/wall-clock/token limits (a looping local model wastes time, not money). **[C:High]**

### 6.4 Loop & thrash detection

| Pathology | Detection | Recovery |
|---|---|---|
| Repeated identical tool call | hash of `(tool,args)` seen N times | Inject "you already did this; result was X"; if persists → escalate |
| Oscillating edits (A→B→A) | edit-target + content cycle detection | Freeze that file; require a different approach; escalate on repeat |
| No-progress (no file/test-state change over K steps) | diff-stat + verification-state unchanged | Force a plan re-eval; then escalate |
| "Almost done" stall (claims done, verify fails repeatedly) | verify-fail count ≥ cap | Escalate with the failing check (anti-cheat, §14) |

Detectors are deterministic and model-stubbable (tested via §16.3 replay with adversarial transcripts). **[C:High]**

### 6.5 Interruption & steering

The user can inject guidance **mid-run without killing it**: a steering message is queued; at the next step boundary the runtime folds it into context and continues (state → PAUSED → ACTING). `Ctrl-C` once = graceful pause (persist RunState, release nothing destructive); twice = cancel (leave worktree intact for inspection). **[C:High]**

### 6.6 Streaming, partial results, cancellation

Model output streams to the UI (token deltas). Tool calls show live (command, then output, truncated §11.3). Cancellation is cooperative: a cancel flag is checked at every await point; an in-flight shell command is sent SIGTERM→SIGKILL with a grace period; the worktree is never left in a half-applied edit (edits apply atomically per file, §13). **[C:High]**

### 6.7 Planning: separate call vs implicit

Planning is a **separate, cheap model call only when the task warrants it.** Heuristic: skip explicit planning for single-file / small-diff / low-step tasks (over-planning a one-line fix wastes tokens and latency — a real cost on Profile B/C). Trigger explicit planning when: multi-file, ambiguous, or the capability profile shows low instruction fidelity (a plan anchors a weak model). Plan is stored in `RunState.plan[]` and shown to the human. **[C:Med]** (the heuristic's thresholds need eval tuning, §16.)

### 6.8 Error taxonomy (different recovery per class)

| Class | Examples | Recovery |
|---|---|---|
| **Model error** | malformed edit/tool output, refusal, empty | Repair prompt; format downgrade (§4.4); retry with budget |
| **Tool error** | invalid args, file not found | Structured error back to model; it corrects |
| **Environment error** | build tool missing, network down, OOM | Do NOT ask model to "fix" — surface to human/doctor; for local OOM suggest lower quant/context |
| **Task error** | tests reveal the change is wrong | Repair loop (§14): analyze failure → new edit → re-verify |

Misclassifying an environment error as a task error makes the model flail; the taxonomy prevents that. **[C:High]**

---

## 7. Multi-Agent Architecture — and the argument against it by default

We design *support* for Planner / Coder / Tester / Reviewer / Security-Reviewer / Debugger / Docs agents. Then we **default to a single agent** and make you earn delegation.

### 7.1 When a single agent beats multiple agents (the default case)

| Cost of multi-agent | Why it bites |
|---|---|
| **Context-handoff loss** | Subagent B lacks A's working context; re-establishing it costs tokens and loses nuance. The #1 failure mode. |
| **Cost multiplication** | Each agent is a full model context; N agents ≈ N× tokens. Fatal for Profile B/C budgets. |
| **Latency** | Serial handoffs stack latency; a local model at 20 tok/s makes 4 agents unusable. |
| **Error compounding** | A's mistake becomes B's premise; errors amplify across a chain. |
| **Debuggability** | "Why did it do that?" now spans N transcripts and their handoffs. |

**Decision rule — delegate ONLY when at least one holds:** (a) **genuinely parallel independent subtasks** (e.g., edit 3 unrelated packages) where parallelism > handoff cost; (b) **hard context isolation** is required (a huge log/dataset one agent must digest without polluting the main context); (c) **adversarial review** where *independence is the point* (a security/review agent that must not share the coder's rationalizations). Otherwise: **one agent, sub-*steps*, not sub-*agents*.** **[C:High]** This directly contradicts the market's multi-agent fashion; §23.5 lists it as a differentiator precisely because most tools over-delegate.

### 7.2 If you do delegate: the contract

```
AgentContract {
  input:  typed { task, artifacts_in[], constraints, budget }
  output: typed { status, artifacts_out[], summary, evidence[] }
  isolation: own git worktree (§13); own budget; own sandbox scope.
}
Delegation protocol:
  - Prefer ARTIFACT passing (files, diffs, structured findings) over CONTEXT passing
    (raw transcript) — artifacts are smaller, typed, and inspectable.
  - Shared state store = the SQLite run DB (§15); subagents write artifacts, not prose, to it.
  - Concurrency limit: default max 2 concurrent subagents (Profile B GPU can serve ~1 model;
    API tier can do more) — configurable, capped by provider rate limits.
  - Partial failure: a subagent FAILED surfaces to the parent as a typed result; parent decides
    (retry / do-it-itself / escalate). A subagent can never silently swallow its failure.
  - Human visibility: subagent failures appear in `agent inspect` as first-class events with the
    failing subtask and evidence.
```

**MVP surface: none.** Multi-agent is **Phase 9** (§25). The single-agent runtime with sub-*steps* covers the MVP journey. **[C:High]**

---

## 8. Workflow Engine

The strongest idea from Archon (`research/repos/archon.md`) is **explicit task/stage state you can inspect and resume** — but Archon is a knowledge-base + task-management service, not a code editor, so we take the *concept*, not the code (LICENSE §2). Our workflow is the ordered pipeline:

```
plan → implement → test → review → repair → approve → commit
```

Required properties: **deterministic where possible, model-powered only where necessary, resumable, observable, interruptible, configurable, versioned.**

### 8.1 Workflow representation — comparison and choice

| Representation | Authoring ergonomics | Validation | IDE support | Risk |
|---|---|---|---|---|
| YAML | familiar | weak (stringly-typed) | poor | **reinvents a bad language in YAML** (conditionals, loops) |
| TOML | good for flat config | weak for graphs | ok | same as YAML for control flow |
| **Typed DSL in host lang (TS)** | **strong (types, autocomplete)** | **compile-time** | **excellent** | it's real code (must sandbox untrusted) |
| JSON-Schema-validated graph | tool-friendly | strong (schema) | ok | verbose to author by hand |
| Code-as-config | maximal power | host tooling | excellent | least declarative; harder to diff for non-devs |

**Recommendation:** built-in workflows are a **typed TS DSL (code-as-config)** — they are testable (§2), get autocomplete, and validate at compile time; users customize the *linear pipeline* via a **JSON-Schema-validated declarative form** (a small, deliberately non-Turing-complete graph: ordered stages + per-stage enable/skip/parameters, no arbitrary loops/conditionals). This gets authoring ergonomics without reinventing a programming language in YAML. **[C:Med]** (the built-in-as-code vs user-declarative split is a judgment call; revisit after dogfooding.)

### 8.2 Schema, versioning, defaults

```
Workflow (declarative, JSON-Schema-validated):
  apiVersion: clutchcode/v1
  id, name, stages: [ {id, uses: builtin-stage-id, when?: always|on_failure, params?} ]
Versioning: apiVersion gates a migration function; unknown version → refuse + point to `agent config migrate`.
Built-in workflows shipped in MVP:
  - default   : plan(opt) → implement → verify → approve → commit
  - quickfix  : implement → verify → approve → commit   (skips planning; small tasks)
  - review-only: inspect → review → report              (no edits; read-only, safe on untrusted repos §12)
```

Stages are deterministic wrappers around runtime capabilities; only `implement`/`plan`/`review` call the model. Resumability and observability come free from `RunState` (§6.2). **[C:High]**

---

## 9. Repository Intelligence — the case against a vector DB

**Starting assumption: a vector database is NOT needed. The spec must prove otherwise. It does not, for the MVP or Phase 2.** **[C:High]**

### 9.1 Options compared

| Approach | Build time (100k LOC) | Incremental update | Memory | "where is X / who calls X" | Deps | Offline |
|---|---|---|---|---|---|---|
| **ripgrep + fs** | ~0 (no index) | n/a | ~0 | good for literal/symbol *names*; weak for semantics | ripgrep bin | yes |
| **tree-sitter AST** | seconds–low minutes | fast (per-file reparse) | low–med | **strong** for defs/refs/symbols | tree-sitter grammars | yes |
| Symbol/import graph | + graph build | medium | med | **strong** for call/def relations | + graph lib | yes |
| PageRank repo map (Aider) | seconds–minutes | medium | med | **strong** ranking of *relevant* symbols | tree-sitter + graph | yes |
| LSP integration | server startup | live | med–high | **strongest** (real semantics) | a language server per lang | yes (local LSP) |
| Embeddings/vector DB | **minutes–tens of min + model** | costly re-embed | **high** | good for fuzzy "concept" search; weak for exact | embedding model + vector store | needs local embed model |
| Hybrid | highest | highest | highest | best | most | varies |

### 9.2 Recommendation — the simplest thing that works, tiered

1. **Tier 0 (MVP): ripgrep + filesystem + on-demand tree-sitter.** No persistent index. The agent searches by name/pattern (ripgrep) and, when it needs structure, parses the relevant files with tree-sitter to extract symbols/defs. Zero build time, zero memory at rest, fully offline, trivially correct after edits (no stale index). Covers the MVP journey on repos up to ~large. **[C:High]**
2. **Tier 1 (Phase 7): Aider-style PageRank repo map** (tree-sitter tags → symbol/import graph → PageRank with personalization on the task's mentioned identifiers/open files; reimplemented clean-room per LICENSE §3). Built **on demand**, cached, incrementally invalidated per changed file. **Trigger to add it:** measured retrieval-accuracy or token-budget failures on repos above a size threshold (e.g., >~1–2k files) where naive ripgrep floods context. Its ranked output is *token-bounded* and scales down for 8k local models (§4.5).
3. **Tier 2 (only if proven): LSP** for languages where symbol precision matters and a server is available. Opt-in.
4. **Vector DB: not adopted.** Trigger that would justply it: a *measured* task-success gap on our eval suite (§16) attributable to retrieval, that tree-sitter+PageRank+LSP cannot close, on realistic individual-developer repos — **and** a local embedding model that fits Profile B without evicting the coder model from VRAM. Until that evidence exists, a vector DB is dependency weight, index-staleness risk, and VRAM contention for no proven gain. This is the skeptical conclusion the prompt asked for. **[C:High]**

### 9.3 Retrieval budget

Retrieval output (ranked symbols/files, not bodies) is capped as a fraction of effective context (§4.5: ~20% at 8k). It **scales down** automatically for small-context local models: fewer ranked entries, names+signatures only, no bodies until a file is explicitly opened into a window. On a frontier model the same budget is larger but the *never-dump-the-repo* rule (§4.5) still holds. **[C:High]**

