# ClutchCode — Engineering Handoff

**As of:** 2026-08-14 · **Branch:** `claude/handoff-prompt-implementation-ceqb5l` ·
**Head:** `83d3d19` ("Add repo-intel: on-demand tree-sitter symbol extraction (§9)")

This is a status handoff for whoever (human or agent) picks up ClutchCode
next. It's deliberately honest about what's *not* done — that's more useful
to you than a clean-sounding summary. For how the code is organized and the
day-to-day commands, see `CLAUDE.md`; for the full design, see
`PROJECT_SPEC.md`. This document is the "where things stand" layer between
the two.

## 1. Status in one line

**Phase 1 (MVP, PROJECT_SPEC.md §21) is complete and then some.** Every row
in the MVP column of the §21.1 phasing table is implemented and tested,
plus several items from the "beyond MVP" gap list that a first pass at this
spec would plausibly skip (see §2 below). 53 test files / 291 tests pass;
clean `tsc -b`; zero eslint warnings. Nothing in this repo has been run
against a real model or a real API key — everything is verified via
`FakeProvider` and real (but tokenless) git/filesystem/toolchain operations,
per the model-stubbable design in ADR-020.

## 2. What's actually implemented

Mapped to `PROJECT_SPEC.md §21.1`'s phasing table, not to task-list
optimism:

| Area | Spec column | State here |
|---|---|---|
| CLI (`run/diff/approve/commit/reject/inspect/resume/status/doctor/trust/providers`) | MVP | Done — `apps/cli` |
| Providers: OpenAI-compatible, Ollama, **and Anthropic native** | MVP (+Anthropic listed as MVP row) | Done — `packages/providers`, plus `FakeProvider` for tests |
| Capability probe + edit-format fallback | MVP | Done — `packages/capability` (`runCapabilityProbe`, `selectEditFormat`) |
| SEARCH/REPLACE edits + whole-file fallback | MVP | Done — `packages/tools/src/edit-cascade.ts` |
| Shell + tests + toolchain autodetect | MVP | Done — `packages/verification/src/toolchain.ts` |
| Verification gate + cheat detection | MVP | Done — `packages/verification` (6 detectors, §14.6) |
| Git worktree isolation + diff review | MVP | Done — `packages/git` |
| Sandbox Tier 0 + Tier 1 (Linux) | MVP | Tier 0 done; **Tier 1 (bwrap) implemented but not live-tested** — see §4 |
| Runtime replay-test harness (§16.3c) | MVP | Done — `evals/src/replay.ts` + 3 recorded transcripts (`evals/fixtures/*.json`) |
| Repo intel: ripgrep + tree-sitter | MVP | Done for JS/TS/TSX — `packages/repo-intel`; ripgrep-equivalent is `packages/tools`' `search` tool |
| Workflow engine: built-ins | MVP | Done — single default workflow (§21 explicitly scopes MVP to one workflow) |
| VS Code extension (Agent API client) | MVP = API boundary only, **extension ships Phase 2** | API boundary (`packages/agent-api`) done; **extension itself does not exist** |
| Memory: AGENTS.md | MVP = basic read | Read + system-prompt injection + toolchain-command overrides done. Correction UX (`agent memory`, Phase 2) not started |

Beyond the literal MVP bar, also implemented in this pass: context budgeting
(§4.5), text-protocol tool-call emulation for models without native
tool-calling (§4.8), impacted-test selection as a pipeline fast-path
(§14.4), and secret redaction enforced at every tool/tool-arg boundary
(§5.2) with a dedicated canary test (`evals/src/redaction-canary.test.ts`).

## 3. Verify it yourself

```sh
pnpm install && pnpm build && pnpm test && pnpm lint
```

Expect: clean install (native tree-sitter addons build via `node-gyp-build`),
clean `tsc -b`, **53 test files / 291 tests passing**, zero eslint output.
See `CLAUDE.md`'s Commands section for scoping to a single package/test.

## 4. Known gaps and honest caveats

These aren't a TODO list dressed up — each is a real limitation with a
reason, so the next person doesn't have to rediscover why:

- **Sandbox Tier 1 (bwrap) is argv-tested, not live-tested.** `bwrap` isn't
  installed in the environment this was built in, so
  `packages/sandbox/src/tier1-linux.test.ts` covers argv construction only.
  Before trusting Tier 1 in production, run it against a real `bwrap`
  binary and confirm the confinement (no network, no reads outside
  the ro-binds, no writes outside the workspace) actually holds.
- **macOS Seatbelt and Windows/WSL2 sandbox tiers don't exist.** The spec's
  §21.1 table scopes Windows/WSL2 hardening to Phase 2 explicitly; macOS
  Seatbelt was never started this pass (Linux bwrap was the one Tier 1
  target picked up).
- **repo-intel covers JS/TS/TSX only.** `tree-sitter-python`,
  `tree-sitter-go`, and `tree-sitter-typescript` pin mutually incompatible
  `tree-sitter` core peer-dependency ranges — confirmed via `npm view
  <pkg> peerDependencies`, not assumed. Adding another language means
  either finding a compatible version combination or accepting multiple
  `tree-sitter` core versions in the tree (pnpm can do this, but it wasn't
  attempted here).
- **VS Code extension doesn't exist.** The Agent API boundary
  (`packages/agent-api`) was explicitly designed so this can be a thin
  stdio-JSON-RPC client (ADR-011) without touching `apps/cli` or the
  runtime, but no extension code has been written.
- **`agent resume` is thin, not mid-run resumption.** It re-attaches to a
  persisted `RunState` and reports it; it does not resume an in-flight
  loop. This matches the spec's own MVP scope (`agent.ts`'s `resume()`
  docstring says as much) — full resume-hardening is a Phase 2 item.
- **No model routing (local↔API escalation), no Gemini provider, no
  constrained-decode support.** All three are Phase 2 per the spec table;
  none started.
- **No eval scoreboard.** Only the recorded-transcript replay harness
  (§16.3c) exists. A SWE-bench-subset scoreboard is a Phase 2 item and
  would need real model runs (this repo's tests deliberately use none).
- **No packaging.** There's no single-binary or Homebrew distribution;
  today this only runs from a built pnpm workspace (`node
  apps/cli/dist/cli.js ...`).
- **`docs/adr/` is an empty directory.** The ADRs it's meant to hold
  (ADR-001 through ADR-020, cited by number throughout the code as
  comments) currently live only as prose in `PROJECT_SPEC.md §26`. Nobody
  has extracted them into individual files yet — minor, but worth doing
  before the ADR numbers scattered through the code start feeling like
  dead links.
- **Multi-agent orchestration is intentionally absent** — the spec scopes
  it to Phase 9 (§7, ADR-010) and nothing here contradicts that.

## 5. Suggested next priorities

In the order I'd tackle them, with the reasoning:

1. **Live-test sandbox Tier 1 against a real `bwrap` binary.** This is a
   security boundary that has only been argv-tested; that's the highest-
   risk gap relative to what it'd cost to close (get a Linux box with
   `bwrap`, run the existing `shell` tool through it, confirm the deny-by-
   default confinement holds against a few adversarial probes — network
   access, reading outside ro-binds, writing outside the workspace).
2. **VS Code extension.** The spec calls it a required fast-follow, not a
   someday item (§21: "the user requires it"), and the boundary it needs
   (`agent-api`) is already built and tested — this is now mostly RPC
   plumbing plus UI, not new architecture.
3. **`agent memory` correction UX for AGENTS.md** (Phase 2 per §21.1) —
   the read path is solid; a write/correction path is the natural next
   step and is low-risk relative to sandboxing or the extension.
4. **Extend repo-intel past JS/TS/TSX** once a compatible `tree-sitter`
   core version combination is found for Python/Go, or accept multiple
   core versions coexisting in the dependency tree.
5. **Eval scoreboard against a SWE-bench subset** (§16) — genuinely useful
   but needs real model access/tokens, which is why it wasn't attempted in
   this token-free pass.

## 6. Where things live

- State (run history, events): `~/.local/state/clutchcode/` (override via
  `--state-dir` / `Agent`'s constructor).
- Capability profiles (probed models): `~/.config/clutchcode/models/*.toml`
  (override via `--config-dir`).
- Per-repo config: `agent.toml` at the repo root (optional; see
  `packages/agent-api/src/config.ts`).
- Recorded eval transcripts: `evals/fixtures/*.json` (used by the replay
  harness, §16.3c).

## 7. Recent history

```
83d3d19 Add repo-intel: on-demand tree-sitter symbol extraction (§9)
d6ad09c feat: sandbox Tier 1 — Linux bubblewrap confinement (§12.5, §12.6)
4d3a2de feat: context budgeting (§4.5)
93af4c6 feat: close MVP gaps — capability adaptation layer (§4), test selection, AGENTS.md wiring
cdc1500 feat: Phase 1 MVP implementation — agent runtime, tools, verification, CLI
```

The first MVP pass (`cdc1500`) covered the literal §21 bar. The four
commits after it (`93af4c6` through `83d3d19`) closed the gap between "an
MVP that technically satisfies the phasing table" and an actually-adaptive
runtime — capability probing, tool-call emulation, edit-format downgrade,
context budgeting, AGENTS.md wiring, test selection, sandbox Tier 1, and
repo intelligence. That gap-closing work is what most of this handoff's
"what's implemented" section (§2) describes.
