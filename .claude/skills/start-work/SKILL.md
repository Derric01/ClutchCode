---
name: start-work
description: Use when the user says "start work" (or a close variant, e.g. "start working", "go ahead and work") in the ClutchCode repo. Spawns a background subagent that reads CLAUDE.md + HANDOFF.md, picks up the next unit of work, and reports back when done — see CLAUDE.md's "Autonomous continuation" section for the full convention.
---

# start-work

This is the **subagent** half of CLAUDE.md's "Autonomous continuation"
convention (read that section first if you haven't — it's the source of
truth this skill just triggers).

1. Spawn one background subagent (`Agent` tool, `subagent_type:
   "general-purpose"`, `run_in_background: true`) with a self-contained
   prompt along these lines (fill in the actual repo working directory —
   don't assume it's the same as this session's cwd if it isn't):

   > Read `CLAUDE.md` and `HANDOFF.md` in full in `<repo path>`. Follow
   > CLAUDE.md's "Autonomous continuation" section to pick the next unit
   > of work (its priority order: an explicitly deferred item from
   > HANDOFF.md's latest "what's done" entry, then the top row of
   > HANDOFF.md's "What's left" table, then — if neither exists — another
   > audit round per the methodology in HANDOFF.md's most recent
   > review-round write-up). Complete it end to end: real tests, the
   > "prove it, don't assume it" fix discipline from CLAUDE.md, the full
   > build/test/lint loop clean before committing, README.md's Status
   > section updated if the work is user-visible, HANDOFF.md updated
   > (snapshot header + a new "what's done" entry), and commit/push per
   > whatever git branch/PR conventions are already set up for this
   > repo/session — don't invent new ones. Report back a concise summary
   > of what you did, what you verified (and how), and what — if
   > anything — is still open or deferred.

2. Tell the user the subagent is running and that you'll relay its report
   when it completes. Don't block on it, and don't guess or narrate a
   result before the completion notification actually arrives — per the
   `Agent` tool's own contract, you know nothing about a background
   agent's outcome until its task-notification lands.

3. When that notification arrives, relay the subagent's findings/outcome
   to the user faithfully — what was done, what was verified and how,
   what's still open — not a bare "done." The subagent's own final report
   is never shown to the user automatically; surfacing it is your job.
