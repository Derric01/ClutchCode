# SWE-agent — repo note (Tier-2: agent–computer interface as research)

Clone: `SWE-agent/SWE-agent` @ `3ea751c`, 2026-08-12. MIT. Python. **Verified:** `swe-agent/config/*.yaml` (`default.yaml`, `bash_only.yaml`, `coding_challenge.yaml`, `default_backticks.yaml`, multimodal variants); `docs/`, `mkdocs.yml`. Structure-derived + prior art.

## architecture
A research agent (Princeton) whose contribution is the **Agent–Computer Interface (ACI)**: the idea that *carefully designed commands/tools + feedback formats* (not just a better model) drive SWE-bench performance. The agent is heavily **config-driven** (YAML defines the tools, prompts, and interface).

## agent loop shape
ReAct-style: observe → think → act (a bundled command) → observe. Bounded steps; SWE-bench task harness around it.

## tool system & schemas *(the reason to study it)*
Tools = **bundled shell commands with LSP-like helpers** (e.g., a special file viewer/editor with line windows, search, `goto`) designed so the model edits reliably. The **ACI insight** — that interface design is as important as the model — is a direct ancestor of our §4 (adapt the interface to the model) and §11 (tool ergonomics: windows, truncation).

## edit format
A custom **file editor command** with line-window views + edit-by-line, plus lint feedback on edit — designed to reduce malformed edits. Prior art for §4/§11.3.

## filesystem / shell / sandbox
Runs in a Docker/container environment per task (SWE-bench harness). Isolation is container-based.

## config schema *(high value)*
Everything is **YAML config** (`config/*.yaml`): tools, prompts, parsers, history processors. Shows both the power and the risk (§8.1: config-as-language) of YAML-driven agents.

## model/provider abstraction
litellm-style multi-provider incl. local; the point is the ACI, not the provider.

## evals/benchmarks *(central)*
Built **for SWE-bench** — the canonical coding-agent benchmark; strong harness/eval culture. Directly informs our §16 eval suite (SWE-bench Verified subset).

## memory / observability
Trajectory logs per task (inspectable) — a good model for our run transcripts (§15).

## strengths
The **ACI thesis** (interface > raw model), config-driven tools, rigorous eval harness, inspectable trajectories.

## weaknesses (for our user)
Benchmark-oriented, container-per-task, not a daily local dev tool; YAML-as-config-language risks (§8.1).

## reusable ideas
(1) **ACI: design tools/feedback for the model's benefit** (windows, `goto`, lint-on-edit) → §4/§11; (2) **trajectory logs** → §15; (3) **SWE-bench harness** → §16.3; (4) config-driven interface as a *cautionary* study for §8.1.

## explicitly do-not-copy
Container-per-task as a daily-driver assumption; unbounded YAML-as-language. MIT permits reuse w/ attribution; reimplement clean-room per policy.
