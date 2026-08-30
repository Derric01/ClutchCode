# Security Policy

ClutchCode executes language-model-generated shell commands and file edits
against your codebase, and handles provider credentials. Its security posture
is a feature, not an afterthought — `PROJECT_SPEC.md §5` (secrets), `§12`
(permissions and sandboxing) and `§13` (git isolation) are the normative
specification, and this file is the practical summary.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately via GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
— the **Security** tab → **Report a vulnerability**. That opens a private
advisory visible only to maintainers.

Please include: what you did, what happened, what you expected, and — ideally
— a minimal reproduction. A throwaway repo plus the exact command is worth
more than a paragraph of description; that is the standard this project holds
its *own* findings to (see `CLAUDE.md`, "Fixing a bug or vulnerability: prove
it, don't assume it").

What to expect: acknowledgement of the report, an assessment of whether it is
reproducible, and a fix with a regression test that is verified to fail
against the pre-fix code. This is a small project — there is no funded bounty
and no contractual response-time guarantee. Credit is given in the advisory
and the changelog unless you ask otherwise.

## Supported versions

Pre-1.0 and under active development. Only the latest `main` receives
security fixes; there are no maintained release branches yet.

## Threat model — what counts as a vulnerability

The core assumption: **the language model is untrusted.** It may be adversarial,
prompt-injected via repository content it reads, or simply wrong. The harness
is what stands between the model and your machine.

**In scope** — please report these:

- Escaping the run's git worktree or the workspace confinement (writing or
  reading outside it) — `§12.3`, `§13`.
- Escaping or neutralizing the OS sandbox (bubblewrap namespaces, the seccomp
  filter) — `§12.5`, `§12.6`.
- Bypassing the permission/approval engine: getting a destructive or
  network-touching command executed without the approval it requires, or
  riding a remembered approval for a different command — `§12.1`, `§12.2`.
- Reading a path on the secrets denylist (`.env`, `~/.ssh`, `~/.aws`, …)
  through any route — `§5.3`.
- Leaking a credential or secret into a transcript, event log, crash report,
  or model context — the redaction pipeline is supposed to prevent this at
  every boundary — `§5.2`.
- Credential storage weaknesses (keychain, the encrypted file store) — `§5.1`.
- **Defeating the verification gate**: getting a run marked complete when the
  build/test/lint gate did not genuinely pass, including by having the model
  edit the commands that define the gate. Cheat detection exists specifically
  to catch this — `§14`.
- Command or argument injection into the git, shell, or process tooling.
- Path traversal via any identifier that becomes a filesystem path.

**Out of scope** — real limitations, but known and documented rather than
undisclosed:

- **The macOS (Seatbelt) and Windows sandbox paths.** The Seatbelt profile is
  written against the documented SBPL grammar but **has never been run on real
  macOS** — no macOS host exists in this project's environment. Windows Tier 1
  is deliberately **doc-only**; WSL2 is the recommended path (`§12.5`,
  `[C:Low]`). Neither is a hidden gap: both are flagged in `README.md`, in
  header comments, and in `HANDOFF.md`. Reports that they are unverified are
  correct but already known; a report that the *generated profile itself* is
  wrong is in scope and welcome.
- **Landlock is not implemented yet** (`§12.6`). Tracked in `HANDOFF.md`.
- **Tier 0 fallback is intentional.** With no sandbox backend available, or
  with `policy.sandboxTier = "tier0"` set explicitly, commands run without OS
  confinement — the policy engine and env scrubbing still apply. This is a
  documented, opt-in trade-off, not a bypass.
- **A trusted repo trusts more.** `repoTrustMode: "trusted"` deliberately
  auto-approves non-destructive commands (`§12.4`). That is the setting doing
  its job.
- Anything requiring an attacker who already has local code execution as your
  user, or write access to your dotfiles — that attacker has already won.
- Vulnerabilities in third-party dependencies: report upstream. Tell us if a
  fix needs a change here.

## What the harness does to earn that trust

- **Worktree isolation** — a run edits an isolated git worktree on its own
  branch, so the blast radius of a bad run is bounded and reviewable before
  anything reaches your working tree (`§13`).
- **Default-deny network** at the OS level under Tier 1, plus a policy-engine
  default-deny above it (ADR-019).
- **A minimal child environment** — `*_API_KEY`, `AWS_*`, `GH_TOKEN` and
  friends are stripped from every spawned process; only an allowlist passes.
- **A synthetic `$HOME`** — the sandbox never exposes your real one.
- **Redaction at every boundary**, asserted by a canary test that injects a
  fake secret and proves it appears in no transcript, event log, or artifact.
- **A deterministic completion gate** plus cheat detection, so "done" means
  the build and tests actually passed — not that the model said so.

## Local-first by design

No mandatory cloud service, no account, no telemetry. Nothing is transmitted
except the model requests you configure. This is enforced by a release-gate
test, not a promise: the eval harness runs a task offline with egress blocked
at the OS level against a local model and asserts a verified completion
(`§17`). If that test cannot pass, the local-first claim is false.

The one honest caveat, worth stating plainly: **when you point ClutchCode at a
hosted model, your code and context are sent to that provider.** Use a local
model via Ollama if that is unacceptable for your codebase.
