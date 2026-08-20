---
name: refer-handoff
description: Use when the user says "refer the handoff and work" (or a close variant, e.g. "refer handoff.md and work", "check the handoff and continue", "read the handoff and go") in the ClutchCode repo — typically the very first message of a fresh session. Read HANDOFF.md and CLAUDE.md yourself and start the next unit of work immediately, no subagent, no clarifying questions — see CLAUDE.md's "Autonomous continuation" section for the full convention.
---

# refer-handoff

This is the **direct** half of CLAUDE.md's "Autonomous continuation"
convention (read that section first if you haven't — it's the source of
truth this skill just triggers). You are already the fresh executor here —
no subagent needed, unlike the `start-work` skill's sibling behavior.

1. Read `HANDOFF.md` and `CLAUDE.md` in full, right now, before doing
   anything else.
2. Pick the next unit of work using the priority order in CLAUDE.md's
   "Autonomous continuation" section: an explicitly deferred item from
   HANDOFF.md's latest "what's done" entry, then the top row of
   HANDOFF.md's "What's left" table, then — if neither exists — another
   audit round per the methodology in HANDOFF.md's most recent
   review-round write-up.
3. Start working immediately — don't ask the user what to do first, don't
   summarize the plan and wait for approval. The whole point of this
   trigger phrase is "you already have enough context in HANDOFF.md, go."
4. Finish the same way any unit of work in this repo finishes: real tests,
   the "prove it, don't assume it" fix discipline from CLAUDE.md, the full
   build/test/lint loop clean before committing, README.md's Status
   section updated if the work is user-visible, HANDOFF.md updated
   (snapshot header + a new "what's done" entry), commit/push per whatever
   git branch/PR conventions are already set up for this repo/session, and
   a plain-language report back to the user of what you did, what you
   verified and how, and what — if anything — is still open.
