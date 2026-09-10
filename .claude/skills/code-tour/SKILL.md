---
name: code-tour
description: Create CodeTour `.tour` files — persona-targeted, step-by-step walkthroughs with real file and line anchors, opened directly in an editor via the CodeTour extension. Use when someone asks for a code tour, onboarding walkthrough, PR tour, or a guided (not prose) explanation of how a ClutchCode subsystem works. `apps/vscode` already ships an editor extension, so a reader here plausibly has CodeTour available.
---

# Code Tour

Idea adapted from ECC's `code-tour` skill (MIT, study-only per `ADR-016`
— see `research/repos/ecc.md`), rewritten with a ClutchCode-specific
example instead of a generic payments-service one, and a note on where
tours are actually useful in *this* codebase given its unusual shape
(eleven packages, three protocol bindings, no web UI).

Create **CodeTour** `.tour` files for guided walkthroughs that open
directly to real files and line ranges in an editor, using the
[CodeTour](https://github.com/microsoft/codetour) format (MIT,
maintained under the `microsoft` org). Tours live in `.tours/` at the
repo root. Only create `.tour` JSON files — never modify source as part
of this skill.

## When to use this, vs. `codebase-onboarding`

- **`codebase-onboarding`**: a text artifact (a guide, or a starter
  `CLAUDE.md`) for understanding a codebase in one read.
- **`code-tour`**: a *guided, step-through* artifact for when the reader
  will have an editor open and benefits from jumping to real anchors in
  sequence — architecture walkthroughs, PR review tours, RCA
  ("why did this break") tours, or "explain how X works" requests where
  the answer is better shown as a path through real code than summarized
  in prose.

Where ClutchCode's own package-boundary rule (`PROJECT_SPEC.md §20`:
`apps/*` depend only on `agent-api`) is exactly the kind of thing a new
contributor benefits from *seeing* traced through real files rather than
reading as an abstract rule — a tour earns its place there in a way a
paragraph doesn't.

## Where tours actually pay off here

This project's architecture note in `PROJECT_SPEC.md §20` already states
the payoff in words: the CLI, the VS Code extension, and any future
editor client share 100% of the runtime code, only presentation differs.
A tour is the natural way to *show* that boundary rather than assert it —
walk the same request from `apps/cli` and from `apps/acp` to the point
they converge on `agent-api`, and the "why the boundary matters" `<details>`
block in `README.md` stops being a claim and becomes something a reader
just watched happen.

Good candidates in this codebase specifically:
- the agent loop → verification → cheat-detection path (§14), since it's
  the thing the whole project's credibility rests on and is currently
  only described in prose across `README.md` and `PROJECT_SPEC.md`
- a PR tour for any change that crosses a package boundary, so a reviewer
  sees the boundary being crossed rather than inferring it from a diff
- an RCA tour for a bug whose root cause and fix span multiple packages
  (this project's own `docs/PROJECT_LOG.md` has several — e.g. the
  `detectSandboxBackend`-decided-by-PATH-presence CI bug, which touched
  `packages/sandbox`, `.github/workflows/ci.yml`, and three test files)

Not every explanation needs one — a single-file question is still better
answered directly in chat.

## Workflow

### 1. Discover before writing anything

Read the actual files, don't infer structure from directory names alone.
For this monorepo specifically: check `PROJECT_SPEC.md §20`'s dependency
diagram first if the tour is architectural, since it states which edges
are real and which would be a boundary violation.

### 2. Infer the reader

| Request shape | Persona | Suggested depth |
|---|---|---|
| "onboarding", "new contributor" | `new-joiner` | 9–13 steps |
| "quick tour" | `vibecoder` | 5–8 steps |
| "architecture" | `architect` | 14–18 steps |
| "tour this PR" | `pr-reviewer` | 7–11 steps |
| "why did this break" | `rca-investigator` | 7–11 steps |
| "security review" | `security-reviewer` | 7–11 steps |
| "explain how X works" | `feature-explainer` | 7–11 steps |

### 3. Verify every anchor — never guess a line number

Confirm each file exists and each line/selection is in range before
writing it into the tour. If a file is likely to keep changing (an
actively-edited package), prefer a `pattern` anchor over a fixed line
number.

### 4. Write to `.tours/<persona>-<focus>.tour`

### 5. Get the `ref` field right — this is the most common real bug

`ref` ties the tour to a git branch or commit. When it isn't the branch
the reader has checked out, CodeTour opens each step's file **from that
revision in git**, not from disk. A step whose file doesn't exist at
`ref` fails silently with *"The editor could not be opened because the
file was not found"* — even though the file is right there on disk. The
tour and its prose still render, so the real cause is easy to miss.

| Tour type | Set `ref` to |
|---|---|
| PR tour | the PR's head branch — never the base branch (new files in the PR don't exist on the base yet) |
| Architecture / onboarding | the branch the reader is actually on (often `main`), or omit it |
| Not sure | omit it — CodeTour then reads straight from disk |

For this repo specifically: a PR tour on this project's own working
branch (`claude/start-work-handoff-referral-52eyj1` at time of writing,
but check `git branch --show-current` — it gets restarted from `main`
after every merge, per `HANDOFF.md`) should set `ref` to that branch, not
`main`, for exactly this reason.

### 6. Validate before finishing

Every path exists, every line/selection is valid, the first step is
anchored (never content-only), and the tour reads as a path with a
throughline — not a flat file listing.

## Step types

```json
{ "directory": "packages/runtime", "title": "The agent loop", "description": "..." }
{ "file": "packages/runtime/src/agent-loop.ts", "line": 121, "title": "AgentLoop", "description": "..." }
{ "file": "packages/verification/src/pipeline.ts", "selection": { "start": {"line": 1, "character": 0}, "end": {"line": 20, "character": 0} }, "title": "...", "description": "..." }
{ "file": "packages/runtime/src/agent-loop.ts", "pattern": "class AgentLoop", "title": "...", "description": "..." }
{ "uri": "https://github.com/Derric01/ClutchCode/pull/21", "title": "The PR" }
{ "title": "Next Steps", "description": "closing step only — never the first step" }
```

## Writing rule: SMIG

Each description answers:
- **Situation** — what the reader is looking at
- **Mechanism** — how it works
- **Implication** — why it matters for this persona
- **Gotcha** — what a reader might otherwise miss

## A real example, grounded in this codebase

```json
{
  "$schema": "https://aka.ms/codetour-schema",
  "title": "The verification gate: from edit to VERIFIED",
  "description": "How a run goes from a model's tool call to a deterministic pass/fail, and why a green gate isn't the same as done.",
  "ref": "main",
  "steps": [
    {
      "directory": "packages/runtime",
      "title": "The agent loop",
      "description": "Situation: every run's control flow lives here. Mechanism: AgentLoop drives tool calls, then hands off to verification once the model stops calling tools."
    },
    {
      "file": "packages/runtime/src/agent-loop.ts",
      "pattern": "class AgentLoop",
      "title": "AgentLoop",
      "description": "Mechanism: loops until the model stops or a budget is hit. Gotcha: the loop itself never decides success — that's verification's job, deliberately kept separate so the model's own claim never counts."
    },
    {
      "directory": "packages/verification",
      "title": "The gate",
      "description": "Situation: real build/test/lint, spawned as real child processes — nothing here is simulated."
    },
    {
      "file": "packages/verification/src/pipeline.ts",
      "title": "The pipeline",
      "description": "Implication: this is what 'VERIFIED' actually means in this project — a real toolchain run, not a model's self-report."
    },
    {
      "file": "packages/verification/src/cheat-detection.ts",
      "title": "Cheat detection",
      "description": "Gotcha: this runs even after the gate goes green. A model that deletes a failing assertion makes the gate pass — this is what catches that anyway."
    },
    {
      "title": "Next steps",
      "description": "Follow packages/agent-api/src/agent.ts's Agent.run() to see how a CANCELLED or AWAITING_APPROVAL outcome differs from DONE."
    }
  ]
}
```

## Anti-patterns

- Flat file listing instead of a narrative with a throughline
- Guessed anchors instead of verified ones
- Setting `ref` to the base branch on a PR tour (the classic failure mode above)
- A content-only first step
- Touring the whole monorepo when the request only needed one package

## Related

- `codebase-onboarding` — the text-artifact sibling of this skill
- Format spec: [`microsoft/codetour`](https://github.com/microsoft/codetour) (MIT)
