# HANDOFF

Living continuation document for ClutchCode. Read this first every
session; update it before you stop. See `CLAUDE.md` for timeless working
conventions (build/test/lint, testing philosophy, quality bar) — this
file is the time-stamped snapshot of where the project actually stands.

**Snapshot as of:** 2026-08-18
**Branch:** `claude/handoff-prompt-continuation-c2cxh9`
**Latest commit:** `333c889` — "feat: seccomp-bpf hardening layered under Linux bwrap (§12.6)"
**Test suite:** 487/487 passing, 66 test files, clean `tsc -b`, clean `eslint .`

No PR has been opened for this branch's work yet — none was requested.

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
| VS Code extension polish | §18.5 | medium | Native two-sided diff view (needs per-file before/after content, not just the unified diff text `agent diff` returns), a run-picker, resume/rollback/pr commands in the UI. |
| Full non-git `AgentLoop` execution path | — | large, separate project | Snapshot-backed (not worktree-backed) execution for non-git directories. `Agent.run` currently refuses cleanly with a "run git init" error instead of attempting this. |
| Workflow engine — user-declarative workflows | §8, Phase 6 | medium | Built-in workflows (default/quickfix/review-only) already exist as typed TS; the JSON-Schema-validated user-declarative layer on top does not. |
| Memory correction UX | §10.3, Phase 7 | medium | `AGENTS.md` basic read exists; `agent memory` list/show/correct does not. |
| PageRank repo map | §9, Phase 7 | medium | Tier 0 (ripgrep + on-demand tree-sitter) is what's live; the Aider-style PageRank map is Tier 1, triggered by measured retrieval-accuracy failures on large repos, not built preemptively. |
| Eval scoreboard | §16, Phase 8 | medium–large | The replay harness (§16.3c) is live and gates every phase; the full SWE-bench-Verified-subset + Terminal-Bench-style scoreboard with published methodology is not. |
| Multi-agent orchestration | §7, Phase 9 | large | Explicitly out of scope until the §7 rule justifies it — the spec argues *against* building this by default. Don't start it without re-reading §7's reasoning first. |

## Known gotchas (read before you hit them again)

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
