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

1. **`HANDOFF.md`** — current state: where the project stands, what's next,
   and the gotchas worth knowing. Read this first, every session; update it
   before you stop. Deliberately kept short — the full history lives in
   **`docs/PROJECT_LOG.md`**, which you read only when you need the
   reasoning behind a past decision, not as routine start-up.
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
2. Append a "what's done" entry to `docs/PROJECT_LOG.md`, at the depth the
   existing entries set: what was built, **what was verified and how**, and
   what was deliberately deferred.
3. Update `HANDOFF.md` — snapshot header and the "What's left" table — so the
   next session doesn't have to re-derive where things stand.
4. Update `README.md`'s Status section if the work is user-visible: what's
   done, what's verified vs. flagged, what's explicitly deferred.
5. Commit with a message that explains *why*, not just *what*, and cites the
   relevant `§` section(s).
6. Make sure the work is on an **open pull request** — update the existing one
   by pushing, or open one if none exists. See the Autonomous continuation
   loop's step 9 for the exact rule.

## The three continuation documents

Three files, three deliberately different lifetimes. Keeping them separate is
a design decision, not an accident — merging them was considered and rejected,
because this file is injected into **every** session's context automatically
and an ever-growing changelog inside it would cost every session for content
almost none of them need.

| File | Lifetime | Read when | Grows? |
|---|---|---|---|
| **`CLAUDE.md`** (this file) | Timeless conventions | Every session, automatically | Rarely — only for durable lessons |
| **`HANDOFF.md`** | Current snapshot + what's next + gotchas | Start of every session | No — kept short on purpose |
| **`docs/PROJECT_LOG.md`** | Full engineering history | Only when you need the reasoning behind a past decision | Yes, forever |

The failure mode to avoid: letting per-unit status creep into `CLAUDE.md`, or
letting history re-accumulate in `HANDOFF.md`. Both dilute a file that every
session has to read. History goes in the log.

## Autonomous continuation ("start work" / "refer the handoff and work")

This repo runs on a continuation convention: the user says a trigger phrase
and nothing else, and the executor behaves like **a senior engineer who
already has the context and needs no further instruction** — picks the right
next thing, builds it to this repo's standard, checkpoints it, and moves on.

Two trigger phrases, two skills (`.claude/skills/start-work/`,
`.claude/skills/refer-handoff/`), **one shared playbook — this section.**
The skills are thin triggers that point here. Change behavior *here*, never
by duplicating rules into two skill files that can drift apart.

- **"start work"** (any time, mid-session or not) — spawn one background
  subagent (`general-purpose`, `run_in_background: true`) that runs the work
  loop below. Don't block on it; don't fabricate or predict its result. When
  its notification lands, relay what it *actually* did — what was built,
  what was verified and how, what's still open — never a bare "done."
- **"refer the handoff and work"** (and close variants) — you are already
  the fresh executor. Skip the subagent, read `HANDOFF.md` + this file right
  now, and run the same loop directly. No clarifying questions first; the
  whole point of the phrase is "you have enough context, go."

Both paths do the same work. Only the executor differs.

### The work loop

Work in **units**. A unit is one "What's left" row taken end to end and
checkpointed. **After finishing a unit, continue to the next one** — do not
stop and ask permission between units — until a stop condition fires.

Per unit:

1. **Re-read `HANDOFF.md`'s "What's left" table.** Never work from a
   remembered snapshot: an earlier unit in this same run may have reordered
   it, moved the `DO FIRST` tag, or closed the row you were about to take.
2. **Pick the unit,** in priority order:
   a. An explicitly deferred/incomplete item flagged in the latest "what's
      done" entry (an audit that ran out of budget, a finding documented but
      not fixed) — finish that first.
   b. The row tagged **`DO FIRST`**; absent that, the top row of the table.
      Position *is* the priority signal (see the table's own preamble).
   c. If neither exists, run another audit round using the methodology in
      the most recent review-round write-up (fan out across areas not
      recently covered; verify every finding empirically before trusting it
      — see "Fixing a bug or vulnerability"; fix what's confirmed real).

   **Skip** any row marked `BLOCKED`, `watch item`, `revisit trigger only`,
   or otherwise gated on a human decision — those are not implementable
   tasks, and implementing one anyway is a defect, not initiative.
3. **Coherence check — before writing any code.** Read what
   `PROJECT_SPEC.md` and the ADR list actually say about this row's area. If
   the row contradicts an Accepted ADR or a spec decision, **stop and report
   it instead of implementing.** This is not hypothetical: a queued
   "generated model catalog" row was found to contradict ADR-015, which had
   already considered and rejected static per-model tables ("static rots").
   Silently implementing over an Accepted decision is how an architecture
   erodes, and it is the worst thing an autonomous run can do here.
4. **Check the blast radius before changing a shared type.** Grep for who
   consumes it. Widening a union that is re-exported as public API (e.g.
   `SandboxBackend` via `@clutchcode/agent-api`) or guarded by an exhaustive
   `never` check is a public-surface change, not a local edit — and is often
   a sign the design wants a new optional *field* instead of a new variant.
5. **Do the work** to the quality bar below.
6. **Gate: `npx tsc -b && npx vitest run && npx eslint .` all clean.** All
   three, every time, before every commit — not once at the end of the run.
7. **Checkpoint the docs.** Three files, three different lifetimes — do not
   confuse them:
   - **`docs/PROJECT_LOG.md`** — append your "what's done" entry here, at the
     depth the existing entries set (what was built, **what was verified and
     how**, what was deferred). This is the archive; it grows forever.
   - **`HANDOFF.md`** — update the snapshot header and maintain "What's left"
     (row removed or updated, table kept in priority order, exactly one
     `DO FIRST` tag moved to the next unblocked highest-value row). Keep it
     **short**: it is read at the start of every session, so history belongs
     in the log above, not here.
   - **`README.md`**'s Status section when the work is user-visible.

   **This file only when the unit surfaced a genuinely new, durable
   lesson** — it holds timeless conventions, so per-unit status churn does
   not belong here and dilutes it.
8. **Commit and push** on the branch already in force for the session.
   Never invent a new branch.
9. **Make sure the work is on an open pull request.** Check first
   (`gh pr list --head <branch>`, or the GitHub tools): if a PR for this
   branch is already open, the push in step 8 has already updated it —
   say so and move on. If none is open, **open one** against `main`,
   titled for the work and with a body that states what was built, **what
   was verified and how** (test counts, stash-revert results), and what is
   deliberately still open. Never open a second PR for a branch that
   already has one, and never reuse a merged PR — that branch restarts
   from `main`'s merged tip.
10. **Next unit.**

### Stop conditions — stop and report, don't push through

- **Three units completed** in one invocation. Stop and report; the user can
  say the trigger phrase again. Bounded runs stay reviewable.
- **Only blocked/watch/human-decision rows remain.** Say so plainly rather
  than inventing work or implementing a gated row.
- **The build/test/lint gate won't come clean.** Never commit red. Never
  skip, disable, `.skip`, or quarantine a test to get green — that is
  falsifying the gate this whole project exists to enforce.
- **The unit needs a decision you shouldn't make alone** — a product call, an
  ADR amendment, a public API break, a new runtime dependency, or anything
  security-critical that can't be verified in this environment.
- **You can't verify a claim.** Report it as unverified. Never fake a pass.

### The quality bar (restated because it is not optional)

The executor is often a different model than the one that wrote this. These
are the rules that most need saying out loud:

- **No stubs, no "would work."** Implement the real thing or report it
  unfinished. This ships as a product, not a prototype.
- **Reproduce before fixing.** A finding — yours, a linter's, a reviewer's —
  is a hypothesis until you have made the bad thing actually happen.
- **Prove the test discriminates**: `git stash push -- <the fix>`, confirm
  the new test *fails*, `git stash pop`, confirm it passes. Skip only when
  correctness is unambiguous from the test's own assertions, and say so.
- **Fix the class, not the instance.** If the fix is "validate this untrusted
  value," grep every other place that kind of value reaches that kind of
  sink before calling it done.
- **Real over mocked.** `FakeProvider` stubs the *model*. Everything else —
  git repos, shells, sandboxes, keychains — is exercised for real.
- **Honesty over completeness.** Anything this environment can't exercise
  (macOS, Windows, a real VS Code host) gets written carefully, flagged
  explicitly in a header comment *and* in `README.md`, and never claimed as
  verified. Silence implying completeness is a defect.
- **Report faithfully.** What was built, what was verified and *how* (test
  counts, the stash-revert result), what is still open. A finding can be
  real and mis-scoped at the same time — say which.
