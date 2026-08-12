# Tier-3 prior art (read as designs, not adopted as code)

Cloned/verified: `SWE-bench/SWE-bench` @ `f5daed8`, `laude-institute/terminal-bench` @ `d28711d`, `modelcontextprotocol/modelcontextprotocol` @ `5947545`. ReAct/Reflexion and Anthropic guidance are literature, not repos. Feeds PROJECT_SPEC §14, §16, §11, §6.

## SWE-bench / SWE-bench Verified (harness design)
- **What:** real GitHub issues + gold patches + the repo's own test suite; a task is "solved" iff the **FAIL_TO_PASS** (and PASS_TO_PASS) tests pass after applying the agent's patch in a per-task container.
- **Design lessons we adopt:**
  1. **Deterministic, test-based success** — not model self-report. Directly validates our completion contract (§14.7).
  2. **Per-task isolated environment** with the project's real toolchain → our toolchain autodetect (§14.2) + worktree isolation (§13).
  3. **Verified subset** exists because the full set is noisy/heavy → we run a **curated subset** in our eval suite (§16.3), not the whole thing.
- **Caution:** SWE-bench is Python/library-heavy and not representative of a typical individual-dev task; hence our **hand-built realistic suite** (bug fix, small feature, refactor, test-add, dep bump) across languages as the primary metric (§16.3).

## Terminal-Bench (terminal/tooling tasks)
- **What:** benchmark of agent competence at **terminal tasks** in a controlled container (run commands, manipulate files, use tools) with programmatic checks.
- **Lesson:** coding agents fail not only at edits but at **driving the shell/tooling**; our eval includes Terminal-Bench-style tasks (§16.3) to catch shell/tool-loop regressions, and it motivates strong tool ergonomics + output truncation (§11).

## ReAct (reason+act) and where it fails
- **Pattern:** interleave reasoning traces with actions/observations. The backbone of most agent loops.
- **Failures in practice:** **thrashing** (repeated identical actions) without loop detection; **over-planning** trivial tasks; brittle when the observation is a huge log. → We add deterministic **loop/thrash detection** (§6.4), **skip-planning heuristics** (§6.7), and **output truncation** (§11.3).

## Reflexion (self-critique/verbal RL) and where it fails
- **Pattern:** the agent reflects on failures and retries with the reflection in context.
- **Failure:** **rationalization** — the model can "reflect" itself into unjustified confidence without new evidence; self-critique is not an external oracle. → We make **verification the external truth oracle** (§14), cap repair iterations (§14.5), and detect **cheating** (§14.6) rather than trusting reflective "done."

## Anthropic guidance on agents / tools / context (design principles applied)
- **Prefer simple, composable loops over elaborate frameworks; give the model good tools and clear feedback.** → single-agent-by-default (§7), small native tool core (§11), ACI-style ergonomics.
- **Tool definitions are an interface to design carefully** (clear names, typed args, good errors). → §11.1 typed tools + structured error contracts.
- **Context engineering matters more than context size.** → never-dump-the-repo, budgeting, checkpoints (§4.5, §10).
- **Multi-agent only when the work is genuinely parallel/independent.** → §7 decision rule.
- (Applied as principles; **no prompt or text copied** — Anthropic guidance is reference reading, and Claude Code prompts are STUDY-ONLY, LICENSE §7.)

## MCP (Model Context Protocol) spec
- **What:** an open protocol (client/server; tools, resources, prompts; JSON-RPC) for connecting agents to external capabilities.
- **How we use it:** implement an **MCP client** (and optionally server) to the published spec — **protocol conformance, not code copying** (the one genuine REUSE, LICENSE §2). MCP is our **third-party tool boundary** (§11.2), treated as **untrusted** (arbitrary code + prompt-injection vector, §12.1).
- **Convergence note:** MCP is adopted across Codex, Goose, Cline family, Continue, gemini-cli → implementing it is table stakes. **ACP (Agent-Client Protocol)** — seen in OpenHands-canvas + Goose — is the analogous *editor/agent* boundary we shape our Agent API after (§18.5).
