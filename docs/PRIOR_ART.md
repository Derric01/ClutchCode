# Prior Art & Attribution

Per `LICENSE_AND_REUSE_ANALYSIS.md §3` and ADR-014/ADR-016, ClutchCode's
implementation is clean-room: no third-party source or prompt text is
copied. This document records, per subsystem, which reference project's
*publicly documented behavior* informed the design, so provenance is
auditable.

| Subsystem | Idea studied from | What we took | What we did NOT take |
|---|---|---|---|
| SEARCH/REPLACE edit format + apply cascade | Aider (`editblock_coder.py`, studied via its published behavior/docs — see `research/repos/aider.md`) | The `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` interchange convention (a de facto standard, not protectable) and the *shape* of a match cascade (exact → whitespace-tolerant → blank-line-drop → explicit elision, no fuzzy step) | Aider's source code; its fuzzy-matcher (deliberately excluded, "no fuzzy apply" learned lesson, ADR-002) |
| Tool-call text protocol for models without native tool calling | Cline's XML tool protocol (behavior studied via `research/repos/cline.md`) | The idea of a single strict action-block-per-turn text protocol | Cline's source, its exact XML schema/prompt text |
| Explicit resumable run state | OpenHands' `AgentController` / `State` object (behavior studied via `research/repos/openhands.md`) | The idea that agent state should be a first-class, persisted, resumable object | OpenHands' source, its Action/Observation class hierarchy |
| Workflow stage concept | Archon (behavior studied via `research/repos/archon.md`) | The idea of explicit, inspectable, resumable task/stage state | Archon's source (a knowledge-base/task service, not a code editor) |
| Tiered OS sandbox | Codex's Seatbelt/Landlock/bwrap usage (behavior studied via `research/repos/codex-cli.md`) | The idea of tiering OS sandbox primitives with Docker as an optional stronger tier, not the default | Codex's source, its exact policy strings |
| PageRank repo map (Phase 7, not in MVP) | Aider's `repomap.py` (behavior studied) | The idea of ranking symbols via PageRank over an import/symbol graph | Aider's source |

Rule of thumb enforced by code review: **patterns in, expression out.** If a
PR's diff is close enough to a reference project's source that it reads as a
derivative, it is rejected regardless of license compatibility (all of the
above are "STUDY-ONLY" per `LICENSE_AND_REUSE_ANALYSIS.md §2`).
