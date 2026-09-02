import path from "node:path";

import { Command, InvalidArgumentError } from "commander";
import type { ProviderKind } from "@clutchcode/agent-api";

import { defaultSuiteDir, loadSuite, type EvalTask } from "./eval-task.js";
import { runSuite } from "./eval-runner.js";
import { formatScoreboard } from "./scoreboard.js";
import { saveScoreboard, readScoreboardHistory } from "./scoreboard-store.js";

/**
 * `clutchcode-eval` — the command that runs the suite and prints the
 * scoreboard (PROJECT_SPEC.md §16.3b).
 *
 * It lives here rather than in `apps/cli` on purpose. §20 puts "eval suite,
 * scoreboard, recorded-transcript replay harness" in `evals/`, and its
 * dependency rule — "`apps/*` depend only on `agent-api`" — is normative:
 * an `agent eval` subcommand would make `apps/cli` depend on this package,
 * which is a boundary decision, not an implementation detail. So the
 * scoreboard ships with its own bin, and wiring §18.2's `agent eval` on top
 * of it stays a separate, explicitly-scoped decision.
 */

function parseIntArg(v: string): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new InvalidArgumentError(`"${v}" is not a valid integer`);
  return n;
}

interface RunOpts {
  suite: string;
  task: string[];
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  out?: string;
  json: boolean;
  maxSteps?: number;
  keepWorkdir: boolean;
}

/** Narrow a suite to the `--task` ids the caller asked for, failing loudly on an id that isn't in it. */
export function selectTasks(all: EvalTask[], ids: string[]): EvalTask[] {
  if (ids.length === 0) return all;
  const byId = new Map(all.map((t) => [t.id, t]));
  return ids.map((id) => {
    const task = byId.get(id);
    if (!task) {
      throw new Error(`no such eval task: "${id}" (available: ${all.map((t) => t.id).join(", ")})`);
    }
    return task;
  });
}

export function buildEvalProgram(): Command {
  const program = new Command();
  program.name("clutchcode-eval").description("Run the ClutchCode eval suite and print the per-model scoreboard (§16).").version("0.1.0");

  program
    .command("list")
    .description("list the tasks in a suite without running anything")
    .option("--suite <dir>", "suite directory", defaultSuiteDir())
    .option("--json", "machine-readable JSON output", false)
    .action((opts: { suite: string; json: boolean }) => {
      const tasks = loadSuite(path.resolve(opts.suite));
      if (opts.json) {
        console.log(JSON.stringify(tasks.map((t) => ({ id: t.id, category: t.category, language: t.language, description: t.description })), null, 2));
        return;
      }
      for (const t of tasks) console.log(`${t.id}  [${t.category}/${t.language}]  ${t.description}`);
    });

  program
    .command("run")
    .description("run the suite against a provider/model and print the scoreboard")
    .option("--suite <dir>", "suite directory", defaultSuiteDir())
    .option("--task <id>", "run only this task (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option("--provider <kind>", "openai-compatible | anthropic | ollama | fake", "ollama")
    .option("--model <model>", "model id", "")
    .option("--base-url <url>", "override the provider base URL")
    .option("--out <dir>", "write the scoreboard JSON + append to the JSONL history here")
    .option("--json", "machine-readable JSON output", false)
    .option("--max-steps <n>", "override the per-task step budget (default: 40)", parseIntArg)
    .option("--keep-workdir", "keep each task's scratch repo for debugging", false)
    .action(async (opts: RunOpts) => {
      const suiteDir = path.resolve(opts.suite);
      const tasks = selectTasks(loadSuite(suiteDir), opts.task);

      const board = await runSuite(tasks, {
        providerKind: opts.provider,
        model: opts.model,
        baseUrl: opts.baseUrl,
        suiteLabel: suiteDir,
        keepWorkDir: opts.keepWorkdir,
        budgets: opts.maxSteps === undefined ? undefined : { steps: opts.maxSteps },
        onTaskStart: (task) => {
          if (!opts.json) console.error(`running ${task.id} …`);
        }
      });

      if (opts.out) {
        const saved = saveScoreboard(path.resolve(opts.out), board);
        if (!opts.json) console.error(`wrote ${saved.jsonPath}`);
      }

      console.log(opts.json ? JSON.stringify(board, null, 2) : formatScoreboard(board));
    });

  program
    .command("history")
    .description("print the append-only scoreboard history written by `run --out`")
    .argument("<dir>", "the directory `run --out` wrote to")
    .option("--json", "machine-readable JSON output", false)
    .action((dir: string, opts: { json: boolean }) => {
      const rows = readScoreboardHistory(path.resolve(dir));
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      for (const row of rows) {
        console.log(
          `${row.generatedAt}  ${row.provider}/${row.model || "-"}  VTCR ${(row.vtcr * 100).toFixed(1)}%  (${row.solvedCount}/${row.taskCount})  false-completions ${(row.falseCompletionRate * 100).toFixed(1)}%`
        );
      }
    });

  return program;
}
