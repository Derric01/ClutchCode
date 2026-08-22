---
name: refer-handoff
description: Use when the user says "refer the handoff and work" (or a close variant, e.g. "refer handoff.md and work", "check the handoff and continue", "read the handoff and go") in the ClutchCode repo — typically the first message of a fresh session. Read HANDOFF.md and CLAUDE.md yourself and run the autonomous work loop directly — no subagent, no clarifying questions. See CLAUDE.md's "Autonomous continuation" section for the full playbook.
---

# refer-handoff

The **direct** half of CLAUDE.md's "Autonomous continuation" convention —
you are already the fresh executor, so there is no subagent to spawn. That
section is the source of truth: the work loop, the stop conditions, and the
quality bar all live there, deliberately in one place so this file and
`start-work/` can't drift apart. This file only routes you into it.

1. Read `HANDOFF.md` and `CLAUDE.md` **in full, right now**, before
   anything else.
2. Run the work loop in CLAUDE.md's "Autonomous continuation" section
   exactly as written — up to three units, each checkpointed (build/test/
   lint clean → entry appended to `docs/PROJECT_LOG.md` → `HANDOFF.md`
   snapshot + "What's left" updated → `README.md` if user-visible →
   commit → push) before starting the next, stopping early on any stop
   condition listed there.
   **When you stop, the work must be on an open pull request** — pushing
   updates one that already exists; open one against `main` if none does.
   Never open a second PR for a branch that already has one.
3. **Start immediately.** Don't ask what to work on, don't summarize a plan
   and wait for approval — the trigger phrase exists precisely to skip
   that. The one thing that *does* warrant stopping is a stop condition:
   a row gated on a human decision, a contradiction with an Accepted ADR,
   a gate that won't come clean. Report those; don't push through them.
4. Report in plain language when you stop: which units you completed, what
   you verified and **how** (test counts, stash-revert results), the
   commits you pushed, and what is still open — including anything you
   deliberately skipped or could not verify.
