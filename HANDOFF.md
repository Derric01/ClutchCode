# HANDOFF

Read this first when picking up ClutchCode work in a new session. It's the
point-in-time complement to `PROJECT_SPEC.md` (the permanent architecture
doc, don't edit it lightly) and `CLAUDE.md` (evergreen dev reference) —
this file says **what's actually built, what's next, and why**, and should
be updated at the end of every session that changes that picture.

## Status as of 2026-08-14

**Phase 1 (MVP) shipped and merged (PR #2). Phase 2 in progress: the
capability-probe / context-budget / edit-format-selection "adaptation
layer" (§4.2) now exists and is wired into live runs**, but several
Phase 2/3 items named in PR #2's own follow-up list are still open. 266
tests passing, clean `tsc -b`, zero ESLint warnings, verified against the
real CLI binary — that bar should hold for every future change too (see
"How to continue" below).

Branch: `claude/handoff-prompt-continuation-9dcwue`. Two commits landed
this pass — read their full messages (`git log`) for the detailed
rationale behind each choice; this doc summarizes, doesn't replace them.

1. **`feat: capability probe, context budgeter, edit-format selector
   (§4.9/§4.5/§4.4)`** — new `@clutchcode/capability` package:
   `runCapabilityProbe` (six deterministic checks against any `Provider`),
   `CapabilityProfile` persistence (`~/.config/clutchcode/models/<id>.toml`),
   `computeContextBudget`, `selectEditFormat`. Exposed via
   `clutchcode models probe <model>` / `models list`.
2. **`feat: wire the capability profile into the live AgentLoop`** —
   `Agent.run()` now looks up a persisted profile for the run's model and
   threads it into `AgentLoop`, which derives a context budget (caps
   `maxOutputTokens`) and injects edit-format guidance as a system
   message. `RunState.capabilityProfileId`/`contextBudget` are populated
   and surfaced in `agent status`/`inspect`. No profile for a model (the
   default, common case) changes nothing — this is additive.

## What's NOT done yet (prioritized)

Everything below is a genuine gap, not a silently-dropped one — each was
either named explicitly in a commit message or is a straightforward
reading of `PROJECT_SPEC.md §21`'s phase table. Ordered roughly by
"natural next step" given what already exists:

1. **Per-file edit-format selection isn't used at edit time.**
   `selectEditFormat(profile, file)` exists and is tested
   (`packages/capability/src/edit-format.ts`), and its *general* guidance
   (`describeAdaptationGuidance`) is injected as a system-prompt note —
   but nothing in `AgentLoop` calls `selectEditFormat` per target file
   (it needs `{isNew, loc}` for the specific file being edited, which the
   harness doesn't currently know before the model picks a file). A real
   integration would have `edit_file`/`write_file` tool exposure or
   validation react to the decision for the file actually being touched.
   Medium scope, self-contained to `packages/tools` + `packages/runtime`.

2. **Context budget only enforces the output-token segment.** The other
   four segments (`systemAndTools`, `repoMapRetrieval`, `openFileWindows`,
   `conversationHistory`) are computed and visible on `RunState` but
   nothing trims prompt content to fit them — the loop still sends full
   message history and full tool-read output (bounded only by
   `packages/tools/src/truncate.ts`'s independent truncation, not the
   budget). Real enforcement needs history compaction/summarization
   checkpoints (§10, doesn't exist yet) and file-window discipline on
   reads. This is the biggest remaining piece of "the agent never gets
   the whole repo dumped into context" (§4.5) and the most architecturally
   involved item on this list.

3. **OS sandbox Tier 1** (§12.5/§12.6) — macOS Seatbelt / Linux
   bwrap+Landlock process confinement. Only Tier 0 (policy engine +
   denylist + redaction + env scrubbing, no OS-level confinement) exists
   today. Platform-specific, needs per-OS integration tests (can't fully
   verify Seatbelt behavior in this Linux container, for instance) —
   scope this as at least two efforts (macOS, Linux) rather than one PR.

4. **OS keychain credential storage** (§5.1 tiers 1-2) — only the env-var
   tier (tier 3) exists (`packages/agent-api/src/credentials.ts`). Needs
   `security` (macOS) / `secret-tool`/libsecret (Linux) / Credential
   Manager (Windows) integration behind the same `Credentials` interface.

5. **Mid-run `resume` hardening** — `agent resume` (§18.2) currently just
   re-attaches to a persisted `RunState` and reports it; actually
   continuing an in-flight `AgentLoop` from a paused/interrupted point
   isn't implemented.

6. **VS Code extension** (§18.5) — the Agent API boundary exists
   specifically so this can be a thin client, but no `apps/vscode` exists
   yet. Large, separate effort.

7. Smaller/later per the phase table (§21.1): Gemini native adapter +
   constrained-decode hooks, model routing (§4.6, local↔API escalation),
   user-declarative workflows (§8, only built-ins exist), eval scoreboard
   (SWE-bench subset, §16), repo-intel PageRank map (§9, only
   ripgrep+tree-sitter-tier exists), memory correction UX (§10.3, only
   basic AGENTS.md read exists), single-binary/Homebrew install.

## How to continue

1. Read this file, then skim the last few `git log` messages for detail
   this file compresses away.
2. Cross-check against `PROJECT_SPEC.md §21.1`'s phase table and `§25`'s
   roadmap table before picking a task — they're the source of truth for
   scope and phase ordering if this list and the spec ever disagree.
3. Pick **one** coherent, self-contained item (not "do Phase 2"). Prefer
   finishing something already started (item 1 or 2 above) over opening a
   new platform-specific front (sandbox/keychain) unless asked.
4. Match the existing bar: real implementations, no stubs; new tests
   alongside the code (co-located `*.test.ts`, `FakeProvider`-driven, no
   network); `pnpm build && pnpm test && pnpm lint` clean before
   committing; explicitly name what you *didn't* do in the commit
   message, the way this session's two commits and PR #2 did — don't
   silently drop scope.
5. Update this file's "Status" and "What's NOT done yet" sections before
   ending the session, so the next one doesn't have to re-derive them
   from spec archaeology and PR bodies the way this session had to.

## Orientation pointers

- `PROJECT_SPEC.md` — architecture bible, section numbers (`§N`) are cited
  everywhere in code comments and commits. `CLAUDE.md` — dev commands,
  package boundaries, testing conventions. Read both before this file if
  you haven't worked in this repo before.
- `LICENSE_AND_REUSE_ANALYSIS.md` §3 — which subsystems are clean-room
  required (don't read reference-project source for these; see
  `CLAUDE.md`).
- Repo layout: `packages/{sandbox,tools,providers,git,verification,
  capability}` are leaves; `runtime` orchestrates them; `agent-api` is the
  one boundary `apps/*` may depend on. `evals/` is the recorded-transcript
  replay harness; `tests/` is the cross-package binary-spawning e2e test.
