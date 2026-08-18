# ClutchCode for VS Code

A companion to the `clutchcode` CLI (PROJECT_SPEC.md §18.5): run a task,
watch it stream live, review the diff, and approve or reject — from the
editor, backed by the exact same runtime as the terminal.

## How it's built

Per §18.1's "key architectural move," this extension does **not**
reimplement any agent logic. It spawns `clutchcode serve` (the Agent
API's stdio JSON-RPC binding, `@clutchcode/agent-rpc`) as a child process
and talks to it — the same boundary a future Zed or Neovim client would
use. `src/connection.ts` and `src/runTask.ts` hold all of the actual
orchestration logic and have no `vscode` import at all; `src/extension.ts`
is deliberately thin glue wiring that logic to real `vscode.window`/
`vscode.commands` calls.

## Status

The RPC layer, the spawn-and-connect logic, and the run→diff→approve/
reject orchestration are all tested against a **real** compiled
`clutchcode` binary and a **real** `Agent` (see `*.test.ts` next to each
source file) — everything up to the boundary of the `vscode` module
itself. `extension.ts` is written carefully against the documented,
long-stable extension API and type-checks cleanly against `@types/vscode`,
but has **not** run inside an actual VS Code extension host — there is no
`vscode` runtime available in the environment this was built in. If
you're picking this up to verify it for real:

```sh
pnpm --filter @clutchcode/cli build
pnpm --filter clutchcode-vscode build
```

then open this directory in VS Code and press F5 (Run Extension) to
launch an Extension Development Host, or `vsce package` it for a local
install. `clutchcode.cliPath` (default: `clutchcode`, resolved on PATH)
must point at a built `clutchcode` binary.

## Commands

| Command | What it does |
|---|---|
| `ClutchCode: Run Task` | Prompts for a task, runs it, streams progress to the "ClutchCode" output channel, opens the diff and prompts approve/reject once verification is green. |
| `ClutchCode: Show Diff for Run` | Opens a given run's diff in a read-only editor tab. |
| `ClutchCode: Approve Run` | Approves and commits a run awaiting review. |
| `ClutchCode: Reject Run` | Discards a run's changes. |

## Settings

- `clutchcode.providerKind` — `openai-compatible` \| `anthropic` \| `ollama` \| `fake` (default: `ollama`)
- `clutchcode.model` — model id
- `clutchcode.baseUrl` — override the provider base URL
- `clutchcode.cliPath` — path to the `clutchcode` binary (default: `clutchcode`, resolved on PATH)

## Not yet built

A native two-sided VS Code diff view (currently a single read-only
document with `diff` syntax highlighting, not `vscode.diff`'s side-by-side
compare — that needs per-file before/after content, not just the unified
diff text `agent diff` already returns); a run-picker instead of typing a
run id; resume/rollback/pr commands (the CLI has them; the extension
surface here covers the core run/diff/approve/reject loop named in
§18.5's UX list).
