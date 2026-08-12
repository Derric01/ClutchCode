# Cross-cutting: Agent-loop comparison

Synthesized from repo notes. Feeds PROJECT_SPEC §6.

## Loop shapes

| Project | Loop | Planning | Persisted state / resume | Repair on failure | Budgeting |
|---|---|---|---|---|---|
| Aider | chat → edit → (auto-lint/test) → **bounded reflection** | optional architect/editor split | chat-history file | reflect on lint/test error (small cap) | reflection count only |
| OpenHands (classic) | event-stream: Action → Observation → repeat | agent-dependent | **explicit State object** (strong) | agent re-acts on failed Observation | max iterations/budget |
| Cline | recursive request: parse msg → 1 tool + approval → continue | Plan vs Act modes | task history + checkpoints | re-prompt; human steer | conversation-scoped |
| Codex | Rust turn/session loop; apply_patch + sandboxed exec | modes/templates | session | re-attempt within approval policy | session-scoped |
| SWE-agent | ReAct: think → act(bundled cmd) → observe | implicit | trajectory log | lint-on-edit feedback | step cap |
| smolagents | code-action loop | ReAct-style | trajectory | exec error → retry | step cap |
| **ClutchCode (proposed)** | explicit **state machine** (§6.2) with verify-gated completion | **cheap call, only when task warrants** (§6.7) | **first-class RunState** (resume) | **error-taxonomy-specific** recovery + repair loop caps (§6.8, §14.5) | **step + wall-clock + token + cost** (§6.3) |

## Patterns worth adopting
- **Explicit State for resume** (OpenHands) → our `RunState` (§6.2).
- **Bounded reflection/repair** (Aider) → our capped repair loop (§14.5); Aider's cap prevents infinite reflect.
- **One-tool-per-turn + approval** (Cline) → our policy engine + approval UX (§12.2, §18.3).
- **Approval/sandbox policy modes** (Codex) → our tiered policy (§12).
- **Trajectory logs** (SWE-agent) → our event store + `inspect` (§15).

## Patterns to avoid / improve
- **No cost/wall-clock ceiling** in Aider/Cline → we add all four budgets (protects Profile C from runaway bills, §6.3).
- **No loop/thrash detection** is common → we add explicit detectors (§6.4).
- **No error taxonomy** → misclassifying an env error as a task error makes models flail; we classify (§6.8).
- **Completion = model says so or tests pass** → we require the full verification contract incl. cheat detection (§14.7).

## Where ReAct/Reflexion fail in practice (Tier-3 prior art → prior-art.md)
ReAct loops **thrash** without loop detection and **over-plan** small tasks; Reflexion's self-critique can **rationalize** (the model "reflects" itself into confidence without new evidence). Our answers: deterministic loop/thrash detection (§6.4), verification as the *external* truth oracle (§14, not self-report), and skip-planning heuristics for small tasks (§6.7).
