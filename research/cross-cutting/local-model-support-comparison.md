# Cross-cutting: Local & open-weight model support comparison

Synthesized from repo notes. **This is the axis where ClutchCode differentiates** — feeds PROJECT_SPEC §4 (the heart), §4.10, §16.4. Emphasis on **Profile B (gaming laptop, 8–16 GB NVIDIA)** and **Profile D (homelab 48 GB+)**.

## Where each project stands

| Project | Local support | Weak-model adaptation | Gaming-laptop reality |
|---|---|---|---|
| Claude Code | **none** (proprietary, Claude-only) | n/a | can't run local at all |
| Codex | OpenAI-compat base_url; some oss paths | limited | possible but not the focus |
| Aider | any litellm/Ollama/OpenAI-compat; **per-model edit-format table** | **partial** (picks edit format per model) | usable; best local edit-format guidance today |
| OpenHands | litellm → Ollama/vLLM | not systematic | Docker-default is heavy on a laptop |
| Cline/Roo/Kilo | **Ollama + LM Studio** native | XML protocol helps weak models | good; editor-bound |
| Goose | **`goose-local-inference` crate** | provider-types seams | strong local seam |
| Continue | Ollama/LM Studio; per-role models | routing | good; RAG-forward |
| **ClutchCode** | **first-class**: Ollama/llama.cpp/vLLM/LM Studio/MLX/OpenAI-compat | **systematic**: capability probe + edit-format fallback + tool-call emulation + context budgeting + constrained decoding | **the canonical design target** (§3, §4.10) |

## The gap we fill
No reference project treats **"measure the model's ability, then adapt edit format / tool transport / context budget to it"** as the core product. Aider's per-model edit-format table is the closest, but it is a static table, not a probe, and it does not do tool-call emulation / constrained decoding / context down-scaling as an integrated layer. That integrated **adaptation layer (§4)** is ClutchCode's reason to exist.

## Serving stack guidance (→ §4.10)

| Server | Best for | Key feature for us |
|---|---|---|
| Ollama | Profiles A/B beginners | easiest pull/run; `/v1` OpenAI-compat |
| llama.cpp / llama-server | weak-model reliability | **GBNF grammar** → enforce tool/edit format at decode |
| vLLM | Profile D throughput | JSON-schema guided decode |
| LM Studio | Profile B GUI users | OpenAI endpoint |
| MLX | Profile A (Apple) | fastest on Metal |
| any OpenAI-compat | universal | one adapter covers all |

## Gaming laptop (Profile B) specifics — the hard target
- **14B Q4_K_M ≈ 9–10 GB weights** + 1–2 GB KV at 8k → fits **12 GB VRAM** with headroom; 16k KV may spill (doctor warns). (§4.10)
- **Constrained decoding (GBNF via llama.cpp)** is the biggest reliability lever for a 14B — it makes SEARCH/REPLACE and tool calls near-always parseable.
- **Context budget** must assume ~8–12k *effective*; never dump the repo; window files; truncate tool output.
- **`agent doctor`** detects CUDA/VRAM, recommends 14B Q4_K_M, pulls it, probes it, verifies the **offline path** — working local setup in <5 min.

## Proving the claim (→ §16.4)
North Star: **VTCR of a 14B local model *with* ClutchCode materially exceeds the same model naked.** A/B on the realistic-task suite, averaged over seeds (local nondeterminism), published methodology. If the delta is small, the project's core premise fails (§23.5) — stated honestly.

## Reusable / do-not-copy
- **Reusable:** Aider's per-model edit-format table (evolve into a *probe*, §4.9); Goose's local-inference seam; llama.cpp GBNF.
- **Do-not-copy:** Claude Code's Claude-only assumption; Docker-default (blocks GPU passthrough on laptops, §12).
