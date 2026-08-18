import fs from "node:fs";
import path from "node:path";
import { Denylist, PolicyEngine, Redactor } from "@clutchcode/sandbox";
import { nativeToolSet, type Tool } from "@clutchcode/tools";
import { createRunWorktree, type RunWorktree } from "@clutchcode/git";
import { detectToolchain } from "@clutchcode/verification";
import { AgentLoop, createRunState, type RunState, type RuntimeEvent } from "@clutchcode/runtime";
import { FakeProvider } from "@clutchcode/providers";

import type { RecordedTranscript } from "./transcript.js";
import { makeFixtureRepo, makeTempDir } from "./fixture-repo.js";

/**
 * Replay a recorded transcript against FakeProvider and a real (temp)
 * worktree (PROJECT_SPEC.md §16.3c): "runtime logic (state machine,
 * budgets, loop detection, verification, git) is tested with zero tokens
 * and full determinism." Every replay gets a fresh fixture repo, so
 * transcripts are order-independent and safe to run in parallel.
 */
export interface ReplayResult {
  finalState: RunState;
  events: RuntimeEvent[];
  cleanup(): void;
}

export async function replayTranscript(transcript: RecordedTranscript): Promise<ReplayResult> {
  const repoPath = makeFixtureRepo();
  const stateDir = makeTempDir("clutchcode-eval-state-");
  const evidenceDir = makeTempDir("clutchcode-eval-evidence-");

  const run: RunWorktree = createRunWorktree({ repoPath, stateDir, runId: `eval-${transcript.name}`.slice(0, 40), slug: transcript.name });
  const toolchainCommands = detectToolchain(run.worktreePath);

  const tools: Map<string, Tool<unknown, unknown>> = nativeToolSet();
  const toolContext = {
    workspaceRoot: run.worktreePath,
    evidenceDir,
    policy: new PolicyEngine(),
    denylist: new Denylist(),
    redactor: new Redactor(),
    repoTrustMode: "trusted" as const,
    networkAllowlist: [],
    submodulePaths: [],
    lfsPatterns: [],
    sandbox: { backend: "none" as const, reason: "eval replay fixture" }
  };

  const provider = new FakeProvider(transcript.turns);
  const state = createRunState({ runId: run.runId, task: transcript.task, provider: "fake", model: "fake" });

  const events: RuntimeEvent[] = [];
  const loop = new AgentLoop(
    state,
    { provider, tools, toolContext, run, toolchainCommands, evidenceDir },
    { yesMode: transcript.yesMode, onEvent: (e) => events.push(e) }
  );

  const finalState = await loop.run();

  return {
    finalState,
    events,
    cleanup() {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  };
}

export interface ReplayAssertionFailure {
  field: string;
  expected: unknown;
  actual: unknown;
}

/** Checks a replay's final state against `transcript.expected`, without throwing — callers report failures however they like. */
export function checkExpectations(transcript: RecordedTranscript, finalState: RunState): ReplayAssertionFailure[] {
  const failures: ReplayAssertionFailure[] = [];

  if (finalState.status !== transcript.expected.status) {
    failures.push({ field: "status", expected: transcript.expected.status, actual: finalState.status });
  }
  if (
    transcript.expected.repairIterationsAtLeast !== undefined &&
    finalState.repairIterations < transcript.expected.repairIterationsAtLeast
  ) {
    failures.push({ field: "repairIterations", expected: `>= ${transcript.expected.repairIterationsAtLeast}`, actual: finalState.repairIterations });
  }
  if (transcript.expected.escalationReasonMatches) {
    const re = new RegExp(transcript.expected.escalationReasonMatches);
    if (!finalState.escalationReason || !re.test(finalState.escalationReason)) {
      failures.push({ field: "escalationReason", expected: transcript.expected.escalationReasonMatches, actual: finalState.escalationReason });
    }
  }

  return failures;
}

export function fixturesDir(): string {
  return path.join(import.meta.dirname, "..", "fixtures");
}

export function listFixtureFiles(): string[] {
  return fs
    .readdirSync(fixturesDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(fixturesDir(), f));
}
