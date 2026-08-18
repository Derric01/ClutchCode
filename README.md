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
