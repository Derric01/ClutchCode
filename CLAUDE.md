# CLAUDE.md

Guidance for Claude Code (or any AI coding agent) working in this repository.

## What this is

ClutchCode is a **model-agnostic, local-first coding-agent runtime and
harness** — the layer that sits between a language model and a codebase,
inspecting/editing/running/testing/repairing/verifying code, adapting to
whatever model it's pointed at (a frontier API model or a 14B model on a
consumer GPU). It never phones home; "done" means a deterministic
build/test/lint gate actually passed, not that the model said so.

**This ships as a real product, not a prototype or MVP.** Every phase
landed so far has real tests proving real behavior — see "Testing
philosophy" below before writing anything that looks like a stub.

## Read these first, in this order

1. **`HANDOFF.md`** — current state: what's done, what's next, how long
   things took. Read this first, every session. Update it before you stop.
2. **`PROJECT_SPEC.md`** — the authoritative, section-numbered (`§`)
   architecture spec. Every feature traces back to a specific `§`-numbered
   requirement; code comments cite these (e.g. `// §5.1`, `// §13.4`). If
   you're implementing something, find its section first — don't
   improvise a design the spec already made a call on.
3. **`README.md`**'s Status section — a running log of what's been built,
   phase by phase, with an honest note on what's verified vs. written-but-
   unverified for anything platform-specific.
4. **`CONTRIBUTING.md`** — DCO sign-off, the reuse rules (reference
   projects are study-only; several subsystems are clean-room-required —
   see `LICENSE_AND_REUSE_ANALYSIS.md`).

## Build / test / lint

```sh
pnpm install
pnpm build       # pnpm -r run build, or: npx tsc -b (project references, incremental)
pnpm test        # vitest run, whole workspace
pnpm typecheck   # pnpm -r run typecheck
pnpm lint        # eslint .
pnpm clean       # rm dist/*.tsbuildinfo everywhere
```

For a genuinely clean check after a structural change (new package, new
required field on a shared type), do a clean rebuild rather than relying
on incremental state:

```sh
rm -rf packages/*/dist packages/*/*.tsbuildinfo apps/*/dist apps/*/*.tsbuildinfo evals/dist evals/*.tsbuildinfo
npx tsc -b && npx vitest run && npx eslint .
```

Run all three (build, test, lint) before every commit. This repo's own
history has caught real bugs this way (a hooks-bypass bug, an ASK/DENY
mapping bug) that would have shipped silently otherwise.

## Repository layout

pnpm workspace: `packages/*` (runtime, providers, tools, git, sandbox,
verification, capability, agent-api, agent-rpc), `apps/*` (cli, vscode),
`evals/`. See `PROJECT_SPEC.md §20` for the authoritative structure and
package-boundary rules — in short: `apps/*` depend only on `agent-api`
(and `agent-rpc` for the stdio JSON-RPC binding), never on internal
packages directly; `runtime` depends on `providers`/`tools`/etc. only
through their public interfaces.

## Testing philosophy — real over mocked, wherever real is possible

This is the single most important convention in this codebase, and it's
load-bearing: `FakeProvider` exists to stub the *language model* (the one
thing that's genuinely expensive/nondeterministic to call for real in a
test), and nothing else gets that treatment by default. Everywhere else,
tests exercise the real thing:

- Real git repos (`git init` in a temp dir), real worktrees, real commits,
  real bare remotes for push/PR tests.
- Real shell commands, real filesystem operations.
- Real OS sandbox confinement on Linux: `bubblewrap` is installed in this
  environment specifically so Tier 1 sandbox tests prove actual fs/network/
  PID-namespace isolation against the real `bwrap` binary, not just that
  the argv-building function returns the right strings.
- Real freedesktop Secret Service on Linux (`secret-tool`/libsecret +
  `gnome-keyring-daemon`, installed the same way) for OS keychain tests —
  a throwaway D-Bus session is spun up per test run (see
  `packages/agent-api/src/test-helpers.ts`'s `startThrowawaySecretService`).
- A real compiled `clutchcode` CLI binary spawned as a child process for
  the VS Code extension's connection tests.
- A real redaction canary (an injected fake secret asserted absent from
  every context/transcript/log artifact across a full recorded run).

**When "real" genuinely isn't available in this environment** (no macOS
host for Seatbelt/Keychain Services, no Windows host for DPAPI/PowerShell,
no VS Code extension host), the convention is: split the platform-specific
code into a **pure function that builds the command/script/profile**
(directly assertable without mocking or a real binary — see
`tier1-macos.ts`'s `buildSeatbeltProfile`, `keychain-macos.ts`'s
`buildSecurityGetArgs`) plus a thin, separately-named execution wrapper,
and **say so explicitly** — a header comment on the file, a line in
`README.md`'s Status section — rather than silently claiming full
verification. Never fake a pass by mocking your way around a real
platform boundary you could instead honestly flag as unverified.

## Quality bar

The user's standing instruction for this project: **nothing here is MVP —
build real, production-grade features with real tests, not shortcuts.**
Concretely:

- No stub implementations that "would work" — implement the real thing,
  or don't claim it's done.
- Every new capability gets tests that would actually fail if the
  capability were broken (not tests that only check a function was
  called).
- When something can't be verified in this environment, say so plainly in
  code comments and in `README.md` — don't let silence imply completeness.
- Prefer fixing a real bug you find along the way (cite it, fix it, test
  it) over working around it.

## Fixing a bug or vulnerability: prove it, don't assume it

Three rounds of review on this codebase (a correctness-focused code-review
pass, then two full-history security reviews) converged on the same
working discipline, and it's now the standing expectation for *any* bug
or vulnerability fix, not just ones a review round happens to surface:

1. **Reproduce it for real before trusting it.** A finding — your own, a
   subagent's, a linter's — is a hypothesis until you've made the bad
   thing actually happen: a real throwaway git repo, a real symlink, a
   real RPC call, a real malformed CLI flag. Read-the-code confidence is
   not the same as watched-it-fail confidence, and the two disagree often
   enough to matter — a claim about git's `protocol.ext.allow` default
   turned out to be wrong until it was actually run against a live `git
   push`; a claimed single-run AGENTS.md exploit turned out to only be
   reachable via `resume()` until traced end to end. Reproducing first is
   what catches both directions of error: a real bug you'd otherwise
   under-rate, and a plausible-sounding claim that isn't actually true.
2. **Fix it, then flip the fix off and re-run your new test.** `git stash
   push -- <file>` the fix (not the test), confirm the new test now
   fails against the pre-fix code, `git stash pop` to restore the fix,
   confirm it passes again. This is the single strongest evidence a fix
   is real: the test doesn't just assert plausible-looking behavior, it's
   proven to actually discriminate fixed from broken. Skip this only for
   a fix whose correctness is unambiguous from its own assertions with no
   real risk of a false-positive test (a pure input-validation regex, a
   static config value) — and say so explicitly when you do.
3. **When a fix touches a shared vulnerability class, fix the class, not
   just the instance.** `runId` path-traversal validation was added at
   `createRunWorktree` in one round and found *still missing* at three
   other entry points (`RunStateStore`, `worktree-store.ts`, `events.ts`,
   plus the RPC boundary itself) in the next — because the first fix
   patched one call site instead of exporting one shared validator
   (`assertSafeRunId` in `@clutchcode/git`) for every caller to use. When
   a fix is "validate this untrusted value before it becomes a path/
   command/trust decision," grep for every other place the same kind of
   value enters the same kind of sink before calling it done.
4. **A finding can be real and mis-scoped at the same time.** Don't just
   bucket things "confirmed" or "false positive" — a subagent's `ext::`
   RCE claim was a real gap (an unvalidated remote-name parameter) wrapped
   in an inflated severity claim (git's actual default blocks that
   specific protocol). Reproduce the *specific* claim, not just the
   general shape of it, and correct the framing rather than either
   accepting or discarding the finding wholesale.

## Conventions specific to this repo

- **Section citations**: reference `PROJECT_SPEC.md §N.M` in comments and
  commit messages for anything that implements a spec requirement.
- **"Phase 1" not "MVP"**: the spec's phase-boundary table used to say
  "MVP"; it now says "Phase 1" throughout, precisely because this is a
  real product being built in phases, not a minimum-viable throwaway.
  Don't reintroduce "MVP" language in new docs or comments.
- **Honesty over completeness**: a platform this environment can't
  exercise (macOS, Windows, a real VS Code host) gets code written
  carefully against documented, stable interfaces, plus an explicit,
  prominent flag that it hasn't actually run. That flag is not optional.
- **DCO sign-off**: commits should be signed off per `CONTRIBUTING.md`
  (`git commit -s`) when contributing as an external contributor would.
- **Reuse rules are binding**: reference projects (Aider, Codex, OpenHands,
  Cline, Claude Code) are study-only. Read their documented *behavior* to
  understand a pattern; never copy their source or prompt text. Several
  subsystems are clean-room-required — see `LICENSE_AND_REUSE_ANALYSIS.md §3`.

## When you finish a unit of work

1. Run the full build/test/lint loop above — all three, not just the part
   you touched.
2. Update `README.md`'s Status section with an honest paragraph: what's
   done, what's verified vs. flagged, what's explicitly deferred.
3. Update `HANDOFF.md` (see below) so the next session — yours or someone
   else's — doesn't have to re-derive where things stand.
4. Commit with a message that explains *why*, not just *what*, and cites
   the relevant `§` section(s).

## HANDOFF.md

`HANDOFF.md` is the living continuation document for this project — status,
what's next, rough effort sizing, and any in-flight context that would
otherwise be lost between sessions. Read it at the start of every session
and keep it current at the end of one. It is not a duplicate of this file:
`CLAUDE.md` is timeless working conventions; `HANDOFF.md` is the
time-stamped snapshot of where the project actually is right now.
