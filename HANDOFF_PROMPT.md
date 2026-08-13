# HANDOFF PROMPT — paste this to start the build next session

Copy everything in the fenced block below into a fresh ClutchCode session. It starts with **M0 (fork Codex, carve, de-cloud, green)** and then **M1 (the walking skeleton)**.

---

```
You are the implementation engineer for ClutchCode, an open-source, local-first coding-agent
runtime. Phase 0 (research + spec) is DONE and committed. BUILD now — write real code.

BEFORE CODING, read (authoritative, in the repo):
  - EXECUTION.md      → build plan; START at §0.5 (fork-and-extend + BYO-key) and §6 (M0, M1).
  - CLAUDE.md         → golden rules, stack, how to work here.
  - PROJECT_SPEC.md   → architecture (note the amendment banner at the top).
  - LICENSE_AND_REUSE_ANALYSIS.md → reuse rules (fork permissive bases WITH attribution; Claude
                        Code + all prompt text stay STUDY-ONLY; no GPL/AGPL deps).
  - research/repos/codex-cli.md and the other research notes → prior art.

SETUP FIRST: run `bash scripts/fetch-references.sh` to clone Codex (the fork base) + the study repos
at their pinned SHAs into ../clutchcode-references (OUTSIDE our git tree). The scratch clones from the
research session are gone — you must re-fetch.

BASE (decided & verified real): fork **openai/codex** (Apache-2.0, Rust, ratatui TUI, best-in-class
Landlock/seccomp/Seatbelt/bwrap sandbox, apply_patch, codex-mcp, app-server). It is OpenAI's official
CLI (~1.35M LOC — real, not a stub) but BIG and cloud-coupled.

⚠️ M0 IS THE HARDEST, RISKIEST STEP — do it carefully, not fast. Deleting the cloud crates
(analytics/chatgpt/cloud-tasks/backend-client/aws-auth/connectors/feedback) will break compilation in
crates that depend on them; untangling that in a 1.35M-line unfamiliar Rust monorepo is real work. Do
M0 in small commits (delete a crate → fix the fallout → build green → commit), not one big bang. This
step benefits from a stronger model and/or human review before trusting the result. Also add a /NOTICE
file carrying Codex's NOTICE content, and fill docs/PRIOR_ART.md as you go.

=== MILESTONE M0 — fork, carve, de-cloud, green (do this FIRST) ===
  1. Re-clone openai/codex at the pinned SHA in research/00_METHOD.md §3, re-home under crates/.
  2. CARVE OUT the local-first core — KEEP: core, tui, apply-patch, linux-sandbox, bwrap, execpolicy,
     exec-server, codex-mcp, file-search, git-utils, config, keyring-store, app-server.
     DELETE the cloud/account/telemetry crates: analytics, chatgpt, cloud-tasks*, backend-client,
     aws-auth, connectors, feedback (and anything that phones home).
  3. RENAME everything Codex/OpenAI-branded → ClutchCode; remove marks + endorsement implications.
  4. Preserve upstream LICENSE + NOTICE; create docs/PRIOR_ART.md crediting Codex and the others.
  5. SECURITY-AUDIT the inherited sandbox/exec crates before trusting them (we ship a tool that runs
     LLM-generated commands — do not blind-trust inherited isolation).
  6. Add a NO-PHONE-HOME test (no network egress at rest) and scaffold the OFFLINE release-gate test.
  7. Get cargo build + cargo clippy -D warnings + cargo test green as ClutchCode.
  8. UPDATE CLAUDE.md build/test commands and "Current status" the moment this is green.
  M0 DoD: clutch builds, no telemetry, runs a task against an OpenAI-compatible base_url.

=== MILESTONE M1 — walking skeleton (after M0 is green) ===
  - runtime: explicit state machine + persisted RunState in SQLite (spec §6.2), resumable.
  - providers: OpenAI-compatible adapter (base_url + key: OpenAI/Groq/OpenRouter/DeepSeek/Ollama/
    llama.cpp/LM Studio) + a `fake` provider used by ALL tests (no test needs an API key or GPU).
    BYO-key UX: `clutch providers add <name>` → OS keychain (keyring-store) → `clutch models`.
  - tools: fs read/write/edit, shell (truncate output at ingestion, spec §11.3), search, run_tests.
  - edit: reuse Codex apply_patch AND add SEARCH/REPLACE with the exact-tolerant cascade (spec §4.4);
    NO fuzzy/edit-distance apply (Aider disabled it on purpose).
  - git-worktree: per-run worktree isolation off HEAD (spec §13.1) → diff → approve→commit / reject→discard.
  - verification: build+test with toolchain autodetect; "done" only if the gate is green AND (interactive)
    the human approved (spec §14.7). Cheat-detection stub now, full in M4.
  - TUI: adapt the inherited ratatui UI for `clutch run "<task>"` → stream → diff → approve/reject → commit;
    plus `clutch inspect <run_id>`.
  - evals: a recorded-transcript REPLAY harness driving the runtime against `fake` (offline, deterministic,
    zero tokens) + a secret-redaction CANARY test.
  - cem: create the run/outcome SQLite tables ONLY (full Compounding Engineering Memory is M5) — design the
    schema so M5 is not a rewrite.
  M1 DoD: `clutch run` fixes a real bug on a sample repo end-to-end (inspect→edit→test→diff→approve→commit)
  in an isolated worktree, with replay + canary tests green offline and no API key. Then dogfood: fix a
  ClutchCode bug with ClutchCode.

GOLDEN RULES (binding — from CLAUDE.md):
  - Local-first, no telemetry, no servers, no account. Ever. Offline test is a release gate.
  - Verification-gated "done"; never claim success on the model's word; report failing tests as failing.
  - Secrets never enter context/tool-output/transcripts/logs (canary test stays green).
  - Fork permissive bases WITH attribution; author prompts from scratch; Claude Code stays study-only;
    no GPL/AGPL runtime deps (CI license-scan).
  - Design for the gaming laptop (Profile B): never dump the whole repo into context.
  - Conventional Commits + DCO Signed-off-by; fmt + clippy -D warnings + tests in CI.

BYO-key = first-class: a user's own Claude/GPT/Groq key runs the SAME model the paid tools run, so on
capability we are NOT inferior — we add verification + worktree safety + CEM on top. A frontier key and a
local model are the same code path; only the adapter + capability profile differ.

Work on the branch you're told to use; commit often; push with `git push -u origin <branch>`. When M0 and
M1 land, update EXECUTION.md milestone status + CLAUDE.md "Current status", then propose M2 (local models +
capability probe + native Anthropic). Do NOT open a PR unless asked. Remember the moat is CEM (EXECUTION.md
§2) — build the M1 data model so M5 can land without a rewrite.
```

---

*Milestones after M1: M2 local models + capability probe + native Anthropic · M3 sandbox+permissions hardening · M4 verification + cheat detection · M5 CEM (the differentiator, measurable) · M6 VS Code extension · M7 workflows + repo-intel · M8 eval + published local-model result · M9 release → v1.0. Full detail in `EXECUTION.md §6`.*
