#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import type { ProviderKind } from "@clutchcode/agent-api";
import {
  cmdApprove,
  cmdCheckpoints,
  cmdDiff,
  cmdDoctor,
  cmdInit,
  cmdInspect,
  cmdMemoryCorrect,
  cmdMemoryForget,
  cmdMemoryList,
  cmdMemoryShow,
  cmdModelsList,
  cmdModelsProbe,
  cmdPr,
  cmdProviders,
  cmdProvidersSetKey,
  cmdProvidersUnsetKey,
  cmdReject,
  cmdResume,
  cmdRollback,
  cmdRun,
  cmdServe,
  cmdStatus,
  cmdTrust,
  type CliContext,
  type CommandResult
} from "./commands.js";
import { EXIT } from "./exit-codes.js";

/**
 * The `clutchcode` CLI (PROJECT_SPEC.md §18.2) — a thin client of
 * @clutchcode/agent-api. Every subcommand's logic lives in commands.ts as a
 * pure, directly-testable function; this file only wires argv → those
 * functions → stdout/exit code.
 */

interface GlobalOpts {
  repo: string;
  json: boolean;
  stateDir?: string;
  modelsDir?: string;
  /** Only actually registered as a CLI flag on the `memory` subcommands (§13.4/§10.3) — `undefined` everywhere else, harmless. */
  scope?: string;
}

function emit(result: CommandResult, json: boolean): never {
  // §18.4: `--json` always prints machine-readable output to stdout,
  // regardless of exit code — scripts/CI need to parse the result of a
  // failed/escalated run just as much as a successful one. Human-readable
  // mode keeps the convention of routing failures to stderr.
  if (json || result.exitCode === 0) {
    console.log(result.output);
  } else {
    console.error(result.output);
  }
  process.exit(result.exitCode);
}

function ctx(opts: GlobalOpts): CliContext {
  return { repoPath: opts.repo, json: opts.json, stateDir: opts.stateDir, modelsDir: opts.modelsDir, scope: opts.scope };
}

interface ModelsGlobalOpts {
  json: boolean;
  modelsDir?: string;
}

// `models *` subcommands are not repo-scoped (§4.9 profiles live under
// ~/.config, keyed by model id, not by repo) — repoPath is unused by them.
function modelsCtx(opts: ModelsGlobalOpts): CliContext {
  return { repoPath: process.cwd(), json: opts.json, modelsDir: opts.modelsDir };
}

// Real bug caught in round 3 of security review: `(v) => parseInt(v, 10)`
// (and `parseFloat`) silently produce `NaN` for a malformed value (e.g. a
// typo like `--max-steps five`), and `definedBudgets`/callers in
// commands.ts only check `!== undefined` — true for `NaN` — so a bad flag
// used to overwrite the real default budget with `NaN`, and every
// `>=`/`>` comparison against `NaN` in `packages/runtime/src/budget.ts` is
// always `false`, silently disabling that budget's enforcement for the
// whole run with no error printed at all. Commander calls a custom parser
// synchronously and turns a thrown `InvalidArgumentError` into a clean
// "error: option '...' argument '...' is invalid" CLI failure instead.
function parseIntArg(v: string): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new InvalidArgumentError(`"${v}" is not a valid integer`);
  return n;
}
function parseFloatArg(v: string): number {
  const n = parseFloat(v);
  if (Number.isNaN(n)) throw new InvalidArgumentError(`"${v}" is not a valid number`);
  return n;
}

const program = new Command();
program.name("clutchcode").description("A model-agnostic, local-first coding-agent runtime.").version("0.1.0");

function baseOptions(cmd: Command): Command {
  return cmd
    .option("--repo <path>", "repository path", process.cwd())
    .option("--json", "machine-readable JSON output", false)
    .option("--state-dir <path>", "override the state directory (default: ~/.local/state/clutchcode)");
}

baseOptions(program.command("init")).action(async (opts: GlobalOpts) => emit(await cmdInit(ctx(opts)), opts.json));

baseOptions(program.command("run"))
  .argument("<task>", "the task description")
  .option("--provider <kind>", "openai-compatible | anthropic | ollama | fake", "fake")
  .option("--model <model>", "model id", "")
  .option("--base-url <url>", "override the provider base URL")
  .option("--yes", "auto-approve when the deterministic gate is green and no cheats are flagged (§14.7)", false)
  .option("--models-dir <path>", "capability-profile storage directory (§4.9, default: ~/.config/clutchcode/models)")
  .option("--max-steps <n>", "override the step budget (§6.3, default: 50)", parseIntArg)
  .option("--max-wallclock-ms <n>", "override the wall-clock budget (default: 20 min)", parseIntArg)
  .option("--max-tokens <n>", "override the token budget (default: 200000)", parseIntArg)
  .option("--cost-ceiling-usd <n>", "override the cost ceiling (overrides agent.toml's policy.costCeilingUsd)", parseFloatArg)
  .option("--scope <path>", "monorepo: pin verification (toolchain + pipeline cwd) to this subdir (§13.4)")
  .option("--workflow <id>", "default | quickfix | review-only (§8.2); default \"default\" if neither this nor --workflow-file is given")
  .option("--workflow-file <path>", "a JSON-Schema-validated custom declarative workflow file (§8.1); mutually exclusive with --workflow")
  .action(
    async (
      task: string,
      opts: GlobalOpts & {
        provider: ProviderKind;
        model: string;
        baseUrl?: string;
        yes: boolean;
        maxSteps?: number;
        maxWallclockMs?: number;
        maxTokens?: number;
        costCeilingUsd?: number;
        scope?: string;
        workflow?: string;
        workflowFile?: string;
      }
    ) =>
      emit(
        await cmdRun(ctx(opts), {
          task,
          providerKind: opts.provider,
          model: opts.model,
          baseUrl: opts.baseUrl,
          yes: opts.yes,
          maxSteps: opts.maxSteps,
          maxWallclockMs: opts.maxWallclockMs,
          maxTokens: opts.maxTokens,
          costCeilingUsd: opts.costCeilingUsd,
          scope: opts.scope,
          workflowId: opts.workflow,
          workflowFile: opts.workflowFile
        }),
        opts.json
      )
  );

baseOptions(program.command("status")).action(async (opts: GlobalOpts) => emit(await cmdStatus(ctx(opts)), opts.json));

baseOptions(program.command("diff"))
  .argument("<runId>")
  .action(async (runId: string, opts: GlobalOpts) => emit(await cmdDiff(ctx(opts), runId), opts.json));

baseOptions(program.command("approve"))
  .argument("<runId>")
  // Real bug caught in round 3 of security review: a plain `--squash`
  // boolean flag defaulting to `true`, with no `--no-squash` counterpart,
  // meant `ApproveOptions.squash === false` (a real, meaningfully
  // different `git merge --no-ff` code path in `approveRun`, preserving
  // full checkpoint history instead of collapsing it) could never
  // actually be reached from the CLI — commander errors on an unknown
  // `--no-squash` flag. `--no-squash` here auto-negates the boolean
  // (commander's documented convention for a `--no-<x>` pairing).
  .option("--no-squash", "keep the run's checkpoint commits separate instead of squashing them into one")
  .option("--message <msg>", "commit message")
  .action(async (runId: string, opts: GlobalOpts & { squash: boolean; message?: string }) =>
    emit(await cmdApprove(ctx(opts), runId, { squash: opts.squash, message: opts.message }), opts.json)
  );

// `commit` is an alias for `approve` (§13.5 — finalize the reviewed diff).
baseOptions(program.command("commit"))
  .argument("<runId>")
  // Real bug caught in round 3 of security review: a plain `--squash`
  // boolean flag defaulting to `true`, with no `--no-squash` counterpart,
  // meant `ApproveOptions.squash === false` (a real, meaningfully
  // different `git merge --no-ff` code path in `approveRun`, preserving
  // full checkpoint history instead of collapsing it) could never
  // actually be reached from the CLI — commander errors on an unknown
  // `--no-squash` flag. `--no-squash` here auto-negates the boolean
  // (commander's documented convention for a `--no-<x>` pairing).
  .option("--no-squash", "keep the run's checkpoint commits separate instead of squashing them into one")
  .option("--message <msg>", "commit message")
  .action(async (runId: string, opts: GlobalOpts & { squash: boolean; message?: string }) =>
    emit(await cmdApprove(ctx(opts), runId, { squash: opts.squash, message: opts.message }), opts.json)
  );

baseOptions(program.command("reject"))
  .argument("<runId>")
  .action(async (runId: string, opts: GlobalOpts) => emit(await cmdReject(ctx(opts), runId), opts.json));

baseOptions(program.command("inspect"))
  .argument("<runId>")
  .action(async (runId: string, opts: GlobalOpts) => emit(await cmdInspect(ctx(opts), runId), opts.json));

baseOptions(program.command("resume"))
  .argument("<runId>")
  .option("--extend-steps <n>", "raise the step budget by this many steps before continuing (§6.3)", parseIntArg)
  .option("--extend-wallclock-ms <n>", "raise the wall-clock budget by this many ms before continuing", parseIntArg)
  .option("--extend-tokens <n>", "raise the token budget by this many tokens before continuing", parseIntArg)
  .option("--extend-cost-usd <n>", "raise the cost ceiling by this much before continuing", parseFloatArg)
  // No default here (unlike `run`'s --yes): leaving it unset lets `Agent.resume`
  // fall back to the run's own persisted --yes instead of silently forcing false.
  .option("--yes", "override the run's original --yes setting for this resume")
  .option("--models-dir <path>", "capability-profile storage directory (§4.9, default: ~/.config/clutchcode/models)")
  .action(
    async (
      runId: string,
      opts: GlobalOpts & { extendSteps?: number; extendWallclockMs?: number; extendTokens?: number; extendCostUsd?: number; yes?: boolean }
    ) =>
      emit(
        await cmdResume(ctx(opts), runId, {
          extendSteps: opts.extendSteps,
          extendWallclockMs: opts.extendWallclockMs,
          extendTokens: opts.extendTokens,
          extendCostUsd: opts.extendCostUsd,
          yes: opts.yes
        }),
        opts.json
      )
  );

baseOptions(program.command("checkpoints"))
  .argument("<runId>")
  .action(async (runId: string, opts: GlobalOpts) => emit(await cmdCheckpoints(ctx(opts), runId), opts.json));

baseOptions(program.command("rollback"))
  .argument("<runId>")
  .argument("<sha>", "a checkpoint sha (or prefix) from `agent checkpoints <runId>`")
  .action(async (runId: string, sha: string, opts: GlobalOpts) => emit(await cmdRollback(ctx(opts), runId, sha), opts.json));

baseOptions(program.command("pr"))
  .argument("<runId>")
  .option("--remote <name>", "git remote to push to", "origin")
  .option("--base <branch>", "PR base branch (default: the branch checked out when the run started)")
  .action(async (runId: string, opts: GlobalOpts & { remote: string; base?: string }) =>
    emit(await cmdPr(ctx(opts), runId, { remote: opts.remote, base: opts.base }), opts.json)
  );

baseOptions(program.command("trust")).action(async (opts: GlobalOpts) => emit(await cmdTrust(ctx(opts)), opts.json));

const providers = baseOptions(program.command("providers"));
providers.action(async (opts: GlobalOpts) => emit(await cmdProviders(ctx(opts)), opts.json));

baseOptions(providers.command("set-key"))
  .description("store an API key in the OS keychain (§5.1) — reads the value from stdin, never argv/history")
  .argument("<provider>", "anthropic | openai-compatible")
  .action(async (provider: string, opts: GlobalOpts) => emit(await cmdProvidersSetKey(ctx(opts), provider, process.stdin), opts.json));

baseOptions(providers.command("unset-key"))
  .description("remove an API key from the OS keychain (§5.1)")
  .argument("<provider>", "anthropic | openai-compatible")
  .action(async (provider: string, opts: GlobalOpts) => emit(await cmdProvidersUnsetKey(ctx(opts), provider), opts.json));

const SCOPE_OPTION = ["--scope <path>", "monorepo: the same subdir a scoped run used (`agent run --scope`, §13.4) — memory is cached per-scope, not just per-repo"] as const;

const memory = baseOptions(program.command("memory")).option(...SCOPE_OPTION);
memory.description("project memory (§10.3) — machine-derived toolchain facts, with provenance and correction");
memory.action(async (opts: GlobalOpts) => emit(await cmdMemoryList(ctx(opts)), opts.json));

baseOptions(memory.command("list"))
  .option(...SCOPE_OPTION)
  .action(async (opts: GlobalOpts) => emit(await cmdMemoryList(ctx(opts)), opts.json));

baseOptions(memory.command("show"))
  .description("show one remembered fact's full detail (value, provenance, staleness)")
  .argument("<key>", "language | packageManager | build | test | lint | typecheck")
  .option(...SCOPE_OPTION)
  .action(async (key: string, opts: GlobalOpts) => emit(await cmdMemoryShow(ctx(opts), key), opts.json));

baseOptions(memory.command("forget"))
  .description("remove a remembered fact — the next run re-derives it")
  .argument("<key>", "language | packageManager | build | test | lint | typecheck")
  .option(...SCOPE_OPTION)
  .action(async (key: string, opts: GlobalOpts) => emit(await cmdMemoryForget(ctx(opts), key), opts.json));

baseOptions(memory.command("correct"))
  .description("directly overwrite a remembered fact (§10.3 point 5 — human edits win)")
  .argument("<key>", "language | packageManager | build | test | lint | typecheck")
  .argument("<value>", "the corrected command/value")
  .option(...SCOPE_OPTION)
  .action(async (key: string, value: string, opts: GlobalOpts) => emit(await cmdMemoryCorrect(ctx(opts), key, value), opts.json));

baseOptions(program.command("doctor")).action(async (opts: GlobalOpts) => emit(await cmdDoctor(ctx(opts)), opts.json));

baseOptions(program.command("serve"))
  .description("speak the Agent API over stdio JSON-RPC (§18.1/§18.5) — for editor clients (VS Code today), not interactive use")
  .action((opts: GlobalOpts) => {
    // Long-running, not a one-shot `emit()` command: stays alive for as
    // long as the client (a spawned child process's parent, e.g. the VS
    // Code extension host) keeps stdin open, and exits cleanly the moment
    // it doesn't — never left orphaned if the editor closes without
    // saying goodbye.
    const handle = cmdServe(ctx(opts), process.stdin, process.stdout);
    process.stdin.resume();
    const shutdown = (): void => {
      handle.close();
      process.exit(EXIT.SUCCESS);
    };
    process.stdin.on("end", shutdown);
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

const models = program.command("models").description("model capability profiles (§4.9)");

models
  .command("probe")
  .description("run (or reuse) the capability probe for a model and persist its profile")
  .argument("<model>", "model id to probe")
  .option("--provider <kind>", "openai-compatible | anthropic | ollama", "ollama")
  .option("--base-url <url>", "override the provider base URL")
  .option("--force", "re-run the probe even if a cached profile exists", false)
  .option("--trials <n>", "trials per scored check", parseIntArg, 3)
  .option("--json", "machine-readable JSON output", false)
  .option("--models-dir <path>", "override the profile storage directory (default: ~/.config/clutchcode/models)")
  .action(
    async (
      model: string,
      opts: ModelsGlobalOpts & { provider: ProviderKind; baseUrl?: string; force: boolean; trials: number }
    ) =>
      emit(
        await cmdModelsProbe(modelsCtx(opts), {
          model,
          providerKind: opts.provider,
          baseUrl: opts.baseUrl,
          force: opts.force,
          trials: opts.trials
        }),
        opts.json
      )
  );

models
  .command("list")
  .description("list every previously-probed model's capability profile")
  .option("--json", "machine-readable JSON output", false)
  .option("--models-dir <path>", "override the profile storage directory (default: ~/.config/clutchcode/models)")
  .action(async (opts: ModelsGlobalOpts) => emit(await cmdModelsList(modelsCtx(opts)), opts.json));

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(4);
});
