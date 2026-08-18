# HANDOFF

Living continuation document for ClutchCode. Read this first every
session; update it before you stop. See `CLAUDE.md` for timeless working
conventions (build/test/lint, testing philosophy, quality bar) — this
file is the time-stamped snapshot of where the project actually stands.

**Snapshot as of:** 2026-08-18
**Branch:** `claude/handoff-prompt-continuation-c2cxh9`
**Latest commit:** `0d50179` — "fix: three real bugs found by a code-review pass on this session's work"
**Test suite:** 595/595 passing, 69 test files, clean `tsc -b`, clean `eslint .`

**PR:** open, not yet merged — check `git log`/GitHub for its number if
this note is stale (created right after this snapshot). #8 merged
cleanly. Pattern established across #4 through #8: one open PR per phase
of work, never reused once merged, branch always restarted from `main`'s
merged tip before new commits land on it.

---

## What's done

### Phase 1 — minimal agent (baseline)
Single agent, OpenAI-compatible + Anthropic + Ollama providers,
`RunState` machine, native tools (fs/shell/search/tests), SEARCH/REPLACE
edit cascade with fallback, git worktree isolation, deterministic
build/test verification, terminal CLI, the Agent API in-process boundary,
the runtime-replay test harness + `FakeProvider` + redaction canary.

### Phase 2 items landed early
- **Capability probe, context budgeter, edit-format selector** (§4.9,
  §4.5, §4.4) — the adaptation layer's "crown jewel." Standalone tested
  package, wired into the live `AgentLoop`: a run picks up a probed
  model's profile automatically, system-prompt edit-format guidance
  follows `select_edit_format`, `maxOutputTokens` follows the
  reserved-output budget, conversation history compacts (turn-safe) once
  the effective-context budget is exceeded. **Not yet enforced:**
  dedicated repo-map/open-file-window budgets (§9, §4.5) — that subsystem
  doesn't exist before Phase 7, so its share is folded into the live
  history budget for now.
- **`agent resume` hardened** (§6.2, §6.3, §18.2) — a paused run persists
  its full redacted conversation transcript; `resume --extend-steps N`
  (also `--extend-wallclock-ms`/`--extend-tokens`/`--extend-cost-usd`)
  reconstructs the loop from that transcript and actually continues it,
  not just re-attaches and reports status.
- **OS keychain credential storage** (§5.1 tier 1) — see "OS keychain"
  below.

### Phase 5 — git edge cases (§13.4/§13.5)
Submodule writes ask for explicit approval instead of silently landing in
the run's commits; LFS-tracked writes/edits are flagged (`lfsTracked`);
`read_file` recognizes LFS pointer stubs and refuses real binary content;
`agent run --scope path/` pins verification to a monorepo subdir; `agent
checkpoints`/`agent rollback` expose checkpoint history at the CLI; `agent
pr` pushes a run's branch and opens a PR via `gh` (falling back to a real
GitHub compare URL, or just confirming the push). A real bug got fixed
along the way: `approve --squash`'s final commit was bypassing the user's
pre-commit hooks the same way internal checkpoints correctly do — fixed,
tested with both a rejecting and a passing hook script.
**Deliberately not attempted:** a full non-git (snapshot-backed)
`AgentLoop` execution path — `agent run` now fails with a clear "run git
init" error instead of a confusing git error three calls deep, but a
parallel non-git path is a distinctly larger, separate project.

### Phase 3 — OS sandbox Tier 1 (§12.5/§12.6)
`shell` runs under real OS confinement by default when available.
**Linux: runtime-verified.** `bubblewrap` was installed into this
environment specifically to make this real — a test suite writes a file
outside the workspace and asserts a sandboxed `cat` of it fails, asserts a
network fetch inside the sandbox is unreachable, asserts the real CLI
binary's own `npm test` run still passes confined. **macOS (Seatbelt/
`sandbox-exec`): written, not runtime-verified** — authored against the
documented SBPL grammar, structurally tested (balanced parens, expected
clauses), but has never run against a real `sandbox-exec` — no macOS host
exists in this environment. `agent.toml`'s `policy.sandboxTier = "tier0"`
is the documented escape hatch; `agent doctor` reports the active backend.
**Seccomp hardening (§12.6) is now layered under bwrap on x86_64 Linux:**
a classic-BPF filter, hand-assembled in TypeScript (zero new runtime
dependency), denies ~22 syscalls a dev workflow never needs but that are
sandbox-escape/privilege-escalation primitives (`ptrace`, `mount`, `bpf`,
`unshare`, `kexec_load`, kernel module load/unload, etc.) — proven
end-to-end against the real kernel: a real bwrap-sandboxed process
invokes each by number and gets EPERM, a control run without the filter
proves the same syscall succeeds unfiltered. **Landlock is explicitly
not attempted** — a wrong Landlock rule fails by silently granting *more*
access, a worse mistake category than seccomp's fail-loud one, with no
vetted library and no safe way to verify a hand-rolled one here.
**arm64 seccomp isn't supported either** — different syscall numbers, no
arm64 host to verify them against, reported honestly rather than guessed.
**Not yet layered in:** Landlock itself, a Windows Tier 1 backend (WSL2
is the spec's own recommended path there).

### Phase 4 — VS Code extension (§18.1/§18.5)
New `@clutchcode/agent-rpc` package: the Agent API's second binding
(alongside in-process) — LSP-style framed JSON-RPC 2.0 over stdio,
`run/status/listRuns/diff/approve/reject/resume/inspect/checkpoints/
rollback/pr` mapped onto a real `Agent`, runtime events forwarded as
`clutchcode/event` notifications. `clutchcode serve` runs it over real
stdio. `apps/vscode` is a thin client: `runTask.ts`/`connection.ts`/
`presentation.ts` hold all orchestration with zero `vscode` import, proven
by real tests (a real `Agent` behind a real `AgentRpcClient` over
`PassThrough` streams; a separate test spawns the actual compiled
`clutchcode serve` binary as a child process). **`extension.ts`
(the `vscode`-API glue) type-checks against `@types/vscode` but has never
run in a real VS Code extension host** — flagged in a header comment and
in `apps/vscode/README.md`. **Not yet built:** a native two-sided diff
view (currently a single read-only diff-highlighted document), a
run-picker instead of typing a run id, resume/rollback/pr in the
extension UI (the CLI has them; the extension covers §18.5's core
run/diff/approve/reject loop).

### Credential storage — §5.1, all three tiers done
`loadCredentials()` implements the real precedence chain (OS keychain →
encrypted file store → env vars) and backs every real call site
(`Agent.run`, the capability probe, `agent providers`, `agent doctor`).
**Tier 1, OS keychain — Linux: runtime-verified** against a real
freedesktop Secret Service — `secret-tool`/`libsecret`/`gnome-keyring`
were installed into this environment specifically for this; a throwaway
D-Bus session + keyring per test run proves store/get/clear and that a
keychain-stored credential genuinely wins over the same-named env var.
**macOS (`security` CLI) and Windows (DPAPI via PowerShell): written, not
runtime-verified** — same disclosed-gap pattern as Seatbelt, argv/script
shape directly asserted in tests via pure builder functions. **Tier 2,
encrypted file store** (`~/.config/clutchcode/credentials.age`, used only
when tier 1 reports no keychain backend at all — headless Linux, some
Profile-D servers): AES-256-GCM via Node's built-in `crypto`, keyed by a
locally generated, permission-protected "machine key" file plus an
optional passphrase (scrypt). Documented scoping decision: not
byte-compatible `age`-format (that would need a from-scratch
reimplementation of age's wire format to matter) — a real, correct,
dependency-free AEAD doing the same job instead. Needs no OS binary, so
unlike tier 1 it's uniformly verified everywhere: round-trip, wrong
passphrase and tampered-ciphertext failing closed, two different machine
keys never cross-reading each other's values. `agent providers set-key
<anthropic|openai-compatible>` reads the key from stdin (never argv/
history) and routes to whichever tier is actually available; `agent
providers unset-key <provider>` removes it from the same place.

### Project memory correction UX (§10.3) — new @clutchcode/memory package
Toolchain detection now persists as a provenance-timestamped cache
(`{value, derivedAt, source}` per fact), keyed by the repo's *stable*
path — every run used to call `detectToolchain` fresh, so caching at all
is a real behavior change. Invalidated when the manifest files it was
derived from change content; `AGENTS.md` overrides still win on every
re-derive. `agent memory list/show/forget/correct` expose it at the CLI.
**Self-healing (§10.3 point 3):** a real bug got fixed along the way —
`classifyFailure` used to trust `lint`/`typecheck`'s own stage name
unconditionally, so a missing `eslint`/`tsc` binary was misreported as
"there's a lint issue" instead of what it is; new `command-not-found`
classification (exit 127, checked first) fixes this for all four stages,
and `AgentLoop`'s new optional `onVerificationFailure` hook (runtime
stays decoupled from the memory package) lets `agent-api` mark the
matching cached fact stale so the next run re-derives instead of
repeating a proven-wrong command. Proven end-to-end through a real run,
not just at the unit level — including a real bug the test suite itself
caught (see gotchas below). Deliberately out of scope: the "agent
proposes an `AGENTS.md` edit, with consent" flow §10.1 also describes,
and the long-term engineering tier (prior runs/decisions queryable via a
history database) — both real, separate features.

### Workflow Engine (§8.2) — the three Phase 1 built-ins, load-bearing
`RunState.workflowId` existed since early in the project (default:
`"default"`) but nothing ever read it — a stored label with zero effect
on control flow, called out explicitly (and corrected) in an earlier
version of this file's "what's left" table. It's now real: `agent run
--workflow <default|quickfix|review-only>` selects one of three
behaviorally distinct pipelines, implemented as concrete branches in
`AgentLoop` gated on `state.workflowId` (Option B from §8.1's comparison —
additive TS code paths, not a generic stage-pipeline interpreter; that
interpreter plus the JSON-Schema-validated user-declarative layer on top
of it is explicitly deferred, see "what's left"). `default` is byte-for-
byte the pre-existing baseline. `quickfix` forces the §6.7 planning
heuristic off unconditionally — proven by running the *same* ambiguity-
tripping task description through both workflows and asserting `PLANNING`
fires for one, not the other. `review-only` is the interesting one:
`write_file`/`edit_file` are filtered out of a new `effectiveTools` map
that backs *both* the tool schema sent to the model and the dispatch
table `runToolCall` actually executes against, so a model that tries to
edit anyway (tested directly, not just inferred) gets a real
`unknown-tool` error rather than a silent no-op — defense in depth, not
just hiding the schema. It finishes by capturing the model's last reply
into `RunState.summaryCheckpoints` (a field that existed, unused, since
the original RunState design) as the "report" and transitioning straight
to `DONE`, skipping verify/approve/commit — needed one small, narrowly-
justified state-machine addition (`ACTING → DONE`, only reachable from
`finishReviewOnly()`; every other workflow's edges are unchanged).
Unknown `--workflow` values are rejected at the `Agent.run` boundary with
a clear error listing the valid ids, matching the existing "not a git
repo" fail-loud style. 14 new tests across `workflow.test.ts` (registry
shape), `run-state.test.ts` (the new edge + `workflowId` defaulting),
`agent-loop.test.ts` (quickfix vs. default planning contrast, review-only
schema filtering, review-only edit-attempt refusal + report capture), and
`agent.test.ts`/`commands.test.ts` (real end-to-end through the Agent API
and CLI boundaries, plus the unknown-id rejection).

### Code-review pass over this session's own work — three real bugs found and fixed
Ran the `code-review` skill at `high` effort against the full diff since
the seccomp commit (everything built this session: §10.3 memory, §8.2
workflow engine, §18.5 VS Code polish, §8.1 declarative workflows). Three
findings, all verified for real (not taken on faith) before fixing:

1. **`diffFilesAgainstBase` mis-detected a renamed binary file as text.**
   `git diff --numstat -M` combines a rename's two paths into one string
   — confirmed empirically with three throwaway repos: `"old =>
   new"` when the paths share no directory, `"dir/{old => new}"` when
   they do. The original implementation matched a `Set<string>` of
   binary paths (from one bulk `--numstat` query) against the
   individually-parsed `path`/`oldPath` from `--name-status` — never
   matches a combined rename string, so the binary flag silently stayed
   `false` for a renamed binary file with real content changes, and
   `git show`/`fs.readFileSync(...,"utf8")` would have read raw binary
   bytes as text, producing mojibake in the new VS Code diff view. Fixed
   by scoping the numstat binary check to one explicit pathspec per
   file — verified this suppresses the combining entirely (git only
   condenses rename paths when a diff query spans more than the single
   path it's asked about). New test constructs exactly this scenario
   (a binary file, committed, then renamed with a small — not total —
   content change so git's rename-similarity heuristic still detects
   it as a rename) and — checked by literally reverting the fix and
   re-running — fails against the old code, passes against the new.
2. **`classifyFailure`'s `command-not-found` fallback misclassified
   ordinary missing-file errors.** The text-pattern fallback (behind
   exit-code-127, the primary/reliable check) included a bare `"no such
   file or directory"` — precisely the phrase Node's own generic
   `ENOENT` uses for *any* missing file, not just a missing shell
   command. A real test failure like `Error: ENOENT: no such file or
   directory, open '/repo/fixtures/data.json'` (a genuinely fixable bug —
   wrong fixture path) would have been misclassified as
   `command-not-found`: the repair message would tell the model to stop
   calling tools and escalate instead of asking for a targeted fix, and
   `markToolchainFactStale` would incorrectly invalidate a perfectly
   valid cached command. Fixed by only trusting the bare phrase when the
   output *isn't* Node's own `ENOENT`-labeled wording (a shell's own
   exec-failure message for a truly missing command never includes that
   label — only Node's generic file error does). Two new tests: the
   legitimate shell case still classifies as `command-not-found`; the
   Node-ENOENT-for-an-ordinary-file case now doesn't.
3. **`agent memory` commands had no way to see a scoped run's memory at
   all.** `Agent.run --scope path/` (§13.4) caches toolchain memory under
   `<repoPath>/<scope>`, computed once inline in `agent.ts`; `agent
   memory list/show/forget/correct` (§10.3) only ever took a bare
   `repoPath` with no scope parameter and no `--scope` CLI flag —
   structurally incapable of reading or correcting a scoped run's cache,
   not just missing a flag. `agent memory list` after a scoped run
   reported "nothing remembered" even though a fact genuinely was
   cached, and `agent memory correct` for a scoped run silently wrote to
   a different, unused cache file. Fixed by threading `scope` through
   all four `@clutchcode/agent-api` memory functions and adding
   `--scope` to the CLI's `memory`/`list`/`show`/`forget`/`correct`
   subcommands; extracted one shared `resolveMemoryCacheKeyPath(repoPath,
   scope)` helper used by both `memory.ts` and `Agent.run` itself so the
   two computations can't drift apart again the way this bug happened in
   the first place (two separate ad-hoc computations of the same key).
   Four new tests across `agent.test.ts` (scoped vs. unscoped `listMemory`/
   `correctMemoryFact` through the real `Agent` boundary) and
   `commands.test.ts` (the same through the real CLI command functions).

7 new tests total. Full suite after all three fixes: 595/595 passing,
clean `tsc -b`, clean `eslint .`. Nothing here should be read as "the
review found only three things" — it's a single-pass, single-reviewer
review; the honest claim is "these three were confirmed real and fixed,"
not "this code is now bug-free."

### §8.1 user-declarative workflow layer — real JSON-Schema validation via `ajv`
The second authoring layer §8.1 describes, on top of the three built-ins
(previous entry). New `packages/runtime/src/workflow-declaration.ts`:
`{apiVersion: "clutchcode/v1", id, name, stages: [{id, uses, when?,
params?}]}`, `uses` restricted to the five stage kinds `AgentLoop`
actually knows about (`plan`/`implement`/`verify`/`approve`/`commit`).
Chose a real dependency (`ajv`, ~4 small transitive deps, added to
`@clutchcode/runtime`) over hand-rolling a JSON-Schema validator — the
spec explicitly says "JSON-Schema-validated," and a hand-rolled structural
check dressed up as one would be a real gap dressed as done, not what
this project's honesty rule allows. A hit an ajv+TypeScript
`NodeNext`-resolution gotcha along the way: `import Ajv from "ajv"`
type-errors ("not constructable") under this repo's `moduleResolution:
NodeNext`; ajv's package also exports the class by name, so `import {
Ajv } from "ajv"` sidesteps the broken default-export interop path
entirely — preserved as a gotcha below.

Deliberately **not** a general stage-pipeline interpreter — §8.1's own
"no arbitrary control flow" line, taken literally. Structural JSON-Schema
validation is real (via ajv), but a declaration only *resolves* to
something `AgentLoop` can execute if it matches one of exactly two
shapes: a "full" pipeline (`implement` + `verify` required, `plan`
optional with `params.mode: "auto"|"always"`) or a "readonly" one
(`implement` alone, `params.readonly: true`, mirroring `review-only`).
Anything else — verify without implement, two `plan` stages, a readonly
implement combined with other stages — is rejected with a specific error
naming exactly what's unsupported, not silently misinterpreted.

`AgentLoop` was refactored to stop comparing `state.workflowId` against
hardcoded strings and instead consume a resolved `WorkflowPlan`
(`{planMode: "auto"|"always"|"never", readonly: boolean}`) — the built-ins
now resolve to this same shape via `resolveBuiltinWorkflowPlan`, so
`AgentLoop` genuinely never needs to know whether a run is on a built-in
or a custom workflow. Proven directly: a test constructs `AgentLoop` with
a `workflowPlan: {planMode: "always", readonly: false}` and an
unrecognized `workflowId`, and shows planning fires unconditionally even
for a task the §6.7 heuristic would call simple — a real capability none
of the three built-ins express (`default` defers to the heuristic,
`quickfix` always skips).

**A real correctness question this surfaced, and how it's resolved:**
what happens if a paused run's custom workflow *file* is deleted or
changed before `resume()`? Re-reading it at resume time would be wrong —
resumability (§6.2) means the run continues as it started, not as
whatever the file currently says. Fixed by persisting the *resolved*
`WorkflowPlan` on `RunState` itself (`state.workflowPlan`, always set by
`createRunState`, round-trips through JSON exactly like
`budgets`/`consumed` already do) instead of only the workflow id.
`resume()` never touches the filesystem for this. Proven end to end: a
test pauses a run on a custom readonly workflow, deletes the declaration
file, resumes, and confirms the run still finishes via the readonly path
with zero verification — the deleted file genuinely never gets re-read.

`agent run --workflow-file <path.json>` wires it at the CLI;
`--workflow`/`--workflow-file` are mutually exclusive (checked at
`Agent.run`'s boundary, not left to whichever the CLI happened to pass
last). Not built: the dedicated `agent workflow` CLI command (§18.2 marks
that Phase 2) — see "what's left".

19 new tests in `workflow-declaration.test.ts` (schema + semantic
validation, `resolveWorkflowPlan`, real file I/O), 2 new in
`agent-loop.test.ts` (the novel `planMode: "always"` proof + the
unrecognized-id defensive-fallback proof), 2 new in `run-state.test.ts`
(`workflowPlan` resolution + explicit override), 4 new in `agent.test.ts`
(real end-to-end run, invalid-file rejection, mutual-exclusivity
rejection, the delete-then-resume proof), 3 new in `commands.test.ts`.

### VS Code extension polish (§18.5) — native diff, run-picker, resume/rollback/pr
Three items from the extension's original "not yet built" list, all real
and tested at the layer that can be:
1. **Native two-sided diff view.** New `@clutchcode/git` function
   `diffFilesAgainstBase(run, pathScope?)` returns per-file
   `{path, status, before, after, binary}` — real before/after content, not
   unified-diff text — a separate function from `diffAgainstBase` on
   purpose (that one stays a single cheap `git diff` call for callers that
   only ever wanted text, like `agent pr`'s body). It needed two real fixes
   discovered by the tests themselves: `git diff <commit>` never reports an
   untracked path *at all*, no matter what it's diffed against — a
   brand-new file the model just wrote would silently vanish — fixed by
   staging first (`git add -A`, the same thing `checkpoint()` already did
   per step, not a new side effect); and rename detection (`-M`) isn't on
   by default for `git diff` across git versions, so a rename would report
   as an unrelated delete+add without it. Wired through
   `Agent.diffFiles(runId)` and a new `diffFiles` RPC method the same way
   `diff`/`diffStat` already were. `extension.ts` opens one real
   `vscode.diff` editor per changed file (virtual documents served from a
   `TextDocumentContentProvider`, keyed so the file's real extension still
   drives syntax highlighting on both sides), replacing the single
   unified-text document it used to open; binary files are skipped with a
   note instead of shown as mojibake.
2. **A run-picker.** New `pickRun()` in `runTask.ts` fetches the real run
   list over RPC (`listRuns`, already existed, was unused by the
   extension), filters it per command (e.g. only `PAUSED` runs offered to
   `clutchcode.resume`), and hands the picking itself to `ui.pickRun` —
   `extension.ts` implements that with a real `vscode.window.showQuickPick`
   showing status + task per run; tests implement it with a scripted
   choice. Replaces the old free-text "type a run id" input box on every
   command.
3. **resume/rollback/pr commands in the UI.** New `resumeTask`/
   `rollbackTask`/`prTask` orchestration functions, following the same
   split `runClutchCodeTask` already established (no `vscode` import,
   tested against a real `Agent` behind a real `AgentRpcClient`).
   `handlePostRunState` was pulled out of `runClutchCodeTask` so `resumeTask`
   shares the exact same "show diff → ask approve/reject" logic a fresh run
   uses, instead of a second copy of it. `resumeTask` without an explicit
   step extension re-pauses immediately — that's `Agent.resume`'s own
   documented no-op semantics (§6.3), already true of the CLI, not new
   behavior invented here; the extension's resume command prompts for an
   extension amount rather than guessing a default.

`extension.ts` itself remains the one file in this package that's
type-checked-but-not-runtime-verified (no real VS Code extension host in
this environment) — unchanged honesty boundary from Phase 4, just a larger
file behind it now. 10 new/rewritten tests in `runTask.test.ts` (all
against a real `Agent` over real `PassThrough`-piped RPC, including a real
scripted-tool-call edit for the diff-content and rollback tests) plus 5 new
`presentation.test.ts` cases for the two new pure formatters
(`formatDiffTabTitle`, `formatPrResult`), and 7 new `worktree.test.ts`
cases for `diffFilesAgainstBase` itself (added/modified/deleted/renamed/
binary/multi-file/pathScope).

### Docs: "MVP" removed everywhere
The spec used "MVP" to label Phase 1 scope throughout — renamed to
"Phase 1" (or a non-numeric label where it would collide with the
roadmap's own independent Phase 1–11 numbering), because this ships as a
real product built in phases, not a minimum-viable throwaway. Touched
`PROJECT_SPEC.md` (44 occurrences), `README.md`, `docs/PRIOR_ART.md`,
three `research/` notes, and doc comments in five packages. Pure rename,
zero behavior change.

---

## What's left

Roughly ordered by what a next session would naturally reach for first.
Effort is rough — a single focused session's worth of work, at this
project's standard (real tests, honest verification flags), not a
loose "MVP" estimate.

| Item | Spec ref | Rough effort | Notes |
|---|---|---|---|
| Windows sandbox Tier 1 | §12.5/§12.6, A11 | medium | WSL2-recommended is the spec's own documented fallback; a native restricted-token/AppContainer path is explicitly `[C:Low]` in the spec — confirm whether it's worth building vs. staying doc-only. |
| Landlock | §12.6 | medium–large, needs a plan first | Seccomp is done (see "what's done"); Landlock specifically needs either a native helper binary or a vetted raw-syscall binding — neither exists yet, and a hand-rolled one carries a worse failure mode (silently over-permissive, not fail-loud) than seccomp did. Don't attempt without a clear verification story first. |
| arm64 seccomp | §12.6 | small, needs an arm64 host | The x86_64 filter is done and verified; arm64 has a different syscall number table with no way to verify it in this (x86_64) environment — needs either an arm64 host/CI runner or a very high-confidence authoritative source cross-checked the same way libseccomp's resolver was used for x86_64. |
| VS Code multi-file "changes" view | §18.5, minor | small | The extension opens one real `vscode.diff` editor per changed file (done, see "what's done") rather than combining several into VS Code's newer `vscode.changes` command — deliberately skipped since that command isn't universally available across the `^1.85.0` engine range this extension targets. Revisit if the minimum supported VS Code version is ever raised. |
| Full non-git `AgentLoop` execution path | — | large, separate project | Snapshot-backed (not worktree-backed) execution for non-git directories. `Agent.run` currently refuses cleanly with a "run git init" error instead of attempting this. |
| `agent workflow` CLI command | §8.1/§18.2, Phase 2 | small | Both authoring layers exist now (built-ins + `--workflow-file`, see "what's done") — what's missing is the dedicated list/select/validate command §18.2 itself marks Phase 2. `--workflow-file <path>` can validate-and-run today; there's no `agent workflow validate <path>` that checks a file without starting a run, and no `agent workflow list` enumerating built-ins + any locally-referenced custom ones. |
| PageRank repo map | §9, Phase 7 | medium | Tier 0 (ripgrep + on-demand tree-sitter) is what's live; the Aider-style PageRank map is Tier 1, triggered by measured retrieval-accuracy failures on large repos, not built preemptively. |
| Eval scoreboard | §16, Phase 8 | medium–large | The replay harness (§16.3c) is live and gates every phase; the full SWE-bench-Verified-subset + Terminal-Bench-style scoreboard with published methodology is not. |
| Multi-agent orchestration | §7, Phase 9 | large | Explicitly out of scope until the §7 rule justifies it — the spec argues *against* building this by default. Don't start it without re-reading §7's reasoning first. |

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
