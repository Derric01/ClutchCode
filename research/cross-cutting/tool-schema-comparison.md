# Cross-cutting: Tool-schema comparison

Synthesized from repo notes. Feeds PROJECT_SPEC §11 and §4.8.

## How each project exposes tools to the model

| Project | Tool transport | Extension boundary | Notable |
|---|---|---|---|
| Aider | implicit (edit application + confirmed shell) | model-settings | not function-calling-centric |
| Codex | native tool calls incl. `apply_patch`, sandboxed exec | **MCP** (client+server) + app-server JSON-RPC | verify-args-before-apply |
| OpenHands | **typed Action/Observation** (ACI) | agenthub + MCP | strong typed interface |
| Cline/Roo/Kilo | **XML text tags** (`<read_file>`, `<execute_command>`…) parsed from output | **MCP** | best **non-native-tool-calling** reference |
| Goose | tools via **MCP extensions** (first-class) | **MCP-centric** | cleanest extension model |
| smolagents | **code-as-action** (model writes Python) | tool registry | powerful, hard to constrain on weak models |
| SWE-agent | bundled shell commands + LSP-like helpers (YAML-defined) | config | ACI thesis: interface design > model |
| **ClutchCode** | **capability-adaptive**: native tools / JSON / **text-protocol emulation** (§4.8) | **small native core + MCP** (untrusted boundary, §11.2) | typed results, truncation-first (§11.3) |

## Native vs MCP vs plugin vs subprocess (→ §11.2)

| Mechanism | Role | Trust |
|---|---|---|
| Native core | small fast tested set | first-party |
| MCP | third-party extension boundary | **untrusted (arbitrary code + injection vector)** |
| In-process plugin | vetted extension | trusted-ish |
| Subprocess tool | language-agnostic escape hatch | sandboxed like shell |

**Convergence:** almost everyone uses **MCP** for third-party tools; the Cline family standardized on **XML text tools** for non-native-tool-calling models. Both directly inform us.

## Tool-call emulation (the local-model lever, → §4.8)
Cline proves a **strict text protocol + robust streaming parser** drives models without native function-calling. We extend it with **constrained decoding (GBNF/JSON-schema)** to *enforce* the grammar at decode time — near-eliminating parse failures on 7B/14B models. Retry-with-repair-prompt on parse failure; simplify tool set, then escalate.

## Output truncation is first-class (→ §11.3)
Under-addressed in most references: a 50k-line log destroys context. Our policy truncates **at ingestion** (failures kept, middle dropped, full output to an evidence ref the model can window). SWE-agent's windowed file viewer is the ACI precedent.

## Reusable / do-not-copy
- **Reusable:** MCP-as-boundary (Goose/Codex), XML text protocol (Cline), typed Action/Observation (OpenHands), ACI tool ergonomics (SWE-agent).
- **Do-not-copy:** treating MCP output as trusted (it's an injection vector, §12.1); code-as-action as the default for weak local models (we default to structured edits, §4.4).
