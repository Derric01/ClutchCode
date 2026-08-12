# Aider — repo note

Clone: `Aider-AI/aider` @ `5dc9490`, 2026-08-12. Apache-2.0. Python (~151 src files). **Highest-value target for edit formats + repo mapping.** Files cited were read directly.

## architecture
Terminal pair-programmer. Core = a family of "Coder" classes (`aider/coders/`) each pairing an edit format with a prompt set; a git-aware `repo.py`; a tree-sitter `repomap.py`; provider access via litellm. Not a sandboxed autonomous runtime — a chat→edit→(optional test/lint) loop with the human in the loop.

## runtime model
Single process, single agent, interactive REPL (`aider/main.py`, `io.py`). One model (optionally a 2-model architect/editor split).

## agent loop shape
Chat turn → model proposes edits (in the selected format) → edits applied to files → optional auto-lint/auto-test → **reflection**: on lint/test failure the error is fed back for a bounded number of retries (`base_coder.py`, `num_reflections`/`max_reflections`). Human drives continuation.

## turn/step budgeting
Bounded reflections (small integer cap) rather than a step/token/cost budget machine. No wall-clock/cost ceiling abstraction.

## tool system & schemas
No general tool-call abstraction. "Tools" are implicit: edit application + optional shell command suggestions (`shell.py`) the user confirms. Not function-calling-centric.

## edit format *(the crown jewel)*
Multiple formats, one per Coder: **whole-file** (`wholefile_coder.py`), **unified diff** (`udiff_coder.py`, `udiff_simple.py`), **search/replace "editblock"** (`editblock_coder.py` + `editblock_prompts.py`), fenced/func variants, and a **patch** format (`patch_coder.py`). Prompt for SEARCH/REPLACE: `editblock_prompts.py` (exact `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE`, "SEARCH must EXACTLY MATCH char-for-char", first-match-only, keep blocks small). Application cascade `editblock_coder.py:127-240`: `perfect_replace` (exact) → `replace_part_with_missing_leading_whitespace` (uniform whitespace drift) → drop spurious leading blank line → `try_dotdotdots` (explicit `...` elision). **`replace_closest_edit_distance` (fuzzy) is DISABLED by an early `return` at `editblock_coder.py:183`** — a deliberate learned lesson: fuzzy apply silently misplaces edits.

## filesystem access
Direct fs; files must be "added to the chat" to be edited (explicit context control). New files creatable.

## shell execution
Suggests shell commands; user confirms (`shell.py`). Auto-test/auto-lint run configured commands (`--test-cmd`, `--lint-cmd`).

## git integration
Strong (`repo.py`): auto-commits each AI edit with a generated message + attribution; dirty-commit handling; `--no-auto-commits`; undo via git. Commits into the user's working tree (no worktree isolation).

## context management & compaction
Repo map is token-budgeted (below). Chat history persisted to `.aider.chat.history.md`; summarization of older history. No aggressive per-window discipline like local-first tools need.

## permission model
Human-confirm for shell + file adds. No policy engine / classes.

## sandboxing
**None.** Shell runs on the host with confirmation only.

## model/provider abstraction
Via **litellm** (`llm.py`, `sendchat.py`) → 100+ providers incl. OpenAI-compat/Ollama. Per-model settings in `aider/resources/model-settings.yml` (incl. the **edit format chosen per model** and metadata) — a key idea: the harness knows which edit format each model does best.

## local & open-weight model support
Yes — any litellm-reachable endpoint incl. Ollama and OpenAI-compatible `--openai-api-base`. Weaker models are pointed at whole-file or the format set in model-settings. Published **edit-format leaderboard** (`benchmark/`) measures per-model edit accuracy — the canonical prior art for §4.3.

## config schema
`.aider.conf.yml`, `.aider.model.settings.yml`, env, CLI args (`args.py`). `CONVENTIONS.md` as project rules.

## memory/persistence
Chat history file; no structured run DB; conventions file for project memory.

## workflow/orchestration
Implicit (chat). Architect/editor split (`architect_coder.py`) = a lightweight 2-role pattern (plan model + edit model).

## subagents
None (architect/editor is 2 model *calls*, not agents).

## testing of the agent itself
`tests/` + a substantial `benchmark/` harness that scores edit-format accuracy per model — a model of how to measure the thing that matters.

## evals/benchmarks
The code-editing benchmark / leaderboard is Aider's signature contribution.

## observability
Chat history markdown; `--verbose`; token/cost reporting. No structured event store.

## CLI/TUI UX
Polished terminal REPL; `/add`, `/drop`, `/diff`, `/undo`, voice, etc.

## editor integration
Thin (watch-files mode; no first-class extension).

## extensibility/plugins
Limited; model-settings + conventions are the main knobs.

## security model
Trust-the-user; confirm shell. Not designed for untrusted repos/autonomy.

## distribution & install
`pip`/`pipx`/`uv`. Python packaging.

## license
Apache-2.0.

## notable tradeoffs
Optimizes edit reliability + git hygiene over autonomy/sandbox. Human-in-loop by design.

## strengths
Best-in-class edit formats + the empirical leaderboard; excellent git integration; broad provider support; repo map.

## weaknesses
No sandbox, no worktree isolation, no verification-as-gate (runs tests but doesn't detect cheating), no resumable run state, thin editor story.

## reusable ideas
(1) SEARCH/REPLACE + the exact-tolerant apply cascade; (2) **per-model edit-format selection** from a settings table + a probe; (3) the **edit-format benchmark** as the metric that predicts success; (4) tree-sitter PageRank repo map (`repomap.py:365-529`, `nx.pagerank` with personalization on mentioned idents).

## explicitly do-not-copy
The **disabled fuzzy matcher** (`editblock_coder.py:183`) — do not reintroduce silent fuzzy edit application. Also: don't adopt commit-into-working-tree (we use worktree isolation §13). And per LICENSE, the SEARCH/REPLACE *prompt text* is STUDY-ONLY; the matching *code* is CLEAN-ROOM.
