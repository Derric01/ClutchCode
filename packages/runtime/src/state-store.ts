import fs from "node:fs";
import path from "node:path";
import type { RunState } from "./run-state.js";

/**
 * RunState persistence (PROJECT_SPEC.md §6.2, §15, §19.2).
 *
 * The spec's target storage is SQLite + JSONL (§15.1, §19.2). This MVP
 * implementation persists RunState as JSON under
 * `<stateDir>/runs/<run_id>/state.json` — the same directory layout the
 * spec names for session storage (§10) — deliberately avoiding a native
 * SQLite dependency for Phase 1. It is a drop-in-replaceable interface
 * (`RunStateStore`); swapping the body for SQLite later does not change
 * any caller.
 *
 * `resume` reloads RunState and continues from the last committed state
 * (§6.2) — because every transition is persisted immediately, a crash or
 * Ctrl-C loses at most the in-flight step.
 */
export class RunStateStore {
  constructor(private readonly stateDir: string) {}

  private runDir(runId: string): string {
    return path.join(this.stateDir, "runs", runId);
  }

  private statePath(runId: string): string {
    return path.join(this.runDir(runId), "state.json");
  }

  save(state: RunState): void {
    fs.mkdirSync(this.runDir(state.runId), { recursive: true });
    // Atomic-ish write: write to a temp file then rename, so a crash
    // mid-write can't leave a half-written state.json behind.
    const tmp = `${this.statePath(state.runId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, this.statePath(state.runId));
  }

  load(runId: string): RunState | null {
    const p = this.statePath(runId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as RunState;
  }

  list(): string[] {
    const runsDir = path.join(this.stateDir, "runs");
    if (!fs.existsSync(runsDir)) return [];
    return fs.readdirSync(runsDir).filter((d) => fs.existsSync(path.join(runsDir, d, "state.json")));
  }

  delete(runId: string): void {
    fs.rmSync(this.runDir(runId), { recursive: true, force: true });
  }
}
