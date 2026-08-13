import fs from "node:fs";
import type { RunStatus } from "@clutchcode/runtime";
import type { ScriptedTurn } from "@clutchcode/providers";

/**
 * A recorded transcript (PROJECT_SPEC.md §16.3c): a scripted sequence of
 * model turns plus the expected run outcome. `ScriptedTurn` (from
 * FakeProvider) is already plain, JSON-serializable data — so a recorded
 * transcript IS just JSON, no separate wire format needed.
 */
export interface RecordedTranscript {
  name: string;
  description: string;
  task: string;
  yesMode: boolean;
  turns: ScriptedTurn[];
  expected: {
    status: RunStatus;
    repairIterationsAtLeast?: number;
    escalationReasonMatches?: string; // a RegExp source, checked with `new RegExp(...)`
  };
}

export function loadTranscript(filePath: string): RecordedTranscript {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as RecordedTranscript;
}
