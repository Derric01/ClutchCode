# Contributing to ClutchCode

Thanks for your interest in ClutchCode. This is Phase 1 (implementation)
work following `PROJECT_SPEC.md` (the authoritative Phase 0 deliverable) and
`LICENSE_AND_REUSE_ANALYSIS.md` (the binding reuse rules).

## Developer Certificate of Origin (DCO), not a CLA

Per ADR-012, ClutchCode uses **Apache-2.0 + DCO**, not a Contributor License
Agreement. Every commit must be signed off:

```
git commit -s -m "your message"
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer certifying
you wrote the change (or otherwise have the right to submit it) under the
[Developer Certificate of Origin](https://developercertificate.org/).

## Reuse rules (binding)

See `LICENSE_AND_REUSE_ANALYSIS.md` for the full analysis. In short:

1. Reference projects (Aider, Codex, OpenHands, Cline, Claude Code, etc.) are
   **study-only**. Read their docs/behavior to understand a pattern; never
   copy their source or prompt text into this repository.
2. The subsystems listed in `LICENSE_AND_REUSE_ANALYSIS.md §3` (edit-format
   cascade, patch format, sandbox policy, repo map, prompts) are
   **clean-room-required**: write the implementation from the spec/behavior
   description, not from a reference implementation's source.
3. Cite the *idea* source in a code comment and in `docs/PRIOR_ART.md` when a
   design pattern is adapted from a reference project's publicly documented
   behavior.

## Development

```
pnpm install
pnpm build
pnpm test
```

The runtime is designed to be model-stubbable (`PROJECT_SPEC.md §2`): most
packages can be tested with `FakeProvider` and no API key or GPU.

## Repository layout

See `PROJECT_SPEC.md §20` for the authoritative repository structure and the
package boundary rules (`apps/*` depend only on `agent-api`; `runtime`
depends on `providers`/`tools`/etc. only through interfaces).
