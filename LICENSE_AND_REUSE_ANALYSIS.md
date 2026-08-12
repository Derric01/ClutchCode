# LICENSE & REUSE ANALYSIS

**Project:** ClutchCode (working name — matches repo)
**Version:** 1.0 · **Date:** 2026-08-12
**Status:** authoritative for the reuse rules that bind the implementation phase.

> This document is written **before** any reuse is proposed, per the research protocol. It governs what the implementation phase may and may not do with each reference project. When uncertain, the verdict is **NEEDS-LEGAL-REVIEW** and ambiguity is **never** resolved in our favor.

---

## 0. TL;DR (the rules that bind Phase 1+)

1. **We adopt Apache-2.0** for ClutchCode (argued in §3).
2. **We use DCO, not a CLA** (argued in §4).
3. **Reuse posture (amended 2026-08-12 by product-owner direction — see `EXECUTION.md §0.5`):** we now **fork-and-extend a permissively-licensed base** (Apache-2.0 or MIT) rather than pure clean-room, to guarantee we are not inferior to the top tools. Forking those bases is legal **with attribution** (preserve `LICENSE`+`NOTICE`, state changes, don't use their marks); this moves them from STUDY-ONLY to **REUSE-WITH-ATTRIBUTION** for the chosen base. **Unchanged hard limits:** Claude Code stays **STUDY-ONLY** (proprietary — never fork); **prompt text** from any tool stays STUDY-ONLY (authored from scratch); **no GPL/AGPL** deps; and inherited **sandbox/exec code is security-audited**, not blind-trusted. Ideas remain free; the only thing we still refuse to copy is proprietary code and creative prompt text.
4. **All extracted system-prompt text is STUDY-ONLY and must never be pasted** into our prompts, tests, or fixtures — including paraphrase-close copies. (§7)
5. **Claude Code is proprietary** (Anthropic Commercial ToS). We read its *docs and public markdown artifacts only*, never decompile the bundle, and never reproduce its prompts or code. (row in §2)
6. **Provider ToS constrain our eval/telemetry** — several providers forbid using their outputs to train/improve a "competing model." We don't train models, but our eval-transcript storage must not be repurposed as training data, and we must document this. (§6)
7. Any subsystem that is a **distinctive algorithm, unusual prompt, or bespoke diff format** is **CLEAN-ROOM-REQUIRED**: spec author ≠ code author, and the spec is written from behavior/docs, not from their source. (§5)

---

## 1. Our license candidates, compared

| Criterion | Apache-2.0 | MIT | AGPL-3.0 | BSL 1.1 |
|---|---|---|---|---|
| Permissive | Yes | Yes | **No (strong copyleft + network clause)** | **No (source-available, non-compete, time-delayed)** |
| Explicit patent grant | **Yes (§3)** | No (implicit at best) | Yes | Varies |
| Patent-retaliation termination | Yes | No | Yes | n/a |
| Individual-dev adoption friction | Low | Lowest | **High** (legal fear, corp bans) | **High** (not OSI-approved) |
| Resists hostile hosted fork | Weak | Weak | **Strong** (must open service source) | **Strong** (non-compete) |
| OSI-approved / "real open source" | Yes | Yes | Yes | **No** |
| Corporate contributor acceptance | High | High | Low | Low |
| Compatible w/ reusing Apache/MIT deps | Yes | Yes | One-way (pulls them into AGPL) | n/a |

**Recommendation: Apache-2.0.** Confidence: **High.**

Reasoning, tied to the project's goal (*maximum individual-developer adoption while resisting a hostile hosted fork*):

- The product is a **local-first CLI/TUI + editor extension that runs on the user's machine**. There is **no hosted service to protect**. AGPL's entire value proposition — forcing a SaaS operator to publish modifications — protects an asset **we do not have**. Adopting AGPL would impose its well-documented adoption tax (corporate policy bans, individual fear) to defend against a threat model (a hostile *hosted* fork of a *local* tool) that barely applies. If someone hosts ClutchCode-as-a-service, that is a *marginal* threat to a tool whose whole point is running locally with the user's own keys.
- **The realistic hostile-fork threat is a vendor rebadging our runtime inside a closed product**, not a SaaS. Apache-2.0's **explicit patent grant (§3) + patent-retaliation clause (§3, termination on patent suit)** is the specific defense that matters here: a downstream party that sues us (or the community) over patents loses its license. MIT gives no such protection. This is the argument for Apache **over MIT**, and it is decisive for an agent runtime that executes code and touches sandboxing/patching techniques where patent trolling is plausible.
- Apache-2.0 is the **lingua franca of infra open source** (k8s, most CNCF, LLVM, Rust's dual license, Terraform pre-BSL). Contributors and their employers already have it pre-approved; that directly serves *contributor supply*, a first-class constraint for an OSS project (§24 of the spec).
- **MIT** is marginally simpler and lowest-friction, but the missing explicit patent grant is a real gap for this domain. We take Apache's slightly heavier NOTICE/attribution machinery as the price of the patent grant.
- **BSL** (Sentry/HashiCorp style) is source-available, not open source; it would forfeit the "genuinely open, no lock-in" positioning that is half the product's reason to exist (§6/§28 of the spec). Rejected.

**One-way-door note:** relicensing *away from* Apache later (e.g., to AGPL) is possible only with all contributors' consent or a CLA (which we are declining). So Apache is effectively a **durable** choice. That is acceptable and intended — we *want* permanence of openness. (See ADR-014 in the spec.)

---

## 2. Per-project license table & reuse verdicts

SPDX identifiers verified by reading each repo's `LICENSE`/`LICENSE.md` at the pinned SHA (see `research/00_METHOD.md §3`).

| Project | License (SPDX) | Copyleft? | Patent grant? | Attribution req. | Compatible w/ our Apache-2.0? | Reuse verdict |
|---|---|---|---|---|---|---|
| Aider | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY** (prompts/ideas); code CLEAN-ROOM |
| OpenAI Codex | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY**; sandbox+patch code CLEAN-ROOM |
| Claude Code | **Proprietary** (Anthropic Commercial ToS) | n/a | No | n/a — all rights reserved | **No** | **STUDY-ONLY (docs/behavior only)** |
| OpenHands | MIT | No | No (implicit) | Copyright + license text | Yes | **STUDY-ONLY**; ideas reusable clean-room |
| Cline | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY**; VS Code patterns CLEAN-ROOM |
| Archon | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** |
| Goose | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY** |
| opencode | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** |
| Crush (Charm) | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** |
| Continue | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY** |
| SWE-agent | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** |
| Roo Code | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY** |
| Kilo Code | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** |
| gptme | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** |
| smolagents | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY** |
| grok-cli (superagent-ai) | MIT | No | No | Copyright + license text | Yes | **STUDY-ONLY** (community tool; not official xAI) |
| gemini-cli | Apache-2.0 | No | Yes | NOTICE + license text | Yes | **STUDY-ONLY** |
| MCP spec | Apache-2.0 (spec text often CC-BY-4.0) | No | Yes | attribution | Yes | **REUSE — protocol impl** (we implement the open protocol) |

**Why nearly everything is STUDY-ONLY even when the license is permissive:** Apache/MIT *permit* copying with attribution, but copying third-party source into our tree creates (a) attribution/NOTICE obligations that accrete and become a maintenance and audit burden, (b) provenance ambiguity that undermines the clean, auditable codebase the security story (spec §16/§19) depends on, and (c) coupling to another project's abstractions. Our default is therefore **reimplement the idea, cite the source in a code comment and in `docs/PRIOR_ART.md`, copy no code.** Verdicts above are *ceilings on what we would consider*, not licenses to paste.

**The one genuine REUSE:** the **Model Context Protocol** is an open protocol meant to be implemented. We implement an MCP client (and optionally server) to the published spec — that is protocol conformance, not code copying. (Spec §15.)

---

## 3. High-risk subsystems → CLEAN-ROOM-REQUIRED

These are the "distinctive algorithm / unusual prompt / bespoke diff format" cases the prompt flags. For each, the **spec author writes from behavior + our own design; a *different* contributor writes the code**, and neither reads the reference implementation's source while writing ours.

| Subsystem | Reference(s) | Why high-risk | Verdict | Spec-vs-code separation |
|---|---|---|---|---|
| SEARCH/REPLACE edit format + fuzzy fallback cascade | Aider `editblock_coder.py` | Distinctive matching cascade; close copying = derivative expression | **CLEAN-ROOM-REQUIRED** | Spec describes the *format contract* and *failure modes* (spec §8); code written independently. The **format syntax** (`<<<<<<< SEARCH` markers) is a de-facto interchange convention shared by Aider/Cline and is not protectable; the *matching implementation* is. |
| `apply_patch` bespoke diff format + fuzzy line-seek | Codex `apply-patch/` | Bespoke format + seek algorithm | **CLEAN-ROOM-REQUIRED** | We design our own patch grammar (or reuse the open SEARCH/REPLACE convention) rather than clone Codex's. |
| Tiered OS sandbox (Seatbelt/Landlock/seccomp/bwrap) | Codex `linux-sandbox/`, Seatbelt policy | Security-critical; subtle | **CLEAN-ROOM-REQUIRED** + **NEEDS-LEGAL-REVIEW** if any policy string is close | We call OS primitives (Landlock, seccomp-bpf, `sandbox-exec`, bubblewrap) directly per their *own* man pages/docs; we do not copy Codex's policy strings verbatim. Seatbelt profiles that are near-identical would be flagged. |
| PageRank repo map | Aider `repomap.py` | Distinctive application of PageRank to tree-sitter symbol graph | **CLEAN-ROOM-REQUIRED** | Idea (PageRank over an import/symbol graph) is not protectable; we build on tree-sitter + a graph lib per their docs. Spec §13. |
| Any extracted system prompt | all | Prompts are creative text → copyrightable | **STUDY-ONLY, never reproduce** | See §7. |

**Rule:** "Reading an implementation to understand a pattern" is allowed and is what this research phase did. "Reproducing its expression" (copying code or prompt text, or paraphrasing so closely it is a derivative) is forbidden. The line is enforced by the spec/code author separation above and by a PR checklist item (§4).

---

## 4. Contributor agreement: CLA vs DCO

| | DCO (Developer Certificate of Origin) | CLA (Contributor License Agreement) |
|---|---|---|
| Contributor friction | Low (`git commit -s`) | High (sign a legal doc, sometimes corporate) |
| Grants project relicensing power | No | Usually yes |
| Signals "no corporate capture" | **Yes** | No (implies a steward who can relicense) |
| Overhead for maintainers | Minimal (bot checks sign-off) | Significant (track agreements) |
| Precedent | Linux kernel, GitLab, most CNCF | Apache Foundation (ICLA), some corp-led projects |

**Recommendation: DCO.** Confidence: **High.** For a project whose pitch is *"open, no lock-in, no corporate capture,"* a CLA that lets a steward relicense is self-contradictory and adds adoption friction. DCO + Apache-2.0 gives every contributor certainty that the project cannot be closed. Enforce with a DCO check bot; require `Signed-off-by` on every commit. (See ADR-015.)

**PR checklist item (binds implementation):** every PR affirms "contains no code or prompt text copied from a reference project; patterns reimplemented independently."

---

## 5. Provider Terms-of-Service constraints on eval & telemetry

We store transcripts for the eval harness (spec §20) and run inference against provider APIs. Several providers' ToS restrict using their **outputs** to develop or improve a **competing model**. We do **not** train models (explicit non-goal, spec §27), which removes the sharpest edge — but the constraint still shapes design:

| Provider | Publicly-stated relevant restriction (as generally documented; **verify at build time**) | Design consequence for us |
|---|---|---|
| OpenAI | ToS restrict using outputs to develop competing models; data-usage/retention settings vary by product (API vs consumer). | Eval transcripts are for *runtime regression*, never model training. Label & silo them. Document that API data is subject to OpenAI retention. |
| Anthropic | Commercial ToS / usage policies restrict competing-model development; API data handling per their policy. | Same. Claude Code specifically is proprietary — see §2. |
| Google (Gemini) | Free-tier data may be used to improve Google products; paid/Vertex differs. | Warn users that *free-tier Gemini* may train on their code; recommend paid/Vertex for private repos. Surface in `agent doctor`. |
| xAI (Grok) | ToS per xAI. | Same generic caution. |
| Groq / DeepSeek / OpenRouter | Vary; OpenRouter is a router — downstream provider terms apply. | Surface the *effective* downstream provider so the user knows whose ToS governs. |
| Local (Ollama/llama.cpp/vLLM/LM Studio/MLX) | **None** — no third party sees data. | This is the privacy-maximal path and the product's ideological core (Profile D). |

**Binding rules for our design (spec §19 Observability, §9 Credentials):**
- **`UNVERIFIED:` — exact current ToS clauses were not re-read verbatim during this research pass.** Treat the table as *design guidance*, and re-verify each provider's current terms before shipping the honesty disclosures. This is logged as an OPEN QUESTION with owner = maintainers.
- Eval/transcript stores are **never** offered as a training corpus and are **local-only** (no telemetry servers exist — spec §19/§21).
- `agent doctor` and docs must **truthfully disclose, per selected provider, what that provider necessarily sees and its stated retention/training posture** (spec §9 user-facing honesty obligation).

---

## 6. Trademark & naming

- We must **never imply endorsement by Anthropic, OpenAI, xAI, or Google.** No use of "Claude," "Codex," "GPT," "Gemini," "Grok" in our product name, and any "works with X" phrasing must be nominative-fair-use only ("compatible with the OpenAI API format"), not branding.
- Our own name (**ClutchCode**, matching the repo) must be trademark-cleared before any release-branding push (**NEEDS-LEGAL-REVIEW** at release time, owner = maintainers). Provider/model *names* appear only in provider-adapter identifiers and docs, factually.
- Reusing another project's **name or logo** is out of scope; we cite prior art by name in `docs/PRIOR_ART.md` as attribution/credit, which is fair and expected in OSS.

---

## 7. Prompt text is STUDY-ONLY (explicit, binding)

System prompts extracted from other agents (Aider's SEARCH/REPLACE prompt, Claude Code's subagent personas, Codex's system prompt, etc.) are **creative text and copyrightable**. They are **STUDY-ONLY**:

- We may **read and analyze prompt structure** as an engineering artifact (this research did so).
- We **may not** copy prompt text, and **may not** paraphrase so closely that ours is a derivative.
- Our prompts are **written from scratch** against our own design, and reviewed for independence.
- **This rule binds the implementation phase**: the Phase-1 prompt author writes original prompts; a reviewer confirms no reference prompt was open during authoring. Recorded as ADR-016 and as a PR-checklist affirmation.

---

## 8. Net effect on the build

- Codebase is **clean-room from day one**: patterns in, expression out.
- License compatibility is a non-issue because we copy no code; the only *inbound* license we rely on is our own dependencies' (chosen to be Apache/MIT/BSD-compatible; **no AGPL/GPL runtime deps**, which would virally relicense us — enforced by a license-scanner in CI).
- The single largest legal risk is **accidental prompt/algorithm copying**; §3/§7 controls address it directly.
- Open items for legal review at release: our name clearance (§6), verbatim re-read of each provider ToS (§5). Both logged with owners in the spec's OPEN QUESTIONS register.
