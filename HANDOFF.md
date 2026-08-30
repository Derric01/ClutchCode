# HANDOFF

Living continuation document for ClutchCode. Read this first every
session; update it before you stop. See `CLAUDE.md` for timeless working
conventions (build/test/lint, testing philosophy, quality bar) — this
file is the time-stamped snapshot of where the project actually stands.

**Snapshot as of:** 2026-08-30
**Branch:** `claude/start-work-handoff-referral-52eyj1`
**Latest commit:** `11be036` — "docs: rewrite README as a project front page"
**Test suite:** 720/720 passing, 78 test files, clean `tsc -b`, clean `eslint .`
**CI:** `.github/workflows/ci.yml` added — build/test/lint on Node 20 + 22, on
every PR. **Not yet observed running.** Verified: the file is valid YAML, is on
the PR branch, and is in the PR diff — but the GitHub API reports `0` registered
workflows and `0` check runs on PR #14. This repo had no workflows before, so
the most likely cause is that **GitHub Actions is disabled for the repository**
(Settings → Actions → General). A human needs to enable it; the workflow itself
cannot be confirmed green until a run actually happens. Do not record CI as
working until a run is observed.
**Note:** the "what's done" history moved to `docs/PROJECT_LOG.md`; this file is
kept short on purpose. Append your entry there, not here.

**PR:** [#15](https://github.com/Derric01/ClutchCode/pull/15) — **open**, carrying the
nine commits that landed after #14 merged. #4–#14 merged cleanly before it.
Convention: one PR per phase of work, never reused once merged. **Push work to
#15's branch; open a new PR only once #15 is merged.**

---

## What's done

The full history now lives in [`docs/PROJECT_LOG.md`](./docs/PROJECT_LOG.md) —
22 entries covering Phase 1 through the current round, each with what was
built, what was verified and how, and what was deferred.

It was split out of this file deliberately. `HANDOFF.md` is read at the start
of **every** session; an ever-growing changelog inside it made the part that
actually drives work — "What's left" below — harder to find, and there is no
session in which reading 1,200 lines of history is the right first move.

**When you finish a unit of work, append your entry to `docs/PROJECT_LOG.md`**
(same depth and style as the existing ones), and update the snapshot header
above plus the table below. Do not re-grow this section. Then make sure the
work is on an **open pull request** — see `CLAUDE.md`'s "Autonomous
continuation" step 9.

## What's left

Ordered by what a next session should reach for first — **this ordering is
the priority signal**, so a row added later belongs at its right position,
not appended to the bottom. Exactly **one** row carries a `DO FIRST` tag at
any time (currently the top row); when that row is completed, move the tag
to whatever becomes the next genuinely-unblocked, highest-value row rather
than letting it disappear. Do not introduce competing "do first"/"do next"
variants — one tag, one row.
Effort is rough — a single focused session's worth of work, at this
project's standard (real tests, honest verification flags), not a
loose "MVP" estimate.

| Item | Spec ref | Rough effort | Notes |
|---|---|---|---|
| Landlock — **BLOCKED on the host kernel, not on us** | §12.6 | medium, blocked | **Attempted and stopped this round; read the reason before re-queueing it.** The *old* blocker ("needs either a native helper binary or a vetted raw-syscall binding — neither exists yet") is genuinely retired: **`@deepseek-ai/node-addon-landlock-run`** (BSD-3-Clause, `0.1.1`) installs clean, its `linux-x64` prebuilt is a real statically-linked ELF that runs, and its fail-closed contract is observable (a usage error exits `125` with a launcher-owned fatal line). **A different blocker replaced it: this environment's kernel has no Landlock at all**, so not one confined process can be observed here and the security property itself would ship unverified. Three independent confirmations, all reproduced live (see the `docs/PROJECT_LOG.md` entry for the exact commands and output): `/sys/kernel/security/lsm` = `capability,selinux`; `landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION)` (syscall 444) returns `ENOSYS`; and the kernel's own config says `# CONFIG_SECURITY_LANDLOCK is not set` — **not compiled in**, on a Firecracker microVM kernel that cannot be reconfigured from inside the guest. No `apt-get` fixes this. **Revisit trigger (concrete, checkable):** a host where `zcat /proc/config.gz | grep -i landlock` shows `CONFIG_SECURITY_LANDLOCK=y` **and** `landlock-run --probe` exits `0`. **The implementation plan below is already audited and stands as written — do not redesign it:** (1) add the dep, pinned; (2) add an optional `landlock?: LandlockDetection` field to `SandboxCapability` alongside the existing `seccomp?: SeccompDetection`, and emit the launcher into the argv `buildBwrapSpawn` already produces — Landlock is a *hardening layer under bwrap*, exactly as seccomp is; (3) **do NOT add `"landlock"` to the `SandboxBackend` union** — it is a closed union re-exported as public API from `@clutchcode/agent-api` and guarded by an exhaustive `const exhaustive: never = backend` switch in `buildConfinedSpawn`, and a `"landlock"` backend would falsely imply an unconfined-namespace path that does not exist; (4) write our own **status-gated** runner-failure classification (exit `125` **and** a launcher-owned fatal line, with the exact informational partial-enforcement line excluded) — never a substring bag, per their postmortem 0004 and the two times our own `classifyFailure` was bitten by the same shape; (5) real tests on a Landlock-capable host — a file outside the allow-list genuinely unreadable, **plus** the `§2a` condition-3 fail-closed test. **Consume as a dependency, never vendor** (`LICENSE_AND_REUSE_ANALYSIS.md §2a`, five binding conditions); do not copy their provider, argv construction, or classification code — sandbox policy is CLEAN-ROOM-REQUIRED per §3. Study note: `research/repos/deepseek-harness.md`. |
| First-run polish: `git show` stderr leaks on a repo without `AGENTS.md` | §10.3 | small | Found while capturing real CLI output for the README. On any repo that has no `AGENTS.md`, `clutchcode run` prints `fatal: path 'AGENTS.md' does not exist in '<sha>'` to the console before its normal status output. Harmless — the absence of `AGENTS.md` is the common case and the code handles it correctly — but it is a raw git error surfacing for a *benign, expected* condition, and it is the very first thing a new user sees. This is the same class as the documented `execFileSync` stderr-leak gotcha (a wrapper around a CLI expected to fail routinely needs explicit `stdio` handling). Fix: suppress stderr on that specific `git show` and treat a non-zero exit as "no AGENTS.md", with a test asserting a clean console on a repo lacking the file. |
| Coordinated npm release (`npx clutchcode`) | §18/§21 | medium | **The last adoption blocker.** Publish metadata now exists on all 11 manifests (`files`, `publishConfig.access: public`, `engines`, `repository.directory`, `bugs`, `homepage`) — what's missing is the release itself. `@clutchcode/cli` depends on `@clutchcode/agent-api` and `@clutchcode/agent-rpc` via `workspace:*`, which transitively requires publishing **all ten** workspace packages as one coordinated release, so this is a release *process*, not a publish command: decide the npm org/scope ownership, pick a versioning strategy (lockstep vs. independent — lockstep is simpler for a pre-1.0 monorepo where the packages only ever ship together), verify `pnpm publish -r` rewrites `workspace:*` to real ranges, add a release workflow gated on the CI gate, and confirm `npx clutchcode --help` works from a clean machine. Deliberately not half-started: partial publishes of an interdependent scope are worse than none. Until this lands the README quickstart correctly says "build from source". |
| Provider stop/finish-reason conformance — incl. Anthropic `pause_turn` | §4.7/§6.8 | small–medium, **gated** — see the note (its central deliverable needs a decision) | **Confirmed real, currently unreachable** (same posture as the old `snapshot-backup.ts` row). `mapStopReason` in `packages/providers/src/anthropic.ts` has no `pause_turn` case, so it falls through `default:` → `"stop"`. Per Anthropic's published API docs, `pause_turn` means the model **paused a long-running turn and the client is expected to resume it** — so the loop would treat a paused turn as a completed one, the exact defect signature round 3 found six instances of. Not reachable today: `pause_turn` only arises when the request declares Anthropic **server** tools (web search / web fetch / code execution) and we declare none (verified by grep — all our tools are client-side). Doing this right is a small **design decision, not a one-liner**: `FinishReason` is `"stop" \| "tool_use" \| "length" \| "error"` with no paused variant, so it needs a new variant plus a decision about what `AgentLoop` does with it (resubmit? treat as a budgeted continuation?). Left queued rather than decided unilaterally. Scope the work as a **table-driven conformance test per adapter** covering the full documented stop/finish vocabulary — `pause_turn`, `aborted`, `content_filter`, `refusal`, `max_tokens`/`length`, `stop_sequence`, `tool_use`/`tool_calls` — with each case's meaning taken from the **provider's own documentation**, using `@earendil-works/pi-ai`'s vocabulary only as a checklist of what to go look up (`research/repos/pi-agent-harness.md`). Adapters stay ours; do not vendor or port pi-ai. **Blast radius, audited so it is neither over- nor under-estimated:** `finishReason` is confined to `packages/providers` (`types.ts`, the three adapters, `fake-provider.ts`) and one consumer, `packages/runtime/src/agent-loop.ts`. It is **not** part of the `agent-rpc` wire contract and **not** re-exported through `agent-api`, so widening the union does **not** break the JSON-RPC protocol, the VS Code extension, or any `apps/*` consumer. Two packages, one loop — contained. |
| ACP (Agent Client Protocol) binding | §18.1/§20/§26 | medium | `PROJECT_SPEC.md` already names ACP three times — §18.1 says our stdio JSON-RPC binding is "deliberately the **same shape as ACP** … so future editor clients are cheap," §20's layer table calls the boundary "ACP-shaped," and §26's risk register commits us to "leaning into those protocols as a client rather than fighting them." We built `@clutchcode/agent-rpc` *shaped like* ACP but never implemented ACP, so no ACP client can actually talk to us. There is now an official **`@agentclientprotocol/sdk`** (`0.25.1`, spec at <https://agentclientprotocol.com>) and a working open-source consumer to study (DeepSeek Harness `packages/acp`, MIT, study-only). Because ACP is an **open protocol**, this is the same verdict as MCP — **REUSE — protocol impl**, not a clean-room problem (`LICENSE_AND_REUSE_ANALYSIS.md §2`). Payoff: Zed/Neovim/Emacs clients for roughly the cost of one adapter over the existing `Agent` boundary, without touching the runtime. Scope it as a *second binding alongside* `agent-rpc`, not a replacement, so the VS Code extension keeps working unchanged. Study note (incl. the working reference consumer): `research/repos/deepseek-harness.md`. |
| Generated model catalog to complement the capability probe | §4.9 | medium | We probe every model at runtime because we do not know its context window/capabilities a priori, falling back to provider defaults per ADR-015 when nothing has been probed. A generated catalog for *known hosted* models, with probing retained for *unknown/local* ones, is strictly better than probing everything — and it is what the §4.5 budgeter actually wants (real numbers, not a default). Idea studied from `@earendil-works/pi-ai`'s `models.generated.ts` + `scripts/generate-models.ts`, including its enforced rule that the generator is the source of truth and the generated file is never hand-edited. Implementation ours; the catalog data should come from each provider's own published model documentation / models endpoint, not from copying theirs. **Not** a reason to adopt pi-ai wholesale — see the "what's done" entry for why its dependency footprint disqualifies it for a local-first tool. Study note: `research/repos/pi-agent-harness.md`. **BLOCKED ON AN ADR DECISION — do not implement as written.** Audited against the spec: **ADR-015 (Accepted) explicitly considered and rejected this**, verbatim — *"Alternatives: static per-model tables; probe every run. Why rejected: **static rots**; per-run wastes tokens."* A *generated* catalog is a materially different proposal from the hand-maintained table ADR-015 rejected (regeneration is what answers "static rots", and ADR-015's own migration note already says "fall back to static defaults if probe fails", so static data is not foreign to the design) — but that argument has to be made **in an ADR amendment or a superseding ADR first**, not smuggled in as an implementation task. A future session must either amend ADR-015 or drop this row; silently implementing it would contradict an Accepted decision, which is exactly how an architecture erodes. |
| arm64 seccomp | §12.6 | small, needs an arm64 host | The x86_64 filter is done and verified; arm64 has a different syscall number table with no way to verify it in this (x86_64) environment — needs either an arm64 host/CI runner or a very high-confidence authoritative source cross-checked the same way libseccomp's resolver was used for x86_64. **Note (new):** this blocker is specific to *seccomp*, whose filter we hand-assemble from architecture-specific syscall numbers. The Landlock row above does **not** inherit it — `@deepseek-ai/node-addon-landlock-run` ships a prebuilt `linux-arm64` binary and carries the ABI burden upstream, so Landlock-on-arm64 arrives free with that work while arm64 *seccomp* stays blocked on a real arm64 host. |
| VS Code multi-file "changes" view | §18.5, minor | small | The extension opens one real `vscode.diff` editor per changed file (done, see "what's done") rather than combining several into VS Code's newer `vscode.changes` command — deliberately skipped since that command isn't universally available across the `^1.85.0` engine range this extension targets. Revisit if the minimum supported VS Code version is ever raised. |
| PageRank repo map | §9, Phase 7 | medium | Tier 0 (ripgrep + on-demand tree-sitter) is what's live; the Aider-style PageRank map is Tier 1, triggered by measured retrieval-accuracy failures on large repos, not built preemptively. |
| Eval scoreboard | §16, Phase 8 | medium–large, **DO FIRST** (the top genuinely-ungated row — everything above it is blocked on a kernel, an ADR, a human decision, a new runtime dependency, or an arm64/Windows/VS Code host) | The replay harness (§16.3c) is live and gates every phase; the full SWE-bench-Verified-subset + Terminal-Bench-style scoreboard with published methodology is not. |
| Full non-git `AgentLoop` execution path | — | large, separate project | Snapshot-backed (not worktree-backed) execution for non-git directories. `Agent.run` currently refuses cleanly with a "run git init" error instead of attempting this. `SnapshotBackup`'s own traversal gap is already closed (see "what's done"), so this row is now purely "wire the execution path up," not blocked on any open correctness/security gap in the fallback it would use. |
| Multi-agent orchestration | §7, Phase 9 | large | Explicitly out of scope until the §7 rule justifies it — the spec argues *against* building this by default. Don't start it without re-reading §7's reasoning first. |
| Windows sandbox Tier 1 — **revisit trigger only, decision stands** | §12.5/§12.6, A11 | n/a (watch item) | The doc-only/WSL2-recommended decision closed earlier this branch is **not** reopened by this research, and a future session should not treat it as reopened. Recording the evidence honestly so the trigger is legible: DeepSeek Harness ships `sandbox-windows-acl`, a real native Windows rung (a koffi port of a `WRITE_RESTRICTED`-token + restricting-SID mechanism). It **self-reports `enforcement: 'partial'`, not full** — ambient `Everyone` write ACEs and NTFS hard-links leak through, since ACLs bind to file objects rather than paths — and their own design note rejects AppContainer because it "cannot do arbitrary-path reads at all." Both facts **corroborate** §12.5's `[C:Low]` rating of the native path rather than contradicting it, and §29's team-size reasoning is untouched. Revisit only if (a) a Windows contributor/CI host materializes, **and** (b) a native path appears that reports *full*, not partial, enforcement. |

## Known gotchas (read before you hit them again)

- **`import Ajv from "ajv"` type-errors under this repo's `moduleResolution:
  NodeNext`** ("This expression is not constructable" / a `ValidateFunction
  | undefined` not assignable error on `.compile()`'s result). ajv ships a
  single ambiguous `.d.ts` (no separate `.d.cts`/`.d.mts`), and TS's
  NodeNext default-export interop for that shape resolves to the whole
  module namespace, not the class. Fix: `import { Ajv } from "ajv"` — ajv
  also exports the class by name, which sidesteps the broken path
  entirely. Runtime behavior was never actually broken (Node's own CJS
  interop handles the real `.js` file fine) — this is purely a
  compile-time TS quirk, confirmed by testing both import styles against
  the exact same compiled output.
- **`git diff <commit>` (no `--cached`) never reports an untracked path,
  no matter what it's diffed against.** A file the model just wrote that
  was never `git add`ed is invisible to it — not "shown as added," just
  absent. `diffFilesAgainstBase` (§18.5) hit this: fixed by staging first
  (`git add -A`), same as `checkpoint()` already does per step. If a
  diff-based function mysteriously misses a brand-new file, check whether
  it's staged.
- **`git diff --numstat -M` combines a rename's two paths into one
  string** — `"old => new"`, or `"dir/{old => new}"` when they share a
  directory — instead of two separate columns. Any code that tries to
  match a bulk `--numstat` query's output back against individually-
  parsed old/new paths from `--name-status` will never match a rename.
  `diffFilesAgainstBase`'s binary detection hit exactly this (caught in
  code review, see "what's done"): fixed by scoping the numstat query to
  one explicit pathspec per file instead of one bulk query — confirmed
  empirically that scoping to a single path suppresses the combining.
- **`git stash push --include-untracked` silently hides new files.**
  `handleDirtyTree`'s default "stash" strategy will stash an uncommitted
  config change (e.g. a test's `saveConfig()` call) before a run starts,
  so `buildRunDeps`'s `loadConfig` reads the stale default instead of
  what you just wrote. If a test's config change isn't taking effect,
  check whether it was committed before calling `agent.run()`.
- **The Redactor's generic high-entropy pattern (`§5.2`) false-positives
  on innocuous 32+-char uppercase/underscore test strings.** If a
  "leaked content" assertion in a test mysteriously fails even though the
  underlying behavior looks right, check whether your marker string got
  swapped for `«REDACTED:generic»`. Use a lowercase, space-separated
  marker instead.
- **ASK vs. DENY policy decisions**: `write_file`/`edit_file` used to
  collapse every non-ALLOW decision to `"policy-denied"` — harmless while
  WRITE was always ALLOW/DENY, until the submodule gate introduced the
  first WRITE `ASK` case and silently mismapped it. Fixed, but the lesson
  generalizes: when adding a new `ASK` case to an existing policy check,
  verify the caller actually branches on `ASK` vs `DENY`, don't assume it
  does because it handles `DENY`.
- **`pgrep -f '--flag=value'` treats the pattern as a pgrep option.**
  Needs `pgrep -f -- 'flag=value'` (the `--` stops pgrep's own option
  parsing). Bit the throwaway-Secret-Service test helper once.
- **`execFileSync`'s stderr leaks to the parent process by default.**
  Any wrapper around a CLI tool that's *expected* to fail routinely (a
  keychain lookup with nothing stored, no session bus, etc.) needs
  `stdio: ["ignore"|"pipe", "pipe", "ignore"]` explicitly, or its stderr
  text shows up uninvited in every test run and every real agent run.
- **`detectKeychainBackend` reports a backend based on PATH alone, not
  actual reachability.** On this dev container `secret-tool` is always on
  PATH, so the backend is always `"secret-service"` even with no D-Bus
  session running — it just fails at the `keychainGet`/`Set`/`Clear` call
  a layer down. To actually exercise the tier-2 file-store fallback (or
  test "no keychain at all" behavior), you have to force backend `"none"`
  by passing an `env` with a `PATH` that genuinely has no `secret-tool` on
  it — removing `DBUS_SESSION_BUS_ADDRESS` alone isn't enough, it only
  gets you "keychain present but unreachable," a different code path.
- **A raw child-process fd (`bwrap --seccomp FD`) is wired via Node's
  `spawn(..., { stdio: [...] })` array, not any special child_process
  API.** `fs.openSync()` the file, put the resulting fd number at the
  array index matching the fd number you want in the child (index 3 →
  fd 3), and reference that same number in argv (`--seccomp 3`). The
  parent's copy of the fd can be closed immediately after `spawn()`
  returns — the fork+exec already happened synchronously by then, so the
  child has its own independent copy; no need to keep it open for the
  child's whole lifetime.
- **When recalling syscall numbers or any other kernel ABI constant for a
  security-critical filter, don't rely on memory alone if a real
  authoritative source is available.** `libseccomp`'s own resolver
  (`python3 -c "import seccomp; print(seccomp.resolve_syscall(seccomp.Arch(), name))"`,
  needs `apt-get install python3-seccomp` — note it installs against a
  *specific* Python minor version, check `dpkg -L python3-seccomp` if
  `import seccomp` fails on whichever `python3` is first on PATH) settled
  every number in `seccomp-linux.ts` before it got hardcoded, rather than
  trusting recall. Where no authoritative local source exists (arm64,
  here), the honest move is to say so and not implement that path at all
  — see the arm64-seccomp row in "what's left."
- **A cache keyed on a per-run ephemeral path never hits — this bit the
  first pass of `@clutchcode/memory` for real.** `getOrDetectToolchain`
  originally took one `repoRoot` param used for both reading manifest
  files *and* the cache filename; `agent-api` passed it the run's git
  worktree path, which is a fresh temp directory every single run. The
  cache write always "succeeded" and the read logic was all correct in
  isolation — it just never hit anything, because no two runs ever share
  a worktree path. Two `agent.test.ts` assertions caught it immediately
  (`listMemory` came back `undefined`; a "verification is the truth
  oracle" test that expected the run to escalate on a corrupted command
  instead came back `DONE`, because the correction had been written under
  a path nothing would ever read from again). The fix: split the
  parameter into `detectFrom` (the live worktree — what's actually being
  verified) and `cacheKeyPath` (the stable repo+scope identity). Lesson:
  when a cache/memory layer sits underneath something that creates a
  fresh directory per invocation (worktrees, temp dirs, per-run scratch
  space), double-check which path is actually being used as the cache
  *key* versus the *content source* — they're very easy to conflate when
  one function reads from disk and persists to disk in the same call.
- **`git`'s real default for `protocol.ext.allow` is `never`, not the
  general `user` default.** Most unlisted/user-defined protocols default
  to allowed-when-explicitly-invoked (`user`), but `ext::<command>` (and a
  couple of other known-dangerous transports) are special-cased to
  `never` by git itself — confirmed by actually running `git push -u
  "ext::sh -c '...'" main` against a real throwaway repo and getting
  `fatal: transport 'ext' not allowed`, not by trusting a subagent's
  claim. Don't assume a "closes an RCE" security finding about `ext::` is
  accurately scoped without checking git's actual compiled-in default for
  that specific protocol — it's a real risk only on a host where an admin
  has explicitly re-enabled it.
- **A single leading `-` prepended to an LLM/caller-controlled CLI arg
  can become a double-dash long option if the arg itself also starts with
  `-`.** `` `-${arg}` `` with `arg = "output=/tmp/x"` produces `-output=…`
  (harmless — git doesn't recognize single-dash long options), but `arg =
  "-output=/tmp/x"` produces `--output=/tmp/x`, a real long option. Bit
  the `git log` tool's `arg` → `-${arg}` count-shorthand construction for
  real (§ "Full-history security review" in "what's done"). Any code that
  prepends a single fixed dash to a value it doesn't fully control needs
  to validate the value's *shape* (e.g. "must be a bare digit string"),
  not just its absence of malice — a value that's merely "not obviously
  a flag" can still smuggle one in via its own leading dash.
- **`getOrDetectToolchain`'s cache means an AGENTS.md-content change alone
  is invisible to it mid-run — you need a manifest-file change too.**
  `computeManifestHash` only hashes `MANIFEST_FILES` (`package.json`,
  lockfiles, etc.), not `AGENTS.md` itself, so writing a new `AGENTS.md`
  with nothing else changed leaves the cached record's hash matching and
  the cache hit returns the *old* (pre-edit) derived commands unchanged —
  the AGENTS.md override never gets re-applied. This bit reproducing the
  round-3 AGENTS.md trust-boundary exploit directly: a first test version
  that only wrote `AGENTS.md` passed even against the pre-fix code, for
  the wrong reason (cache hit, not the fix). The real trigger needs a
  manifest-file touch alongside the AGENTS.md edit (a `package.json`
  field bump is enough) to force `getOrDetectToolchain` to actually
  re-derive. If a fix "doesn't seem to do anything" in a toolchain-memory-
  adjacent test, check whether the scenario ever invalidates the cache at
  all.
- **A resumed run's `buildRunDeps` runs a second time; a plain `run()`'s
  doesn't, mid-loop.** `toolchainCommands` (and everything else
  `buildRunDeps` derives) is computed once at the top of `run()` and
  reused unchanged for every repair iteration within that same call — a
  model editing something `buildRunDeps` reads (AGENTS.md, config) mid-run
  has no effect on that run's own remaining verification. `resume()` is a
  *separate* top-level call that re-invokes `buildRunDeps` against
  whatever the worktree now contains. Any exploit/bug hypothesis of the
  shape "the model edits X mid-run, does that affect verification this
  run?" needs tracing against this fact before assuming the answer is
  yes — the round-3 AGENTS.md finding's real reachability is specifically
  through `resume()`, not a single uninterrupted `run()` call, despite
  reading at first like the latter.
- **Commander's `.option("--no-<x>", ...)` registered *alone* (no separate
  plain `--<x>` registration) auto-creates a boolean option named `<x>`
  defaulting to `true`.** This is the correct, minimal way to add a
  `--no-squash` counterpart to an existing `--squash`-flavored default:
  replace the old `.option("--squash", ..., true)` registration entirely
  with `.option("--no-squash", ...)` — don't register both, commander
  treats them as the same underlying boolean either way and registering
  both is redundant at best, contradictory at worst.
- **A VS Code `contributes.configuration` property with no explicit
  `"scope"` defaults to `window`-scoped — settable from a workspace's own
  `.vscode/settings.json`.** Any setting whose value gets used as a path,
  command, or URL to execute/fetch needs `"scope": "machine"` (or
  `"application"`) explicitly, or any repo the user opens can silently
  redirect it. No real VS Code extension host exists in this environment
  to prove enforcement end-to-end — the fix (and its test) can only prove
  the schema declaration is correct, not that VS Code honors it; that's
  an honest, stated limit, not a gap to paper over.

- **A commander subcommand that re-declares an option its parent also
  declares never sees the parsed value.** In commander v15 the flag is
  parsed onto the **parent**, and the subcommand's own `opts()` keeps its
  declared default forever — silently, with no warning. This shipped in
  six places (`memory list|show|forget|correct`, `providers
  set-key|unset-key`, all of which re-registered `baseOptions`): `agent
  memory correct <k> <v> --repo /other/repo` wrote the fact into the *cwd*
  repo and printed success, and `--json` was ignored on every one of them.
  The rule now: **a group's shared options are declared once, on the group
  parent**, and subcommands read the merged view via
  `optsWithGlobals()` (`globalOpts` in `apps/cli/src/program.ts`).
  `cli-structure.test.ts` walks `buildProgram()` and fails if any
  subcommand ever re-declares an ancestor's option, so adding the next
  subcommand the old way is caught at test time rather than in the field.

- **`FakeProvider.requestLog` used to keep a live reference to the
  caller's `messages` array**, so every logged entry mutated into the
  *final* history as `AgentLoop` appended to it — `requestLog[0].messages`
  never described request 0. Fixed (it snapshots the array per call), but
  the shape of the mistake generalizes: a "log what I received" helper
  that stores a caller-owned mutable container records the *end state*,
  not the event. If a test about what the model saw on an early turn
  passes suspiciously easily, check whether the thing it reads is a
  snapshot or a view.

## How to resume

1. Read this file, then skim `README.md`'s Status section for anything
   that's landed since this snapshot.
2. `pnpm install && pnpm build && pnpm test` — confirm the baseline is
   still green before changing anything.
3. Pick an item from "What's left" above, or ask the user which they'd
   rather prioritize if it's not obvious from context.
4. Follow `CLAUDE.md`'s testing philosophy: real over mocked wherever
   real is achievable in this environment; when it genuinely isn't
   (another OS, another host), split pure-buildable logic from the
   unverifiable execution boundary and flag the gap explicitly — in a
   header comment and in `README.md`.
5. Full build/test/lint loop before every commit. Update this file's
   "What's done"/"What's left" tables and the snapshot header before
   you stop.
