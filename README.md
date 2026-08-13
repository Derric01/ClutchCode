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

**Phase 1 (MVP), implemented.** Per `PROJECT_SPEC.md §21`, the MVP is: one
agent, one default workflow, two provider adapters (OpenAI-compatible +
Ollama), SEARCH/REPLACE edits with fallback, git worktree isolation,
deterministic verification with cheat detection, and a terminal CLI — all
present. Beyond the minimum bar, the capability-adaptation layer (§4) that
makes this model-agnostic in practice is also wired end to end: a
deterministic capability probe (§4.9), edit-format selection with a
downgrade cascade (§4.4), context budgeting (§4.5), and a text-protocol
tool-call emulation path (§4.8) for models without native tool-calling.
Also implemented: AGENTS.md project-memory injection (§10.1), impacted-test
selection in the verification pipeline (§14.4), Linux OS-level sandboxing
via bubblewrap (Tier 1, §12.5–12.6, falls back to Tier 0 when `bwrap` isn't
installed), and on-demand tree-sitter symbol extraction for JS/TS/TSX
(§9, Tier 0 — no persistent index; Python/Go/Rust grammars are a follow-up,
see `packages/repo-intel`).

## Repository layout

```
packages/
  runtime/        state machine, budgets, loop detection (model-stubbable)
  providers/      Provider interface + adapters (OpenAI-compat, Ollama, Fake)
  capability/     capability matrix, probe, edit-format selection, context budgeting
  tools/          native tool set + truncation
  sandbox/        policy engine, denylist, redaction, env scrubbing, Tier 1 (bwrap)
  git/            worktree isolation, checkpoints, diff
  verification/   pipeline, toolchain detect, test selection, cheat detection
  repo-intel/     on-demand tree-sitter symbol extraction (Tier 0, no persistent index)
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
