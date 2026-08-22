---
name: start-work
description: Use when the user says "start work" (or a close variant, e.g. "start", "start working", "go ahead and work", "keep going") in the ClutchCode repo. Spawns a background subagent that reads CLAUDE.md + HANDOFF.md and runs the autonomous work loop — several units of real work, each checkpointed with tests, docs, and a commit — then reports back. See CLAUDE.md's "Autonomous continuation" section for the full playbook.
---

# start-work

The **subagent** half of CLAUDE.md's "Autonomous continuation" convention.
That section is the source of truth — the work loop, the stop conditions,
and the quality bar all live there, deliberately in one place so this file
and `refer-handoff/` can't drift apart. This file only launches it.

The user typing the trigger phrase is the *whole* instruction. Don't ask
what to work on, don't propose a plan and wait — that is what the phrase
exists to skip.

1. Spawn **one** background subagent (`Agent`, `subagent_type:
   "general-purpose"`, `run_in_background: true`). Fill in the real repo
   path and the branch actually in force — don't assume either. Prompt:

   > You are a senior engineer continuing work on the ClutchCode project at
   > `<repo path>`, a production coding-agent runtime. Read `CLAUDE.md` and
   > `HANDOFF.md` **in full** before doing anything else, then run the work
   > loop in CLAUDE.md's "Autonomous continuation" section exactly as
   > written: complete **up to three units** of work, each one checkpointed
   > (build/test/lint clean → `HANDOFF.md` updated → `README.md` if
   > user-visible → commit → push) before starting the next. Stop early on
   > any stop condition that section lists.
   >
   > The things most worth restating, because getting them wrong is worse
   > than doing nothing: pick the `DO FIRST` row (skip anything marked
   > `BLOCKED` / `watch item` / gated on a human decision — those are not
   > tasks); **check the row against `PROJECT_SPEC.md` and the ADRs before
   > writing code and stop if it contradicts an Accepted decision**; check
   > the blast radius before widening any shared or publicly-exported type;
   > reproduce every bug for real before fixing it and prove the new test
   > discriminates (`git stash` the fix, watch it fail, restore, watch it
   > pass); run `npx tsc -b && npx vitest run && npx eslint .` clean before
   > **every** commit; never skip or disable a test to get green; flag
   > anything this environment cannot verify rather than claiming it.
   >
   > Work on branch `<branch>` — do not create a branch, do not open a PR.
   > End every commit message with these two lines:
   > `Co-Authored-By: Claude <noreply@anthropic.com>`
   > `Claude-Session: <session url>`
   >
   > Report back: which units you completed and why you picked them, what
   > you built, what you verified and **how** (test counts, stash-revert
   > results), the commit hashes you pushed, and anything you deliberately
   > skipped, deferred, or could not verify — including any row you stopped
   > on rather than implementing, and why.

2. Tell the user it's running and that you'll relay the report. **Don't
   block on it and don't predict its result** — per the `Agent` tool's
   contract you know nothing until the notification lands.

3. When it lands, **verify before relaying**: check the commits actually
   exist (`git log`, and confirm they're on the remote). Then relay
   faithfully — what was built, what was verified and how, what's still
   open, what it stopped on. Never a bare "done." If it reported something
   surprising, check it against the repo rather than passing it through.
