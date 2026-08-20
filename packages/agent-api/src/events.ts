import fs from "node:fs";
import path from "node:path";
import { assertSafeRunId } from "@clutchcode/git";
import type { RuntimeEvent } from "@clutchcode/runtime";

/**
 * Minimal event log (PROJECT_SPEC.md §15.1): append-only JSONL per run,
 * under the same `<stateDir>/runs/<run_id>/` layout as RunState. This is a
 * deliberately small slice of the full event model (no SQLite index, no
 * `model.request`/`model.response` usage rows beyond what RuntimeEvent
 * already carries) — enough to make `agent inspect` show a real decision
 * trail rather than nothing.
 */

function eventsPath(stateDir: string, runId: string): string {
  // §13.1: same shared choke-point fix as `RunStateStore`/`worktree-store.ts`
  // — `readEvents` is reachable with a caller-supplied `runId` via `agent
  // inspect` / the RPC `inspect` method.
  assertSafeRunId(runId);
  return path.join(stateDir, "runs", runId, "events.jsonl");
}

export function appendEvent(stateDir: string, runId: string, event: RuntimeEvent): void {
  const p = eventsPath(stateDir, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, `${JSON.stringify({ ts: Date.now(), ...event })}\n`, "utf8");
}

export function readEvents(stateDir: string, runId: string): Array<RuntimeEvent & { ts: number }> {
  const p = eventsPath(stateDir, runId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RuntimeEvent & { ts: number });
}
