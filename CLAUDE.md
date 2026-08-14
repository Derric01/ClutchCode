# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ClutchCode is a model-agnostic, local-first coding-agent runtime and harness
(think: a from-scratch, open, model-swappable analogue of Claude Code /
Aider / OpenHands). **`PROJECT_SPEC.md` is the authoritative design
document** — every section (`§N`) referenced in code comments and commit
messages points there. Read `HANDOFF.md` first for current status and
what to build next; it is kept up to date across sessions and is more
current than this file for "what's done / what's not."

## Commands

```sh
pnpm install          # workspace install (pnpm, not npm/yarn)
pnpm build             # tsc -b across all packages, dependency-ordered
pnpm test               # vitest run, whole repo
pnpm test:watch          # vitest watch mode
pnpm typecheck             # tsc -b (no emit change; same as build here)
pnpm lint                   # eslint .
pnpm clean                   # rm -rf dist/*.tsbuildinfo in every package
```

Run a single test file or a single test by name:

```sh
pnpm vitest run packages/capability/src/probe.test.ts
pnpm vitest run -t "scores a well-behaved model high"
```

`tsc -b` is a **composite project-references build** — packages must be
built in dependency order. `pnpm build` / `pnpm -w exec tsc -b` from the
repo root handles that automatically; building a single package's `dist/`
in isolation (`pnpm --filter @clutchcode/foo build`) will fail with
"cannot find module" if its workspace dependencies haven't been built yet.
After adding a new package or a new `workspace:*` dependency edge between
existing packages, run `pnpm install` again before `tsc -b` — pnpm's
workspace symlinks won't exist yet otherwise.

Run the built CLI directly (useful for end-to-end smoke tests beyond what
vitest covers):

```sh
node apps/cli/dist/cli.js run "some task" --repo <path> --provider fake --model n/a --yes
node apps/cli/dist/cli.js models probe <model-id> --provider ollama
```

Commits are DCO-signed per `CONTRIBUTING.md` (`git commit -s`), Apache-2.0 +
DCO, not a CLA.

## Testing philosophy — read this before writing a test

**Nothing in this codebase should need a real API key, GPU, or network call
to test.** `FakeProvider` (`@clutchcode/providers`) is a scripted,
fault-injecting stand-in for every model call; almost every test in the
repo drives the system through it. When you add a feature that talks to a
`Provider`, write its test against `FakeProvider`, not a real adapter.
`buildProvider({kind: "fake"})` (used by `agent run --provider fake` and
most CLI/agent-api tests) is a **single-turn no-op stub** — enough for one
dry-run step, not enough to drive a multi-request flow like the capability
probe. If a test needs many turns from a "fake" model, script your own
`FakeProvider` instance directly rather than routing through that shared
stub (see `packages/agent-api/src/capability.ts`'s `buildProbeProvider` for
the pattern).

Tests that touch real subprocesses do so deliberately and for a reason:
`tests/integration.test.ts` spawns the actual built `clutchcode` binary
against a real git repo; `AgentLoop` tests build a real (temp) git worktree
and run a real `npm test`/`node` subprocess through the verification
pipeline — this is what makes cheat detection and toolchain autodetection
trustworthy. Don't mock those away; follow the existing fixture pattern
(`setupAgentLoopFixture`, `makeSampleRepo`, `makeTempDir` in each package's
`test-helpers.ts`).

## Architecture

### Package boundary rule (non-negotiable, §20)

`apps/*` depend **only** on `@clutchcode/agent-api` — never reach into
`@clutchcode/runtime`, `@clutchcode/providers`, etc. directly from CLI code.
`agent-api` is the one binding surface; a future stdio/JSON-RPC binding
(for an editor client) would wrap the same `Agent` class without
`apps/cli` changing. Dependency direction otherwise:

```
tools, providers, sandbox, git, verification, capability   (leaves — no cross-deps among these except capability -> providers+tools)
              ↓
          runtime      (orchestration: AgentLoop, RunState, budgets, loop detection)
              ↓
         agent-api      (the one boundary apps/* may import)
              ↓
          apps/cli
```

### The agent run, end to end

`Agent.run()` (agent-api) builds a `Provider` from config/env credentials,
looks up a persisted capability profile for the model if one exists,
constructs a git worktree (`@clutchcode/git`, one per run — isolation, not
in-place edits), and hands all of it to `AgentLoop.run()` (runtime), which
drives: `UNDERSTANDING → (PLANNING) → INSPECTING → ACTING/EDITING ⇄
VERIFYING/REPAIRING → AWAITING_APPROVAL → COMMITTING → DONE`, with escape
hatches to `PAUSED`/`ESCALATED`/`FAILED` from budget limits, loop/thrash
detection, verification failure past the repair cap, or cheat-detection
flags. Every transition is persisted to `RunState` (JSON on disk under
`--state-dir`, default `~/.local/state/clutchcode`) — that's what makes
`agent status`/`inspect`/`resume` work without re-running anything. `agent
run` never mutates the user's actual branch; `agent approve` merges the
run's worktree branch in (optionally squashed).

**A model never marks its own work done.** Completion requires the
deterministic verification pipeline (build/test/lint, toolchain
auto-detected or overridden via `AGENTS.md`) to go green *and* pass
six-rule cheat detection (`packages/verification/src/cheat-detection.ts` —
catches removed/weakened assertions, skip markers, swallowed errors,
hardcoded outputs, unexplained snapshot changes) before `--yes` will
auto-commit.

### The adaptation layer (`@clutchcode/capability`, §4.2/§4.9)

`clutchcode models probe <model>` runs six deterministic, no-human checks
against any `Provider` (diff-application accuracy, instruction fidelity,
tool-transport detection, structured-output reliability, a
needle-in-haystack context probe, a loop-sanity check) and persists a
`CapabilityProfile` to `~/.config/clutchcode/models/<id>.toml` — **global,
not per-repo**, reused across runs and repos once probed. `Agent.run()`
looks this up by model id; when found, `AgentLoop` derives a §4.5 context
budget (caps `maxOutputTokens` at the budget's reserved-output share) and
injects a plain-language edit-format recommendation
(`describeAdaptationGuidance`) as an extra system message. No profile for
a model — the common case for any model not yet probed — changes nothing;
this whole layer is additive and must stay that way. See `HANDOFF.md` for
what's wired in versus still just a standalone report.

### Clean-room requirements (binding, see `LICENSE_AND_REUSE_ANALYSIS.md §3`)

Reference agent projects (Aider, Codex, Cline, OpenHands, Claude Code, …)
are **study-only**: read their publicly documented behavior to understand
a pattern, cite the idea in `docs/PRIOR_ART.md` and a code comment, but
never copy their source or prompt text. The SEARCH/REPLACE edit-apply
cascade (`packages/tools/src/edit-cascade.ts`), sandbox policy, and system
prompts in this repo are all clean-room implementations from the spec's
behavior contract for this reason — keep new work in those subsystems the
same way. Note the deliberate omission in the edit-apply cascade: **no
fuzzy/edit-distance fallback** — a learned lesson from Aider (silently
"closest match" applying an edit to the wrong location is worse than
failing loudly and re-prompting). Don't reintroduce it.

### Model-stubbability as a design constraint, not just a test convenience

Every stateful class in `runtime` (`AgentLoop`, `BudgetGuard`,
`LoopDetector`) takes its dependencies as interfaces and is exercised
end-to-end with `FakeProvider` — this is why the whole test suite runs in
seconds with zero API keys. When extending the loop, preserve this: no
component should reach for a real network call or a concrete provider
class internally.
