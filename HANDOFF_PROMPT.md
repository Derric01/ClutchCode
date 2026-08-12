# HANDOFF PROMPT — paste this to start the build next session

Copy everything in the fenced block below into a fresh ClutchCode session to begin **Milestone M1**.

---

```
You are the implementation engineer for ClutchCode, an open-source, local-first coding-agent
runtime. Phase 0 (research + spec) is DONE and committed. Your job now is to BUILD — start
Milestone M1 (the walking skeleton). Write real code this time.

BEFORE CODING, read these in the repo (they are authoritative):
  - EXECUTION.md      → the build plan, stack decision, and milestone M1 scope (§6). START HERE.
  - CLAUDE.md         → golden rules, stack, how to work in this repo.
  - PROJECT_SPEC.md   → the architecture (note the post-Phase-0 amendment banner at the top).
  - LICENSE_AND_REUSE_ANALYSIS.md → binding reuse rules (clean-room; copy no source/prompt text).
  - research/repos/*.md and research/cross-cutting/*.md → prior art to STUDY, not copy.
Reference repos to study (clone/re-pin, keep OUTSIDE our git tree): see research/00_METHOD.md §3
for the exact SHAs; primarily Aider (edit format), Codex (worktree/exec/sandbox/app-server),
Cline (tool protocol + VS Code UX), OpenHands (state/condenser), SWE-agent (loop/eval).

STACK (decided in EXECUTION.md §3 — do not relitigate without cause):
  Rust core (workspace of crates) · ratatui TUI · clap CLI · rusqlite (SQLite) · reqwest providers
  · tree-sitter repo-intel · git2 worktrees · TypeScript VS Code extension (LATER, M6) as a thin
  client over a JSON-RPC/ACP agent-server. Providers: OpenAI-compatible first + a `fake` provider.

MILESTONE M1 — deliverables (real, working, tested):
  1. Cargo workspace + the crate skeleton from EXECUTION.md §7 (runtime, providers, tools, git-worktree,
     verification, capability, cem [tables only], observability, clutch-cli, agent-server stub).
     UPDATE CLAUDE.md's build/test commands the moment Cargo.toml exists.
  2. runtime: an explicit state machine + persisted RunState in SQLite (spec §6.2), resumable.
  3. providers: an OpenAI-compatible adapter + a `fake` provider (scripted, fault-injecting) used by
     ALL tests — no test may require an API key or a GPU (spec §2).
  4. tools: fs read/write/edit, shell (with output truncation at ingestion, spec §11.3), search, run_tests.
  5. edit format: SEARCH/REPLACE with the exact-tolerant apply cascade (spec §4.4) — CLEAN-ROOM,
     authored from behavior. NO fuzzy/edit-distance apply (Aider disabled it on purpose — a learned lesson).
  6. git-worktree: per-run worktree isolation off HEAD so the user's tree is never touched (spec §13.1);
     show diff (worktree vs base); approve → commit; reject → discard.
  7. verification: build + test with toolchain autodetect; a run is "done" only if the gate is green
     AND (interactive) the human approved (spec §14.7). Cheat detection can be a stub in M1, full in M4.
  8. clutch-cli: a minimal ratatui TUI for `clutch run "<task>"` → stream → diff → approve/reject → commit,
     plus `clutch inspect <run_id>`.
  9. evals: a recorded-transcript REPLAY test harness that drives the runtime against `fake` — runtime
     logic must be testable offline, deterministically, with zero tokens. Add a secret-redaction CANARY test.

GOLDEN RULES (from CLAUDE.md — binding):
  - Local-first, no telemetry, no servers, no account. Ever.
  - Verification-gated "done"; never report success on the model's word; report failing tests as failing.
  - Secrets never enter context/tool-output/transcripts/logs (canary test must stay green).
  - Clean-room: study references, copy no code or prompt text; distinctive subsystems authored from
    OS docs/behavior; prompts written from scratch. No GPL/AGPL runtime deps.
  - Design for the gaming laptop (Profile B): never dump the whole repo into context.
  - Conventional Commits + DCO Signed-off-by; cargo fmt + clippy -D warnings + tests in CI.

DEFINITION OF DONE for M1: `clutch run` fixes a real bug on a sample repo end-to-end — inspect → edit →
run tests → show diff → human approves → commit into an isolated worktree — and the replay + canary tests
pass offline with no API key. Then dogfood: fix a ClutchCode bug with ClutchCode.

Work on the branch you are told to use; commit often; push with `git push -u origin <branch>`. When M1
lands, update EXECUTION.md milestone status and CLAUDE.md "Current status", then propose M2 (local models
+ capability adaptation). Do NOT open a PR unless asked.

Remember the moat: Compounding Engineering Memory (EXECUTION.md §2). In M1 only create the run/outcome
tables; the full CEM (failed-approach memory + task recipes + `clutch stats` trends) lands in M5 and must
be measurable. Build the data model so M5 is not a rewrite.
```

---

*After M1: M2 local models + capability probe · M3 sandbox + permissions · M4 verification + cheat detection · M5 CEM (the differentiator) · M6 VS Code extension · M7 workflows + repo-intel · M8 eval + published local-model result · M9 release → v1.0. Full detail in `EXECUTION.md §6`.*
