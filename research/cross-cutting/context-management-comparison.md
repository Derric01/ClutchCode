# Cross-cutting: Context-management & compaction comparison

Synthesized from repo notes. Feeds PROJECT_SPEC §4.5, §9, §10.

## Approaches

| Project | Retrieval | Compaction | Whole-repo-in-context? |
|---|---|---|---|
| Aider | **tree-sitter PageRank repo map** (token-budgeted; `repomap.py:365-529`) + explicit file "add to chat" | history summary; `.aider.chat.history.md` | no — map is ranked + budgeted |
| Codex | UNVERIFIED depth | session | UNVERIFIED |
| OpenHands | agent retrieval | **condenser** strategies (named subsystem) | container has the files, context is condensed |
| Cline | `@`-mentions + env-details block | context-window truncation/condensation | no |
| Continue | **embeddings index** (`core/indexing`) + context providers | rules/prompt files | RAG-forward |
| Archon | external-doc **vector RAG** (pgvector) | n/a (serves knowledge) | it's a knowledge base, not repo context |
| **ClutchCode** | **ripgrep + on-demand tree-sitter** (MVP); PageRank map (Phase 7); **no vector DB** (§9) | **summarization checkpoints** + tool-output truncation-at-ingestion | **hard rule: NEVER dump the repo** (§4.5) |

## Key judgments
1. **Never dump the whole repo** into context — fatal on local 8k models, wasteful on frontier. Universal rule (§4.5); Aider's ranked map and Cline's windowing embody it.
2. **Budget against *effective* context**, not advertised — local models degrade well before the limit; we allocate fractions (system/retrieval/windows/history/output) that scale down (§4.5).
3. **Compaction as checkpoints**, not just truncation — OpenHands' condenser is the model; we compact tool history into a running summary + `RunState` checkpoints so `resume` works (§6.2, §10).
4. **Retrieval ≠ embeddings.** Continue/Archon lean on vector search; for *repo code navigation* (defs/refs/callers) tree-sitter + PageRank beats embeddings on build time, staleness, memory, and offline operation — so **no vector DB by default** (§9). Embeddings earn their place for *external-doc* knowledge (Archon's use case), which is out of scope.
5. **Truncate tool output at the source** (§11.3) — the single biggest context-preservation win, under-addressed elsewhere.

## Reusable / do-not-copy
- **Reusable:** Aider PageRank map (clean-room), OpenHands condenser (pattern), Cline windowing/mentions.
- **Do-not-copy:** embeddings-by-default for repo context (dependency weight + staleness + VRAM contention on Profile B, §9).
