# ClutchCode

**A model-agnostic, local-first coding agent that gets better at your repo the more you use it.**

ClutchCode is the harness layer between a language model and your codebase. It turns *any* model —
a frontier API **or** a 14B model running on your own gaming-laptop GPU — into an engineer that
inspects, edits, runs, tests, repairs, and **verifies** code on your machine. It never phones home,
you own your keys and your data, and it proves work is done by *actually running your tests* — not by
the model claiming success.

> **Status: Phase 0 complete — architecture & plan are done; implementation is starting.**
> ClutchCode is **not yet installable**. This repository currently contains the specification,
> the build plan, and the research it's based on. Follow along as it's built in the open.

---

## Why it's different (honestly)

- **Local-first & model-agnostic.** Bring your own key (Claude, GPT, Groq, OpenRouter, DeepSeek, any
  OpenAI-compatible endpoint) **or** run fully offline against Ollama / llama.cpp / LM Studio / vLLM.
  With a frontier key you run the *same model the paid tools run* — so you're not giving up capability;
  you're adding the layers below on top of it.
- **Verification-gated "done" + cheating detection.** A run only succeeds if the build/tests/lint pass
  **and** the agent didn't cheat (deleting failing tests, weakening assertions, skipping checks) **and**
  you approved the diff. This cheat-detection layer is something no mainstream coding agent does.
- **Compounding Engineering Memory (the unique bet).** ClutchCode remembers your build/test conventions,
  your run history, and — uniquely — **which approaches already failed and why**, so it stops repeating
  dead ends and gets measurably faster on *your* repo over time. No model training, all local, fully
  correctable. It's a measured bet with a kill-criterion, not a marketing claim ([details](EXECUTION.md)).
- **Safe by construction.** Every run happens in an isolated git worktree (your working tree is never
  touched), inside an OS-level sandbox, with secrets scrubbed from everything the model ever sees.
- **No telemetry, no servers, no account.** Ever. The offline test is a release gate.

**Honest limits:** on a *weak local model*, ClutchCode will not match Claude Code / Codex / Cursor on
hard tasks — the model is the ceiling. Its edge is being the best **open, local-first, private, verified**
agent for people the paid cloud tools can't or won't serve, and for anyone who wants their own model +
their own data + a tool that improves with use. See the honest assessment in
[`PROJECT_SPEC.md §23`](PROJECT_SPEC.md).

## The journey it supports

```
install → configure a provider (an API key OR a local model) → point at a repo → give a task →
agent inspects · edits · runs · tests · repairs · verifies → you review the diff → approve → commit
```

Driven from a **terminal (TUI)** or a **VS Code extension** — both talk to the same runtime.

## Documentation

| Doc | What it is |
|---|---|
| [`PROJECT_SPEC.md`](PROJECT_SPEC.md) | Authoritative architecture (capability adaptation, runtime, sandbox, verification, memory, ADRs). |
| [`EXECUTION.md`](EXECUTION.md) | The build plan: stack, the fork strategy, milestones M0→v1.0, the CEM differentiator, testing. |
| [`CLAUDE.md`](CLAUDE.md) | Working guide + golden rules for contributors (human and agent). |
| [`LICENSE_AND_REUSE_ANALYSIS.md`](LICENSE_AND_REUSE_ANALYSIS.md) | License choice, reuse rules, attribution obligations. |
| [`research/`](research/) | The primary-source study of existing coding agents this design is built on. |

## Built on / Credits

ClutchCode stands on excellent open-source work and credits it permanently, as its licenses require and
as good practice demands. **This project is not affiliated with or endorsed by any of the following.**

- **[OpenAI Codex CLI](https://github.com/openai/codex)** (Apache-2.0) — ClutchCode's runtime is a
  **fork** of the Codex local-first core (Rust, `ratatui` TUI, OS sandbox, `apply_patch`, MCP, app-server),
  carved down and with all cloud/telemetry/account components removed. Upstream `LICENSE`/`NOTICE` are
  preserved.
- Design and patterns studied and reimplemented independently (no code or prompt text copied), each
  credited in [`docs/PRIOR_ART.md`](docs/) as the project is built:
  **[Aider](https://github.com/Aider-AI/aider)** (Apache-2.0) — edit formats & repo map ·
  **[Cline](https://github.com/cline/cline)** (Apache-2.0) — editor UX & tool protocol ·
  **[OpenHands](https://github.com/All-Hands-AI/OpenHands)** (MIT) — resumable state & context condensation ·
  **[goose](https://github.com/block/goose)** (Apache-2.0) — MCP extension model ·
  **[Continue](https://github.com/continuedev/continue)** (Apache-2.0) — model routing ·
  **[SWE-agent](https://github.com/SWE-agent/SWE-agent)** (MIT) — eval harness design ·
  and the **[Model Context Protocol](https://modelcontextprotocol.io)** (implemented, not copied).

Provider and model names (Claude, GPT, Gemini, Grok, etc.) are trademarks of their respective owners and
are used only to describe compatibility — no endorsement is implied.

## License

[Apache-2.0](LICENSE) — fully open source, all development in the open. Contributions via DCO
(`Signed-off-by`). See [`LICENSE_AND_REUSE_ANALYSIS.md`](LICENSE_AND_REUSE_ANALYSIS.md).
