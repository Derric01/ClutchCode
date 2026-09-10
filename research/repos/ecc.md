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
