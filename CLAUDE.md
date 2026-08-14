# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

ClutchCode is a model-agnostic, local-first coding-agent runtime: it sits
between an LLM and a codebase, inspecting/editing/running/testing/repairing
code and only calling a task "done" when a deterministic verification
pipeline (build + tests + cheat detection) actually passes — not when the
model says so. It's designed to work across a frontier API model and a
14B model on local hardware via a capability-adaptation layer that
downgrades edit formats, tool-calling strategy, and context usage to match
what the target model can actually do.

`PROJECT_SPEC.md` is the authoritative design doc (Phase 0 deliverable) —
consult it by section number (e.g. "§4.5") before changing behavior in an
area it covers; code comments cite spec sections throughout and that
convention should continue. `LICENSE_AND_REUSE_ANALYSIS.md` governs what
may be reused from reference-project research (see Reuse rules below).

## Commands

```sh
pnpm install    # workspace install (also builds native tree-sitter addons)
pnpm build      # tsc -b across all packages, in dependency order
pnpm typecheck  # same, via each package's typecheck script
pnpm test       # vitest run, whole repo
pnpm lint       # eslint .
```

Day-to-day, prefer scoping to what you're touching rather than the full
repo — it's faster and the failure output is easier to read:

```sh
npx tsc -b packages/<pkg>                      # build one package (and its deps, transitively)
npx tsc -b                                     # full repo, from root tsconfig.json's project references
npx vitest run packages/<pkg>                  # all tests in one package
npx vitest run packages/<pkg>/src/foo.test.ts  # one test file
npx vitest run -t "test name substring"        # one test by name, anywhere in the repo
```

`vitest.config.ts` globs `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts`,
`evals/**/*.test.ts`, and `tests/**/*.test.ts` — a new package's tests are
picked up automatically, no config change needed.

After any non-trivial change: build the package(s) touched, run its tests,
then before committing run the full `tsc -b` + `vitest run` + `eslint .`
from root to catch cross-package regressions — every package is a
TypeScript project reference of every other one it imports, so a type
change can break a consumer several packages away silently if you only
check the package you edited.

Manually exercising the CLI against the fake, tokenless provider (no API
key needed) — requires `pnpm build` first since it runs the compiled
output, not the TS source directly:

```sh
node apps/cli/dist/cli.js run "fix the bug" --provider fake --yes --repo /path/to/some/git/repo
```

## Architecture

### Package graph and the Agent API boundary

This is a pnpm workspace of TypeScript project references
(`tsc -b`, composite projects — see `tsconfig.json` at root and each
package's own `tsconfig.json` `references`). Dependency direction is
one-way and enforced by those references:

```
sandbox, repo-intel, providers, git   — leaves, no internal package deps
tools            depends on          sandbox, repo-intel
verification     depends on          tools
capability       depends on          providers, tools
runtime          depends on          capability, git, providers, sandbox, tools, verification
agent-api        depends on          runtime (+ everything runtime depends on, directly)
apps/cli         depends on          agent-api  ← the only package apps may import
```

`packages/agent-api`'s `Agent` class (`agent.ts`) is the **only** surface
`apps/*` may depend on (PROJECT_SPEC.md §18.1/§20) — it wires a provider, a
tool set, a git worktree, and the runtime's `AgentLoop` together per run and
exposes `run/diff/approve/reject/status/inspect/resume/probeModel`.
`apps/cli`'s `commands.ts` holds every subcommand as a pure, directly
testable function (no process I/O); `cli.ts` is just argv → those functions
→ stdout/exit code via commander. `evals/` and `tests/` call the same Agent
API boundary the CLI does, not runtime internals directly, so they exercise
the real integration path.

### The agent loop and RunState machine

`packages/runtime/src/agent-loop.ts`'s `AgentLoop` implements the
orchestration loop (§6.1):
`Understand → Plan(optional) → Inspect → Act(tools) → Edit → Verify → Repair → Approve`,
driving `RunState.status` through the state machine in `run-state.ts`
(`CREATED → UNDERSTANDING → PLANNING? → INSPECTING → ACTING ⇄ EDITING →
VERIFYING → (REPAIRING → EDITING)* → AWAITING_APPROVAL → COMMITTING →
DONE`, with `PAUSED`/`ESCALATED`/`FAILED`/`CANCELLED` reachable from any
non-terminal state). `RunState` is persisted after every transition
(`RunStateStore`), so a crash loses at most the in-flight step — `resume`
re-attaches to whatever was last saved rather than replaying.

Every `AgentLoop` dependency is an interface (`Provider`, `Tool`,
`ToolContext`, `RunWorktree`), which is what makes the whole loop
model-stubbable (§2): `packages/providers`' `FakeProvider` scripts model
turns deterministically, so `agent-loop.test.ts` and the eval replay
harness (`evals/src/replay.ts`) drive full runs — including repair loops,
cheat-detection escalation, and text-protocol emulation — against a real
temp git worktree with zero tokens, zero network, fully deterministic
output. Prefer extending this style of test over mocking at a finer grain.

### The capability-adaptation layer (`packages/capability`) — the part that makes this model-agnostic

Everything here reads from a `CapabilityProfile` (diff-apply accuracy,
instruction fidelity, tool-call transport, structured-output reliability,
effective context size, loop-check behavior). A profile is either
persisted from a prior `probeModel()` run (`CapabilityProfileStore`, TOML
under `~/.config/clutchcode/models/`) or derived from the provider
adapter's own static defaults (`defaultProfileFromProvider`) when no probe
has been run — the profile never assumes the worst (§4.9), but also never
assumes native tool-calling works until either the provider says so or a
probe confirms it.

The profile drives three independent adaptations inside `AgentLoop`, each
worth knowing about before touching loop internals:

- **Tool transport** (`§4.8`): if the profile says the model can't reliably
  emit native tool calls, the loop switches to *text-protocol emulation* —
  `tools` is omitted from the provider request, `<tool name="...">...</tool>`
  parsing instructions are baked into the system prompt instead
  (`text-tool-protocol.ts`'s `renderToolProtocolInstructions`), and each
  response is run through `parseToolProtocolResponse` to synthesize a tool
  call, retry on a malformed one (`MAX_TOOL_PARSE_RETRIES`), or escalate.
- **Edit format** (`§4.4`): `selectEditFormat` picks SEARCH/REPLACE vs.
  whole-file rewrite per file/profile; a model that keeps failing
  `edit_file` on the same path past `MAX_EDIT_RETRIES` gets a downgrade
  nudge injected rather than looping forever.
- **Context budget** (`§4.5`): `computeContextBudget` splits the profile's
  effective context into system/retrieval/open-windows/history/output
  shares; `AgentLoop` compacts older conversation history
  (`context-compaction.ts`) before each request once the budget is tight,
  emitting a `context.compacted` event rather than silently truncating.

### Tool execution and the sandbox boundary

`packages/tools` implements the native tool set (`read_file`, `write_file`,
`edit_file`, `search`, `shell`, `git`, `process`, `symbols`) against a
`ToolContext` from `packages/sandbox`: a `PolicyEngine` decision
(permission class × repo trust mode), a `Denylist` (secrets-shaped paths
like `.env`), and a `Redactor`. **Every tool that can return file/command
content must call `ctx.redactor.scrub()` on it before returning** — this is
the enforced boundary from §5.2, and it's asymmetric with how easy it is to
forget: a new tool that skips it will pass its own happy-path tests and
still leak a secret. The same applies to tool-call *arguments* on the way
into the transcript/event log, not just tool *output* — see how
`agent-loop.ts` redacts `call.argsJson` before logging/emitting.

`ToolContext.sandboxTier` is `"tier0"` (process isolation + the policy
engine only, the default) or `"tier1"` (adds OS-level confinement via
bubblewrap on Linux, `packages/sandbox/src/tier1-linux.ts`) — Tier 1
degrades to Tier 0 transparently when `bwrap` isn't installed, so it's
always safe to request via `agent.toml`'s `[policy] sandboxTier`. Only the
`bwrap` argv construction is unit-tested in this repo's environment; it has
not been exercised against a live `bwrap` binary here.

### Verification and cheat detection

`packages/verification`'s `runPipeline` runs toolchain-detected build/lint/
test stages (with AGENTS.md overrides applied, see below) and
`detectCheats` scans the diff for the run for patterns that make tests pass
without fixing anything (deleted assertions, disabled tests, etc. — six
detectors, §14.6). `evaluateCompletion` combines both: verification must be
green *and* cheat-free for `--yes` to auto-commit; either failing routes to
`REPAIRING` or `ESCALATED`, never a silent pass. `AgentLoop` also runs an
impacted-tests fast pass first (`findTestFiles` + `selectImpactedTests` +
`buildImpactedTestCommand`, §14.4) as an optimization, but a *pass* there
always still falls through to the full `runPipeline` — it can only
short-circuit on failure, so it can never weaken the completion gate.

### Git worktree isolation

`packages/git`'s `createRunWorktree` gives every run its own git worktree
and branch (§13.1) — the agent never touches the user's checked-out tree
or working directory. Progress is checkpointed as commits on the run
branch (`checkpoint`); `approveRun` merges (optionally squashed) into
whatever branch was checked out when the user approves, and `rejectRun`
discards the worktree. `changedFiles(run)` (used by the impacted-tests
pass) unions tracked diffs against the base commit with untracked files
from `git status --porcelain`.

### AGENTS.md and repo intelligence

If a run's repo has an `AGENTS.md`, its contents are folded into the first
system-prompt message as project memory (§10.1) and can override detected
toolchain commands (`applyAgentsMdOverrides`). `packages/repo-intel`
provides on-demand tree-sitter symbol extraction (§9, Tier 0 — no
persistent index, same "recompute on demand" spirit as shelling out to
`search`/ripgrep) for JS/TS/TSX only today; Python/Go/Rust grammars pin
mutually incompatible `tree-sitter` core versions and are a deferred
follow-up, not an oversight — see that package's `package.json`
description before trying to add them naively.

## Reuse rules (binding — see `LICENSE_AND_REUSE_ANALYSIS.md` and `CONTRIBUTING.md`)

`research/` contains **study-only** notes on reference agent projects
(Aider, Codex, OpenHands, Cline, Claude Code, etc.). Reading it to
understand a *pattern* is fine and is what it's for; never copy source or
prompt text from it, or from the reference projects themselves, into this
repository — including a paraphrase close enough to be a derivative. The
edit-format cascade, sandbox policy, and repo map/symbol-graph subsystems
are explicitly flagged **CLEAN-ROOM-REQUIRED** in
`LICENSE_AND_REUSE_ANALYSIS.md §3`: implement from the spec's behavioral
description, not from a reference implementation's code. Commits are
signed off (`git commit -s`) per the DCO, not a CLA.

## Current status

See the README's "Status" section for what's implemented vs. deferred as
of the last pass — keep it in sync when you close a gap or discover a new
one, rather than duplicating that list here.
