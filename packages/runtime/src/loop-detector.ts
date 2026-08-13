import crypto from "node:crypto";

/**
 * Loop & thrash detection (PROJECT_SPEC.md §6.4). Deterministic and
 * model-stubbable — tested via scripted adversarial transcripts (§16.3),
 * not by asking the model whether it's stuck.
 *
 * | Pathology | Detection | Recovery |
 * | Repeated identical tool call | hash of (tool,args) seen N times | inject "already tried"; escalate at cap |
 * | Oscillating edits (A→B→A) | edit-target + content cycle detection | freeze file; escalate on repeat |
 * | No-progress | diff-stat + verification-state unchanged over K steps | force re-plan; then escalate |
 * | "Almost done" stall | verify-fail count ≥ cap | escalate with the failing check |
 */

export interface LoopDetectorState {
  toolCallCounts: Record<string, number>;
  editHistoryByFile: Record<string, string[]>;
  progressHistory: string[];
  verifyFailStreak: number;
}

export function initLoopDetectorState(): LoopDetectorState {
  return { toolCallCounts: {}, editHistoryByFile: {}, progressHistory: [], verifyFailStreak: 0 };
}

const REPEATED_CALL_WARN_AT = 2;
const REPEATED_CALL_ESCALATE_AT = 4;
const OSCILLATION_HISTORY = 4;
const OSCILLATION_ESCALATE_AT = 2;
const NO_PROGRESS_WINDOW = 5;
const VERIFY_FAIL_ESCALATE_AT = 3;

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

function hashToolCall(tool: string, args: unknown): string {
  // A cryptographic hash, not the raw stringified args, is the map key —
  // args can legitimately contain a secret (e.g. a shell command the model
  // wrote), and this key is persisted verbatim as part of RunState (§5.2:
  // it must never carry unredacted content).
  const digest = crypto.createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 16);
  return `${tool}:${digest}`;
}

function countOscillations(history: string[]): number {
  let count = 0;
  for (let i = 2; i < history.length; i++) {
    if (history[i] === history[i - 2] && history[i] !== history[i - 1]) count++;
  }
  return count;
}

export type LoopWarning =
  | { kind: "repeated-call"; count: number; escalate: boolean }
  | { kind: "oscillating-edit"; file: string; escalate: boolean }
  | { kind: "no-progress"; escalate: boolean }
  | { kind: "almost-done-stall"; escalate: boolean };

export class LoopDetector {
  constructor(private readonly state: LoopDetectorState = initLoopDetectorState()) {}

  getState(): LoopDetectorState {
    return this.state;
  }

  /** Repeated identical tool call. */
  recordToolCall(tool: string, args: unknown): LoopWarning | null {
    const key = hashToolCall(tool, args);
    const count = (this.state.toolCallCounts[key] ?? 0) + 1;
    this.state.toolCallCounts[key] = count;
    if (count >= REPEATED_CALL_ESCALATE_AT) return { kind: "repeated-call", count, escalate: true };
    if (count >= REPEATED_CALL_WARN_AT) return { kind: "repeated-call", count, escalate: false };
    return null;
  }

  /** Oscillating edits (A→B→A) on a single file. */
  recordEdit(file: string, contentHash: string): LoopWarning | null {
    const history = this.state.editHistoryByFile[file] ?? [];
    history.push(contentHash);
    if (history.length > OSCILLATION_HISTORY) history.shift();
    this.state.editHistoryByFile[file] = history;

    if (history.length >= 3 && history[history.length - 1] === history[history.length - 3]) {
      const oscillations = countOscillations(history);
      return { kind: "oscillating-edit", file, escalate: oscillations >= OSCILLATION_ESCALATE_AT };
    }
    return null;
  }

  /** No file/verification-state change over a window of steps. */
  recordProgress(diffStat: string): LoopWarning | null {
    this.state.progressHistory.push(diffStat);
    if (this.state.progressHistory.length > NO_PROGRESS_WINDOW) this.state.progressHistory.shift();

    if (
      this.state.progressHistory.length === NO_PROGRESS_WINDOW &&
      this.state.progressHistory.every((s) => s === this.state.progressHistory[0])
    ) {
      return { kind: "no-progress", escalate: true };
    }
    return null;
  }

  /** "Almost done" stall: the model claims done but verification keeps failing. */
  recordVerifyResult(passed: boolean): LoopWarning | null {
    if (passed) {
      this.state.verifyFailStreak = 0;
      return null;
    }
    this.state.verifyFailStreak += 1;
    if (this.state.verifyFailStreak >= VERIFY_FAIL_ESCALATE_AT) {
      return { kind: "almost-done-stall", escalate: true };
    }
    return null;
  }
}
