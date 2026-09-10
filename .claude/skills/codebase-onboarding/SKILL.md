---
name: codebase-onboarding
description: Use when someone asks to be onboarded to a codebase, wants a structural map of an unfamiliar repo, or asks "how does this project work" before diving into a task. For THIS repo specifically, defers to CLAUDE.md/HANDOFF.md/PROJECT_SPEC.md rather than regenerating them — they already exist and are the source of truth.
---

# Codebase Onboarding

Idea adapted from ECC's `codebase-onboarding` skill (MIT, study-only per
`ADR-016` — see `research/repos/ecc.md`): kept the useful shape (phased
reconnaissance → architecture map → convention detection → artifact),
rewrote every example against this repo's actual stack instead of ECC's
Next.js/Prisma examples, and added a rule ECC's own version has no reason
to need.

## The one rule that matters for THIS repo

**Don't run this skill's phases against ClutchCode itself and produce a
fresh onboarding doc or `CLAUDE.md`.** This project already has one, and
it's unusually thorough on purpose: `CLAUDE.md` (timeless conventions),
`HANDOFF.md` (current snapshot + what's next + gotchas), `PROJECT_SPEC.md`
(the authoritative §-numbered architecture spec), `docs/PROJECT_LOG.md`
(full history). If someone asks to be onboarded to *this* repo, the
answer is: **read those three files, in that order, right now** — that
is the onboarding, not a regenerated summary of it. Regenerating a
parallel onboarding guide here would compete with, not add to, a path
that already exists and that every session already reads.

This skill exists for the case ECC's did: **a different, unfamiliar
codebase** — one this project depends on studying (a reference repo
under `research/repos/`), a codebase the user asks about that isn't this
one, or a genuinely new project that has no CLAUDE.md yet.

## When to use this skill

- Someone asks to be onboarded to an unfamiliar repo that is **not**
  ClutchCode itself
- Studying a reference project before adapting an idea from it (the same
  motion this project already does under `research/repos/*.md` — Aider,
  DeepSeek Harness, pi-agent-harness, Hermes-Function-Calling, ECC itself)
- A genuinely new project with no `CLAUDE.md`/equivalent yet, where one
  would be worth writing

## How it works

### Phase 1: Reconnaissance (Glob/Grep, not Read-everything)

```
1. Package manifest       → package.json, go.mod, Cargo.toml, pyproject.toml,
                             pom.xml, Gemfile, composer.json
2. Framework fingerprint  → next.config.*, vite.config.*, tsconfig.json
                             (project references imply a monorepo — check
                             for a root tsconfig with a "references" array,
                             the pattern this repo itself uses)
3. Entry points           → bin/ fields in package.json, main.*, cmd/,
                             a workspace's apps/*/src/index.* or cli.*
4. Directory snapshot     → top 2 levels, skip node_modules/vendor/.git/
                             dist/build/target
5. Config & tooling       → eslint/prettier configs, CI workflows,
                             Dockerfile, a monorepo's workspace file
                             (pnpm-workspace.yaml, lerna.json, nx.json)
6. Test structure         → *.test.*, *.spec.*, a vitest/jest/pytest config
```

### Phase 2: Architecture mapping

- **Tech stack**: language(s), framework(s), package manager, monorepo
  tool if any
- **Architecture pattern**: monolith vs. monorepo-with-packages vs.
  microservices; is there a stated boundary rule (this repo's own
  `PROJECT_SPEC.md §20` — "`apps/*` depend only on `agent-api`" — is
  exactly the kind of thing to look for and surface if the target repo
  has an equivalent)
- **Key directories**: map top-level dirs to purpose, from what's
  actually there — don't assume a framework's conventional layout applies
  before confirming the code matches it
- **Data/control flow**: trace one real path end to end (a CLI command
  from argv to output; an API request from route to response — whichever
  the target project actually has)

### Phase 3: Convention detection

- Naming (file casing, test-file suffix), verified against several real
  files, not assumed from one
- Error handling style — does it have a stated convention, or bespoke
  patterns worth naming (see this project's own `error-handling` skill
  for what that looks like when written up)
- Git conventions from real recent history, if history is available and
  not too shallow (`git log --oneline -20`) — branch naming, commit style,
  merge vs. rebase; if the clone is `--depth 1` or has no history, say so
  rather than guessing
- **Reuse/license posture**, if this is a reference-project study rather
  than a project you're about to contribute to: what license, and does
  the target project's own `LICENSE_AND_REUSE_ANALYSIS.md`-equivalent (or
  this project's, if there is no equivalent in the target) already have
  an entry for it

### Phase 4: Produce the artifact — scoped to what was asked

For a **reference-repo study** (the common case in this project): write
`research/repos/<name>.md` following the existing files' format in that
directory (what it is, why it was studied, license verdict, what's
reusable as an *idea* vs. what must be rewritten clean-room per
`ADR-016`, what's explicitly not being adopted and why).

For a **genuinely new project with no onboarding doc**: a concise
onboarding guide (stack table, directory map, "where to look" table,
common commands) — kept scannable, not exhaustive. Don't generate one
longer than the project's own README if it has one; that's a sign it's
duplicating rather than adding structural insight.

## Anti-patterns

- Regenerating this project's own onboarding path — see the rule at the top.
- Reading every file when Glob/Grep would answer the question.
- Assuming a framework's conventional layout without confirming the code
  actually follows it — trust the code over the config file that named
  the framework.
- Guessing git conventions from a shallow/depth-1 clone instead of saying
  history is unavailable.
- For a reference-repo study specifically: treating "MIT-licensed" as
  "safe to copy the prompt/instruction text verbatim." It's legally safe;
  this project's own policy (`ADR-016`) is stricter than the license
  requires and still applies — study the idea, write the words yourself.
