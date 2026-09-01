import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { Agent, markTrusted, type Budgets, type ProviderKind, type RunState } from "@clutchcode/agent-api";

import { materializeTaskRepo, runOracle, type EvalTask } from "./eval-task.js";
import { makeTempDir } from "./fixture-repo.js";
import { computeScoreboard, summarizeRun, type EvalTaskResult, type Scoreboard } from "./scoreboard.js";

/**
 * The eval runner behind the per-model scoreboard (PROJECT_SPEC.md §16.3b).
 *
 * It drives the **real public Agent API** (`Agent.run`) — the same entry
 * point `clutchcode run` uses — not `AgentLoop` directly, so a scoreboard
 * measures the product as a user actually gets it: worktree isolation,
 * toolchain detection and project memory, the adaptation layer, the
 * deterministic gate, cheat detection, and the §14.7 auto-approve path all
 * participate. Pointing it at a scripted local OpenAI-compatible server is
 * what makes the harness's own tests deterministic and token-free without
 * mocking anything below the model boundary (§2, ADR-020).
 *
 * Grading is deliberately **not** the agent's own verdict. After the run
 * ends, the task's held-out oracle is copied into the delivered repository
 * and executed there (see `eval-task.ts`), so "solved" means the delivered
 * result passes a check the model never saw.
 */

/** Bounded by default: a benchmark must not hang on one bad model. */
export const DEFAULT_EVAL_BUDGETS: Partial<Budgets> = {
  steps: 40,
  wallclockMs: 10 * 60_000
};

export interface RunEvalOptions {
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  /** Parent directory for each task's scratch repo + state dir. A fresh temp dir by default. */
  workDir?: string;
  budgets?: Partial<Budgets>;
  /** Keep each task's scratch directory after the run — for debugging a failure by hand. */
  keepWorkDir?: boolean;
  onTaskStart?: (task: EvalTask) => void;
  onTaskResult?: (result: EvalTaskResult) => void;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

/**
 * §12.4: eval repos are marked trusted, because that is the condition the
 * benchmark is meant to measure — a developer running the agent on their
 * own repository. Untrusted mode turns every first-use EXECUTE into an ASK
 * (§12.2), which in a non-interactive benchmark would score the approval
 * policy rather than the agent.
 *
 * `agent.toml` is committed straight away, on purpose: `handleDirtyTree`
 * stashes an uncommitted working tree before a run starts, so a config
 * written but not committed would be stashed away and the repo would be
 * back to untrusted by the time the run reads it.
 */
function trustAndCommit(repoPath: string): void {
  markTrusted(repoPath);
  git(repoPath, ["add", "agent.toml"]);
  git(repoPath, ["commit", "-q", "-m", "eval harness: trust this fixture repo (§12.4)"]);
}

export interface RunEvalTaskResult {
  result: EvalTaskResult;
  /** Where the task ran — present only when `keepWorkDir` was set. */
  workDir?: string;
}

export async function runEvalTask(task: EvalTask, opts: RunEvalOptions): Promise<RunEvalTaskResult> {
  const parent = opts.workDir ?? makeTempDir("clutchcode-eval-run-");
  const taskDir = path.join(parent, task.id);
  const repoPath = path.join(taskDir, "repo");
  const stateDir = path.join(taskDir, "state");

  const cleanup = (): void => {
    if (!opts.keepWorkDir) fs.rmSync(taskDir, { recursive: true, force: true });
  };

  const startedAt = Date.now();
  try {
    materializeTaskRepo(task, repoPath);
    trustAndCommit(repoPath);

    const agent = new Agent(repoPath, stateDir);
    let state: RunState;
    let harnessError: string | undefined;
    try {
      state = await agent.run({
        task: task.prompt,
        providerKind: opts.providerKind,
        model: opts.model,
        baseUrl: opts.baseUrl,
        // §14.7: a benchmark has no human at the keyboard, so the run
        // auto-approves *only* on the same terms `--yes` gives a user —
        // green gate plus zero cheat flags. Nothing else is relaxed.
        yesMode: true,
        budgets: { ...DEFAULT_EVAL_BUDGETS, ...opts.budgets },
        // Keep the probe/profile lookup and project memory inside this
        // task's scratch directory: an eval must not read or write the
        // machine's real ~/.config state, or one task's run would leak
        // into the next one's.
        modelsDir: path.join(taskDir, "models"),
        memoryDir: path.join(taskDir, "memory")
      });
    } catch (err) {
      // A run that throws is a harness/environment failure, not a task
      // failure — it is still scored as unsolved (nothing was delivered),
      // but the error is carried through to the board rather than
      // disappearing into a bare "not verified".
      harnessError = (err as Error).message;
      const oracle = runOracle(task, repoPath);
      const result: EvalTaskResult = {
        taskId: task.id,
        category: task.category,
        language: task.language,
        runId: "",
        status: "FAILED",
        gateGreen: false,
        cheatFlags: 0,
        claimedDone: false,
        oraclePassed: oracle.passed,
        verified: false,
        editAttempts: 0,
        editsApplied: 0,
        neededHuman: false,
        readAnySolutionPath: false,
        tokens: 0,
        costUsd: 0,
        wallclockMs: Date.now() - startedAt,
        steps: 0,
        repairIterations: 0,
        oracleExitCode: oracle.exitCode,
        error: harnessError
      };
      opts.onTaskResult?.(result);
      return { result, workDir: opts.keepWorkDir ? taskDir : undefined };
    }

    const oracle = runOracle(task, repoPath);
    const result = summarizeRun({ task, state, oracle, wallclockMs: Date.now() - startedAt });
    opts.onTaskResult?.(result);
    return { result, workDir: opts.keepWorkDir ? taskDir : undefined };
  } finally {
    cleanup();
  }
}

export interface RunSuiteOptions extends RunEvalOptions {
  /** Label recorded on the board — the suite directory by default. */
  suiteLabel?: string;
}

/** Run every task in order and aggregate the §16.1/§16.2 board. Tasks run sequentially: they compete for the same CPU, and a wall-clock metric measured under contention is not a measurement. */
export async function runSuite(tasks: EvalTask[], opts: RunSuiteOptions): Promise<Scoreboard> {
  if (tasks.length === 0) throw new Error("cannot run an empty eval suite");
  const results: EvalTaskResult[] = [];
  for (const task of tasks) {
    opts.onTaskStart?.(task);
    const { result } = await runEvalTask(task, opts);
    results.push(result);
  }
  return computeScoreboard(
    { suite: opts.suiteLabel ?? path.dirname(tasks[0]!.dir), provider: opts.providerKind, model: opts.model },
    results
  );
}
