# Tier-2 others — combined repo notes

Compressed notes (most-relevant fields) for the remaining Tier-2 targets. Each verified at clone (`research/00_METHOD.md §3`); depth is lighter than Tier-1 — claims are structure-derived + prior art, `UNVERIFIED:` where noted. The breadth sub-agents that would have deep-read these hit the session usage limit (see `00_METHOD.md §2`).

---

## Crush (Charm) — `charmbracelet/crush` @ `804324f` · MIT · Go (~594 .go files)
- **What/why:** TUI-first coding agent from Charm (the Bubble Tea people). Study for **terminal ergonomics**.
- **Architecture:** Go single-binary; `crush.json` config; provider-agnostic. Uses a **CLA** (`CLA.md`) — contrast to our DCO.
- **Provider/local:** multi-provider incl. local (OpenAI-compat/Ollama). UNVERIFIED depth.
- **Reusable:** best-in-class **TUI polish** patterns; single-binary Go distribution (a data point for our §18.6 — but see §19: we keep TS for the shared runtime); provider-agnostic config.
- **Do-not-copy:** Go core (second-language cost vs VS Code extension); CLA model.

## Roo Code — `RooCodeInc/Roo-Code` @ `b867ec9` · Apache-2.0 · TypeScript
- **What/why:** A **fork of Cline** that adds **modes/personas** (Architect, Code, Ask, Debug, custom modes) and more auto-approval/customization. Study for **mode/persona systems** and **Cline-fork divergence**.
- **Architecture:** Cline lineage (VS Code extension, XML tool protocol, SEARCH/REPLACE edits) + a **custom-modes system** (each mode = role prompt + tool permissions + file-pattern restrictions).
- **Reusable:** **modes = (persona prompt + tool allowlist + file scope)** — a lightweight, declarative way to specialize behavior without multi-agent (aligns with our single-agent-with-roles stance, §7); per-mode tool restriction mirrors our permission classes (§12.2).
- **Do-not-copy:** editor-coupled agent logic (we use a shared runtime); prompt text STUDY-ONLY.

## Kilo Code — `Kilo-Org/kilocode` @ `f711547` · MIT · TypeScript
- **What/why:** Another **Cline/Roo-lineage** VS Code agent (superset-style: merges Roo + Cline features, adds marketplace, MCP). Study **fork divergence** + feature-superset risk.
- **Reusable:** confirms the **mode system + MCP + multi-provider** pattern is convergent across the Cline family; a data point that editor-agent UX has consolidated on XML-tool + SEARCH/REPLACE + approval.
- **Do-not-copy:** feature-superset sprawl (scope discipline, our §21/§23.5); editor-coupled logic.

## gptme — `gptme/gptme` @ `fce2fbe` · MIT · Python
- **What/why:** **Minimal-loop reference.** A small, hackable terminal agent — good for seeing the *irreducible core* of a coding agent.
- **Architecture:** compact loop; tools via a simple registry (shell, python, file patch, browser); local + API providers; markdown-logged conversations.
- **Reusable:** the **minimal viable loop** (read → tool → observe → repeat) validates our aggressively-small Phase 1 scope (§21); simple **tool registry** design; markdown/append-only logging.
- **Do-not-copy:** minimalism omits sandbox/verification/worktree — exactly the layers we add as differentiators.

## smolagents — `huggingface/smolagents` @ `e3a5b89` · Apache-2.0 · Python
- **What/why:** **Minimal agent library**, not a coding CLI. Notable idea: **"code agents"** — the model writes **Python code** as its action (executed in a sandbox) instead of emitting JSON tool calls.
- **Reusable:** the **code-as-action** idea (cf. OpenHands CodeAct) is a powerful tool-emulation strategy for capable models; smolagents' **sandboxed code execution** (e2b/docker/wasm options) is a study for §12; its tiny core is a design-clarity reference.
- **Do-not-copy:** code-as-action is risky for *weak* local models (harder to constrain than SEARCH/REPLACE) — we default to structured edits (§4.4), not free Python; library scope ≠ our product scope.

## grok-cli — `superagent-ai/grok-cli` @ `fb97af8` · MIT · TypeScript
- **Existence check:** the prompt's `xai-org/grok-cli` **does not exist**; this is a **community** tool, **not official xAI** (`00_METHOD.md §4`). No endorsement by xAI implied (LICENSE §6).
- **What:** a lightweight terminal agent targeting Grok via the xAI API (OpenAI-compatible), tool-use loop, text editor tools. UNVERIFIED depth.
- **Reusable:** confirms xAI/Grok is reachable via an **OpenAI-compatible** adapter (§4.7) — no special-casing needed.
- **Do-not-copy:** nothing notable; treat as a thin community client.

## gemini-cli — `google-gemini/gemini-cli` @ `1ac3377` · Apache-2.0 · TypeScript
- **What/why:** Google's official terminal agent for Gemini. Study for a **native Gemini adapter** + tool/loop patterns.
- **Architecture:** TS CLI; native Gemini API; tool-use loop; MCP support; config for models/tools. UNVERIFIED depth.
- **Reusable:** informs our **Gemini native adapter** (Phase 2, §4.7) — Gemini's function-calling + safety settings differ enough from OpenAI-compat to warrant a native path; also a large-context reference.
- **Do-not-copy:** Google-account/telemetry couplings; Gemini-only assumptions; free-tier-trains-on-data caveat (surface to user, LICENSE §5).

---

### Cross-Tier-2 takeaways
1. **Convergence:** the Cline family (Cline/Roo/Kilo) has standardized editor coding-agent UX on **XML text tools + SEARCH/REPLACE + human approval + MCP** — strong signal for our §4.8/§4.4/§18.
2. **ACP** appears in OpenHands-canvas + Goose → validates our ACP-shaped Agent API (§18.5).
3. **Modes = persona prompt + tool allowlist + file scope** (Roo) is a clean single-agent specialization that avoids multi-agent cost (§7).
4. **Minimal loops** (gptme/smolagents) confirm the Phase 1 core is small; our value is the layers *around* it (sandbox, verification, worktree, adaptation).
5. **Provider reach:** Grok/Gemini/local all reduce to **OpenAI-compat + a few native adapters** (§4.7).
