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
(§4.4) — the adaptation layer's "crown jewel" (§4.2) — now exist as a
standalone, tested package (`clutchcode models probe`), but are not yet
wired into the live agent loop's prompt assembly; that integration, OS
sandbox Tier 1, OS keychain credential storage, the VS Code extension, and
mid-run resume hardening are the remaining named Phase 2/3 follow-ups
(`PROJECT_SPEC.md §21/§25`).

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
