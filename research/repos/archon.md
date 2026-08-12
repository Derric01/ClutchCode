# Archon — repo note

Clone: `coleam00/Archon` @ `21b4703`, 2026-08-12. MIT. Python + TS. **Verified structure:** docker-compose microservices (`archon/deploy/docker-compose.yml`), Dockerfiles, `CLAUDE.md` + `AGENTS.md`, RAG stack. **What it actually is (one sentence): Archon is a knowledge-base + task/project-management "command center" and MCP server for AI coding assistants — NOT a code-editing agent.** Many headings are therefore N/A.

## architecture
Microservices behind docker-compose: a server/API, an **MCP server** (exposes knowledge + task tools to other coding agents/IDEs), agent/RAG services, and a React frontend, backed by a database with **pgvector/Supabase** for embeddings. It sits *beside* your coding agent and feeds it knowledge + tasks.

## runtime model
Long-running services (Docker), not a per-task CLI agent.

## agent loop shape
N/A — Archon does not run an edit/verify coding loop. It answers knowledge queries and manages task/project state that *another* agent consumes.

## turn/step budgeting
N/A.

## tool system & schemas
MCP tools exposed to clients: knowledge search (RAG), code-example retrieval, and project/task CRUD. This **MCP-server-as-integration-boundary** is the reusable pattern.

## edit format
N/A — not a code editor.

## filesystem access / shell execution / git
N/A (operates on ingested docs + a task DB, not your working tree).

## context management & compaction
Provides *external* context (retrieved knowledge) rather than managing an agent's context window.

## permission model / sandboxing
Service-level (API keys, Supabase auth); N/A for code execution.

## model/provider abstraction
Configurable LLM + embedding providers (OpenAI etc.); local via Ollama possible for embeddings/LLM. UNVERIFIED: exact local support depth.

## config schema
`.env` + docker-compose env; `CLAUDE.md`/`AGENTS.md` present.

## memory/persistence *(high value)*
**This is Archon's core:** a persistent knowledge base (crawled docs, uploaded files, extracted code examples) with vector search, plus **projects/tasks/documents/versions** data model. Informs our §9 (skepticism about vector DBs — Archon justifies one because *knowledge retrieval across external docs* is its whole purpose, unlike our *repo* retrieval) and §10 (long-term memory data model).

## workflow/orchestration *(high value)*
Task/project management with statuses and document versioning — a durable, inspectable task store. Informs our §8 workflow state + §6.2 RunState (take the *concept* of explicit, resumable task state; not the code).

## subagents
N/A (it serves agents; PydanticAI agents internal for RAG. UNVERIFIED depth).

## testing / evals / observability
Service tests; UNVERIFIED.

## CLI/TUI / editor integration
Web UI + MCP; integrates with IDEs/agents via MCP, not as an editor itself.

## extensibility/plugins
MCP is the integration surface.

## security model
Web-service security; runs your keys server-side (a model we reject — we're local-first, §5/§17).

## distribution & install
Docker-compose self-host + Supabase.

## license
MIT.

## strengths
Clean **MCP-server integration boundary**; solid **task/knowledge data model**; good example of *when a vector DB IS justified* (external-doc RAG).

## weaknesses (for our user)
It's a service you host (Docker + Supabase) with keys server-side — antithetical to our local-first, no-server, no-account stance. Not a coding agent.

## reusable ideas
(1) **Task/project/document data model** for durable, resumable work state (§8/§10, concept only); (2) **MCP-server-as-integration-boundary** (§11.2); (3) a concrete example clarifying our vector-DB decision (§9): embeddings earn their place for *external knowledge*, not for *repo code navigation*.

## explicitly do-not-copy
The **hosted, server-side, keys-on-a-backend architecture** (Supabase/Docker services) — we are local-first with no backend (§17). Don't import "vector DB by default" thinking into repo intelligence (§9).
