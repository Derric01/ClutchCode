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

**Phase 1 (MVP) shipped; Phase 2 in progress.** Per `PROJECT_SPEC.md §21`,
the MVP is: one agent, one default workflow, two provider adapters
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
overrides. OS keychain credential storage and the VS Code extension remain
the named Phase 2/3 follow-ups (`PROJECT_SPEC.md §21/§25`).

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
active. Not yet layered in: Landlock/seccomp on top of bwrap, and a
Windows backend (WSL2 is the spec's own recommended path there). OS
keychain credential storage and the VS Code extension remain the last
named Phase 2/3 follow-ups.

## Repository layout

```
packages/
  runtime/        state machine, budgets, loop detection (model-stubbable)
  providers/      Provider interface + adapters (OpenAI-compat, Anthropic, Ollama, Fake)
  tools/          native tool set + truncation
  git/            worktree isolation, checkpoints, diff
  verification/   pipeline, toolchain detect, cheat detection
  capability/     capability probe, profile persistence, context budgeter, edit-format selector
  agent-api/      the Agent API boundary (in-process; stdio JSON-RPC later)
apps/
  cli/            `clutchcode` CLI (thin client of agent-api)
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
