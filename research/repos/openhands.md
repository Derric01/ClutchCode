# OpenHands — repo note

Clone: `All-Hands-AI/OpenHands` @ `2e7136c`, 2026-08-12. MIT. **Clone reality (verified):** this checkout is **`@openhands/agent-canvas` v1.12.0** — a TypeScript "Agent Canvas" *visual control frontend* that runs agents via **ACP (Agent-Client Protocol)** (`openhands/docs/ACP_AGENTS.md`, `openhands/examples/acp-docker`, `openhands/scripts/gen-acp-docker-env.mjs`). The classic **Python core** (controller/events/runtime/agenthub) is **not present in this clone**; agent logic is external (npm deps / ACP-connected agents). Architecture claims about the classic core below are **prior-art / doc-derived** (well-established from the OpenHands/OpenDevin research), explicitly flagged; claims about the *canvas* are from this clone.

## architecture
Canvas (this clone): a UI + ACP client that launches/attaches coding agents (incl. in Docker) and visualizes runs. Classic core (prior art): an **event-stream** architecture — `AgentController` consumes/produces events; a typed **Action/Observation** interface (the "agent-computer interface", ACI); a Docker-based **Runtime**; pluggable agents in `agenthub` (notably **CodeActAgent**).

## runtime model
Canvas: Node UI + ACP transport to agent processes (often containerized). Classic: Python controller + a runtime server executing actions inside a Docker container.

## agent loop shape
Classic (prior art): controller loop — model emits an **Action** (e.g. `CmdRunAction`, `FileEditAction`, `IPythonRunCellAction`); runtime returns an **Observation**; repeat; explicit **State** object enables pause/resume. Canvas: orchestrates this over ACP.

## turn/step budgeting
Classic: max iterations / budget per session (prior art).

## tool system & schemas
Classic: **Action/Observation** typed messages *are* the tool interface (ACI). Strong, inspectable abstraction. Canvas: ACP messages.

## edit format
Classic: LLM-based file editing via `FileEditAction` (and an `openhands-aci` editor with str-replace/whole-file); prior art.

## filesystem access / shell execution
Classic: executed inside the Docker runtime (isolation by container); `CmdRunAction` for shell, IPython for code.

## git integration
Classic: operates in the container workspace; PR/patch export for SWE-bench.

## context management & compaction
Classic: **condenser** strategies (context condensation) — prior art; a named subsystem for shrinking history (informs our §10 checkpoints).

## permission model
Classic: **confirmation mode** + a `security/` analyzer (e.g. invariant/LLM risk analysis) — prior art.

## sandboxing
Classic: **Docker container is the default runtime** — strong isolation but heavy on a laptop (the exact tradeoff we avoid defaulting to, §12.5). Canvas: ACP-to-Docker examples confirm the container orientation persists.

## model/provider abstraction
Classic: **litellm** → many providers incl. local (Ollama/vLLM/OpenAI-compat). Local support exists but without systematic weak-model down-adaptation (our §4 gap-filler).

## config schema
Classic: `config.template.toml` + `core/config/`. Canvas: env + ACP config.

## memory/persistence
Classic: event stream persisted → State → resumable; `AGENTS.md` present in clone (convention adoption).

## workflow/orchestration
Classic: agent delegation exists (multi-agent), plus micro-agents. Canvas: run orchestration/visualization.

## subagents
Classic: yes (delegation, micro-agents) — prior art.

## testing / evals
**SWE-bench** positioning is central to OpenHands' identity; strong eval infra (prior art).

## observability
Canvas is literally an observability/visualization surface; classic emits the event stream.

## CLI/TUI/editor
Historically web-app-oriented; the canvas + ACP direction points at editor/agent-client integration (ACP is Zed-originated).

## security model
Container isolation + confirmation + security analyzer (prior art). Strong but heavy.

## distribution & install
Docker-centric historically; canvas via npm (`agent-canvas` bin).

## license
MIT.

## strengths
The **Action/Observation ACI** + **event-stream State** (resumability) + **condenser** are the standout designs; strong SWE-bench eval culture; Docker isolation.

## weaknesses (for our user)
Docker-default is heavy on laptops; weak-local-model adaptation not systematic; historically web-first.

## reusable ideas
(1) **Typed Action/Observation ACI** — informs our typed tool results (§11.1); (2) **explicit State for resume** — informs `RunState` (§6.2); (3) **condenser** — informs compaction checkpoints (§10); (4) **ACP as an agent/editor boundary** — validates our ACP-shaped Agent API (§18.5); ACP also appears in Goose (`goose-acp-macros`), a convergence signal.

## explicitly do-not-copy
Don't adopt **Docker-as-default isolation** (§12.5). MIT permits code reuse *with attribution*, but per our policy the ACI/State/condenser are **reimplemented clean-room** (LICENSE §2). Verify any classic-core claim against current source before building (this clone doesn't contain it).
