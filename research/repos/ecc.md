# ECC (`affaan-m/ecc`) — repo note (Tier-2: harness tooling, not an agent to embed)

Studied at a fresh `--depth 1` clone (2026-09), MIT © 2026 Affaan Mustafa.
Upstream: <https://github.com/affaan-m/ECC>

## what it actually is

Not a landing page, and not an agent runtime comparable to ClutchCode. ECC
is **"the agent harness operating system"** — an npm-distributed
installer (`ecc-universal`, `ecc-agentshield`) that drops a large library
of Claude Code / Codex / other-agent-harness configuration into a
project: 286 `skills/` (SKILL.md instruction files), plus `agents/`,
`commands/`, `hooks/`, `plugins/`, `mcp-configs/`, `scaffolds/`,
`workflows/`. Its README is closer to a full install/reference manual
(1400+ lines) than a marketing page — hero image and badge row at the
top, then guides.

## why this was studied at all

The user asked for two unrelated things under one name: (1) improve
`README.md`'s marketing-page patterns, (2) pull useful skills into this
project's own `.claude/skills/` harness. Only the second is actually about
ECC's substance — its README's *top* (hero image, badge row, one-command
install CTA before any prose) is the one piece relevant to (1); its 286
skills are what's relevant to (2).

## the skills — most collide with a stricter existing convention

Sampled the plausible candidates against what this project already does,
rather than importing by name alone:

| ECC skill | What it'd bring | Why not imported verbatim |
|---|---|---|
| `security-review` | Generic auth/secrets/API checklist | We have our own `/security-review` skill, exercised across three real review rounds this project, plus `SECURITY.md`'s threat model. A same-concept skill under a different name would sit alongside ours, not improve it. |
| `architecture-decision-records` | Auto-detects decisions, keeps a separate ADR log | Our ADRs (001–020) live inside `PROJECT_SPEC.md`, cited by section number throughout code comments. A second, disconnected log the codebase's own citations wouldn't point to is a regression, not an addition. |
| `tdd-workflow` | TDD enforcement, 80%+ coverage target | `CLAUDE.md`'s testing philosophy is stricter and different in kind — real-over-mocked, stash-revert discrimination proof required per fix, no coverage-percentage target at all. A generic threshold rule would contradict it. |
| `git-workflow` | Generic branching/commit/merge-vs-rebase patterns | This project already has firmer, specific rules (never rebase someone else's branch, DCO sign-off, exact merge-conflict handling). ECC's version is the more permissive of the two on the same questions. |

None of the four were adopted, verbatim or adapted — the existing,
more-specific convention wins in every case.

## the two adopted, and why they're rewrites, not copies

`error-handling` and `codebase-onboarding` collide with nothing that
already exists here. Both were still **rewritten from scratch** rather
than copied, per `ADR-016` (cited in `CLAUDE.md`'s Reuse Rules): *"prompts
are copyrightable... adapt others' prompts [rejected]... original
prompts."* A `SKILL.md` is a prompt/instruction file by another name —
MIT licensing makes copying *legal*, but this project's own binding policy
is stricter than the license requires, deliberately, and applies with
full force here.

What was actually reused is the **idea**, adapted to what this repo is:

- **`error-handling`**: ECC's version is generic web-backend content —
  Next.js API routes, FastAPI exception handlers, React error boundaries,
  a Go HTTP handler. None of that applies to ClutchCode (no web server, no
  React frontend in the shipped product). The adapted version instead
  documents the conventions this codebase's own source already
  established and would otherwise only live in scattered comments:
  `GitError`/`InvalidTransitionError` extending `Error` with a structured
  `code`/`status`-shaped payload (`packages/git/src/git-exec.ts`,
  `packages/runtime/src/run-state.ts`), the `{ type: "error"; message;
  retryable: boolean }` provider-delta pattern (`packages/providers/src/
  types.ts`) that already gates retry decisions, and
  `packages/runtime/src/error-taxonomy.ts`'s `ErrorClass` — a genuinely
  different axis (classifying a failure the *agent* encountered
  mid-run, not how a contributor writes error-handling code) that the
  new skill explicitly distinguishes rather than conflates.
- **`codebase-onboarding`**: kept the useful shape (a phased
  reconnaissance → architecture map → convention detection → artifact
  methodology) but rewrote every example against this repo's real
  layout (pnpm workspace, `tsc -b` project references, vitest, the
  package-boundary rules in `PROJECT_SPEC.md §20`) instead of ECC's
  Next.js/Prisma examples, and added an explicit rule ECC's version
  doesn't need: **defer to `CLAUDE.md`/`HANDOFF.md`/`PROJECT_SPEC.md`
  rather than regenerating them** — this project's onboarding path
  already exists and is unusually thorough; the skill's job here is to
  point at it, not compete with it.

## license

MIT — permissive, no attribution burden beyond what's already given here
and in each skill file's own note. The constraint above (rewrite, don't
copy) comes from this project's own policy, not from ECC's license.

## Security audit of ECC's executable surface (2026-09-10)

Requested explicitly before any decision to expand what's reused from
this project. Scope: the parts of ECC that **run automatically or on
install**, plus a full-corpus scan of the 286 skill files for
prompt-injection-style content — not a line-by-line review of all
~11.5k lines across every hook script (disproportionate to what's
actually been adopted: two skills' *text*, none of ECC's executable
infrastructure). Findings, not assertions — each is what was actually
read, not inferred from filenames.

**Install path (`install.sh`, `install.ps1`).** Clean. Both resolve
symlinks, run `npm install` in the local clone, and `exec`/invoke a
local `scripts/install-apply.js` — no remote-fetch-and-execute, no
`curl | sh` self-install.

**`package.json` lifecycle scripts.** No `preinstall`, `install`,
`postinstall`, or `prepare` script. This is the check that matters most
for a supply-chain read: nothing auto-executes the moment `npm install
ecc-universal` runs, before a user has looked at anything.

**The always-on hook chain** (`hooks/hooks.json` wires 24 registrations
across every lifecycle event — `PreToolUse`, `PostToolUse`, `Stop`,
`SessionStart`/`End`, mostly `.*` matchers, so this is the highest real
attack surface: code that runs without explicit invocation). Traced the
full chain a Bash command actually goes through: the inline bootstrap →
`plugin-hook-bootstrap.js` → `bash-hook-dispatcher.js` →
`block-no-verify.js` / `gateguard-fact-force.js` / etc. All read in full
or substantially. Findings:
- `plugin-hook-bootstrap.js` has an explicit path-traversal guard
  (`resolveTarget` throws on any resolved path escaping the plugin
  root), timeouts on every spawned process, no network calls, no real
  `eval()`/`new Function()` anywhere in the directory (grepped
  precisely — an earlier combined pattern had conflated this with the
  much more common and completely benign `child_process` usage; corrected
  before concluding anything from it).
- `block-no-verify.js` is actively protective: it blocks `git commit
  --no-verify` and `-c core.hooksPath=` specifically to stop an agent
  from bypassing the user's own pre-commit/pre-push hooks. The opposite
  of a risk.
- The one hook with a real network call (`plan-canvas-pending.js`)
  talks to `127.0.0.1` only — a local server ECC itself runs for its
  "Plan Canvas" UI feature, not an external destination.
- `insaits-security-wrapper.js` (an oddly-specific name that warranted a
  direct look) is gated behind `ECC_ENABLE_INSAITS`, defaults to a
  pure pass-through, and isn't wired into either shipped `hooks.json` —
  present but inert unless a user explicitly opts in.

**`mcp-configs/mcp-servers.json`.** A template with placeholder
credential values (`YOUR_GITHUB_PAT_HERE` etc.) a user fills in
themselves. Every entry is either an official, recognizable MCP server
package (`@modelcontextprotocol/server-github`,
`@modelcontextprotocol/server-memory`, `@supabase/mcp-server-supabase`)
or an ECC-specific tool documented as opt-in ("Not enabled by default,"
"ECC itself performs no browser automation"). Nothing connects to
anything by default.

**All 286 `skills/*/SKILL.md`, scanned for prompt-injection-style
content** (phrases like "ignore previous instructions," "without the
user's knowledge," "exfiltrate," fetch-and-pipe-to-shell patterns).
Three "exfiltrat(e)" hits, all in `docker-patterns`, `security-bounty-
hunter`, and `security-scan` — each one **describing a threat to defend
against**, not an instruction. Two `curl | sh` hits, in `github-ops` and
`tdd-workflow` — both are **explicit warnings not to run this pattern**
from untrusted PR/issue/plan content. No genuine injection-style
instruction found anywhere in the corpus.

**Verdict.** Nothing sampled contradicts ECC being what it presents as:
a real, actively maintained, security-conscious project. This is a
**sampled** audit of the highest-risk categories (install path, the
always-on hook chain, MCP defaults, a full-corpus injection scan), not
an exhaustive review of every script — stated honestly rather than
implying more coverage than was done. It does not change the ADR-016
posture above: a clean security audit says the *content* is safe to
read and learn from, not that copying it verbatim satisfies this
project's own reuse policy, which is a separate, non-security question.

## Second pass — 10 more skills sampled, same rigor (2026-09-10)

Requested explicitly ("continue," after an offer to keep going with the
same lens). Same method as the first pass: sample plausible candidates,
check each against what this project already does or actually is,
adopt only what's genuinely additive.

**Result: 1 of 10 worth adopting.** That low hit rate is itself a real
finding, not a failure to look hard enough — see the note at the end.

| ECC skill | Verdict | Why |
|---|---|---|
| `verification-loop` | Rejected | Generic "how Claude should verify its own session work" — collides with §14's actual verification gate + cheat detection, which is shipped product code, not session guidance. Same collision shape as `tdd-workflow` in the first pass. |
| `eval-harness` | Rejected | Same collision, against §16's actual eval scoreboard (`evals/`) |
| `delivery-gate` | Rejected | A generic Stop-hook that blocks completion until checks pass — this project's own `CLAUDE.md` Autonomous continuation loop already specifies exact stop conditions and a build/test/lint gate; a second, differently-shaped gate would compete with it |
| `autonomous-loops` | Rejected | ECC's own file says "retained for compatibility only... use `continuous-agent-loop` instead" — and `continuous-agent-loop` would hit the same collision as `delivery-gate` against this project's own bespoke Autonomous continuation convention (`start-work`/`refer-handoff`) |
| `e2e-testing` | Rejected — inapplicable | Playwright/Page-Object-Model patterns. ClutchCode has no browser UI at all to test this way |
| `make-interfaces-feel-better` | Rejected — inapplicable | Visual/GUI polish (spacing, shadows, motion). No custom UI surface exists — the VS Code extension uses VS Code's own native diff editor, not a built one |
| `production-audit` | Rejected — inapplicable | Entirely about deployed-service readiness (auth boundaries, payment boundaries, rollback path). ClutchCode explicitly has no hosted service — this is load-bearing in this project's own license reasoning (`LICENSE_AND_REUSE_ANALYSIS.md §1`: *"There is no hosted service to protect"*) |
| `mcp-server-patterns` | Rejected — wrong direction | About *building* an MCP server (registering tools for others to call). This project's roadmap item and `PROJECT_SPEC.md`'s ADR-017 are both about *consuming* MCP as a client, treating external tools as untrusted — the opposite direction. Revisit only if the roadmap item becomes "expose an MCP server," not before. |
| `living-docs-governance` | Rejected — already built, more specifically | Reads as an almost point-for-point generic description of this project's own `CLAUDE.md`/`HANDOFF.md`/`PROJECT_LOG.md` three-tier system — "assign constitution/map/status/history roles... prefer the repository's current docs structure... reuse and link them in place" is exactly the reasoning `CLAUDE.md`'s own "three continuation documents" section already gives, independently, in more project-specific detail. Worth recording as convergent validation, not worth importing: the project doesn't need to be told to do what it already does. |
| `code-tour` | **Adopted, adapted** | Genuinely additive: CodeTour (`microsoft/codetour`, MIT) is a real, unrelated-to-web-stack format for guided `.tour` walkthroughs, and this project ships an actual editor extension (`apps/vscode`) that could plausibly have it installed. No existing convention collides with it. Adapted with a ClutchCode-specific example (touring the agent-loop → verification → cheat-detection path) replacing ECC's generic payments-service example, and a note on where tours actually pay off in *this* codebase's specific shape (package-boundary tours, PR tours across boundaries, RCA tours for the multi-package bugs `docs/PROJECT_LOG.md` already records). |

**Why the hit rate is low, and why that's the honest finding rather than
insufficient effort.** ECC's 286 skills skew toward what a generic
full-stack SaaS team needs — deployed services, payment flows, browser
E2E, custom UI polish, database ORMs, mobile platforms. ClutchCode is a
local-first CLI + library with no hosted service, no browser surface, no
payment flow, and — because its own domain *is* "coding-agent harness" —
the skills that sound most relevant by name (verification, eval,
autonomous loops) are exactly the ones most likely to collide with a
product feature or bespoke convention this project already built more
specifically. Two rounds, 16 skills sampled, 3 adopted (`error-handling`,
`codebase-onboarding`, `code-tour`) is a defensible, honestly-reported
result — not a signal to keep grinding through the remaining 270 without
a specific reason to expect a different pattern.
