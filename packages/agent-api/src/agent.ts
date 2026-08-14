import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { Denylist, PolicyEngine, Redactor } from "@clutchcode/sandbox";
import { nativeToolSet, type Tool, type ToolContext } from "@clutchcode/tools";
import { createRunWorktree, diffAgainstBase, type RunWorktree } from "@clutchcode/git";
import { applyAgentsMdOverrides, detectToolchain, type ToolchainCommands } from "@clutchcode/verification";
import { defaultModelsDir, loadCapabilityProfile, resolveCapability, type EffectiveCapability } from "@clutchcode/capability";
import type { Provider } from "@clutchcode/providers";
import {
  AgentLoop,
  RunStateStore,
  commitApprovedRun,
  createRunState,
  rejectRun,
  type Budgets,
  type RunState,
  type RuntimeEvent
} from "@clutchcode/runtime";

import { loadConfig, isTrustedRepo, type AgentConfig } from "./config.js";
import { loadCredentialsFromEnv, type Credentials } from "./credentials.js";
import { buildProvider, type ProviderKind } from "./provider-factory.js";
import { appendEvent, readEvents } from "./events.js";
import { loadRunWorktree, saveRunWorktree } from "./worktree-store.js";

export interface RunOptions {
  task: string;
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  yesMode?: boolean;
  runId?: string;
  /** Capability-profile storage directory (§4.9); default: ~/.config/clutchcode/models — same default `agent models probe` writes to. */
  modelsDir?: string;
  /** Overrides the default budgets (§6.3) for this run; unset fields keep the config/default value. `agent.toml`'s `policy.costCeilingUsd` still applies unless overridden here. */
  budgets?: Partial<Budgets>;
  onEvent?: (event: RuntimeEvent) => void;
}

export interface ResumeOptions {
  /**
   * §6.3's documented UX for a budget-paused run: "Pause → summarize → ask
   * to extend/stop." These add to (never replace) the run's existing
   * budget — omit a field to leave that ceiling as-is. Resuming a run
   * without extending whichever budget it paused on is not an error, just
   * a no-op: `AgentLoop.resume()` will immediately re-pause on the same
   * check that stopped it last time.
   */
  extendSteps?: number;
  extendWallclockMs?: number;
  extendTokens?: number;
  extendCostUsd?: number;
  /** Overrides the run's original `--yes` setting for this resume only; defaults to whatever the run was started with. */
  yesMode?: boolean;
  modelsDir?: string;
  onEvent?: (event: RuntimeEvent) => void;
}

export interface ApproveOptions {
  squash?: boolean;
  message?: string;
}

function defaultStateDir(): string {
  return path.join(os.homedir(), ".local", "state", "clutchcode");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

function newRunId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

interface RunDeps {
  provider: Provider;
  tools: Map<string, Tool<unknown, unknown>>;
  toolContext: ToolContext;
  toolchainCommands: ToolchainCommands;
  evidenceDir: string;
  capability: EffectiveCapability;
  credentials: Credentials;
  config: AgentConfig;
}

/**
 * The Agent API boundary (PROJECT_SPEC.md §18.1, §20, ADR-011): the one
 * surface `apps/*` are allowed to depend on. This ships the in-process
 * binding — the stdio JSON-RPC binding for editor clients (VS Code, §18.5)
 * is the named fast-follow (§21), and would wrap this same class without
 * apps/cli or apps/vscode changing.
 */
export class Agent {
  private readonly stateDir: string;
  private readonly store: RunStateStore;

  constructor(
    private readonly repoPath: string,
    stateDir?: string
  ) {
    this.stateDir = stateDir ?? defaultStateDir();
    this.store = new RunStateStore(this.stateDir);
  }

  /**
   * Everything a run needs besides the RunState and the RunWorktree
   * themselves — shared verbatim between a fresh `run()` and a `resume()`
   * of a previously paused one, so the two can never quietly drift apart
   * (credential loading, toolchain detection, the capability profile
   * lookup, and the §5.2 redactor setup all happen exactly once).
   */
  private buildRunDeps(model: string, providerKind: ProviderKind, run: RunWorktree, opts: { baseUrl?: string; modelsDir?: string }): RunDeps {
    const config = loadConfig(this.repoPath);
    const credentials = loadCredentialsFromEnv();

    let toolchainCommands: ToolchainCommands = detectToolchain(run.worktreePath);
    const agentsMdPath = path.join(run.worktreePath, "AGENTS.md");
    if (fs.existsSync(agentsMdPath)) {
      toolchainCommands = applyAgentsMdOverrides(toolchainCommands, fs.readFileSync(agentsMdPath, "utf8"));
    }

    const evidenceDir = path.join(this.stateDir, "runs", run.runId, "evidence");
    const tools: Map<string, Tool<unknown, unknown>> = nativeToolSet();
    const redactor = new Redactor();
    // §5.2 tier 1: known credential values are registered for exact-match
    // redaction (highest precision), on top of the pattern-based fallback.
    for (const secret of [credentials.anthropicApiKey, credentials.openaiApiKey]) {
      if (secret) redactor.registerSecret(secret);
    }
    const toolContext: ToolContext = {
      workspaceRoot: run.worktreePath,
      evidenceDir,
      policy: new PolicyEngine(),
      denylist: new Denylist(),
      redactor,
      repoTrustMode: isTrustedRepo(config, this.repoPath) ? ("trusted" as const) : ("untrusted" as const),
      networkAllowlist: []
    };

    const provider = buildProvider({ kind: providerKind, baseUrl: opts.baseUrl, credentials });

    // §4.2/§4.9 adaptation layer: use a persisted capability profile if this
    // model has been probed (`agent models probe`); otherwise fall back to
    // the provider's own best-effort defaults (ADR-015) — never block a run
    // on probing.
    const modelsDir = opts.modelsDir ?? defaultModelsDir();
    const capabilityProfile = loadCapabilityProfile(model, modelsDir);
    const capability = resolveCapability(capabilityProfile, provider.capabilityDefaults);

    return { provider, tools, toolContext, toolchainCommands, evidenceDir, capability, credentials, config };
  }

  async run(opts: RunOptions): Promise<RunState> {
    const runId = opts.runId ?? newRunId();

    const run = createRunWorktree({ repoPath: this.repoPath, stateDir: this.stateDir, runId, slug: slugify(opts.task) });
    saveRunWorktree(this.stateDir, run);

    const deps = this.buildRunDeps(opts.model, opts.providerKind, run, { baseUrl: opts.baseUrl, modelsDir: opts.modelsDir });

    const state = createRunState({
      runId,
      task: opts.task,
      provider: opts.providerKind,
      model: opts.model,
      capabilityProfileId: deps.capability.probed ? opts.model : undefined,
      baseUrl: opts.baseUrl,
      yesMode: opts.yesMode,
      budgets: {
        ...(deps.config.policy?.costCeilingUsd !== undefined ? { costUsd: deps.config.policy.costCeilingUsd } : {}),
        ...opts.budgets
      }
    });
    state.worktreePath = run.worktreePath;
    state.baseCommit = run.baseCommit;
    this.store.save(state);

    const loop = new AgentLoop(
      state,
      { provider: deps.provider, tools: deps.tools, toolContext: deps.toolContext, run, toolchainCommands: deps.toolchainCommands, evidenceDir: deps.evidenceDir, capability: deps.capability },
      {
        yesMode: opts.yesMode,
        onEvent: (event) => {
          appendEvent(this.stateDir, runId, event);
          this.store.save(state); // persist after every transition (§6.2) — a crash loses at most the in-flight step
          opts.onEvent?.(event);
        }
      }
    );

    const finalState = await loop.run();
    this.store.save(finalState);
    return finalState;
  }

  diff(runId: string): string {
    const run = this.requireRunWorktree(runId);
    return diffAgainstBase(run);
  }

  approve(runId: string, opts: ApproveOptions = {}): RunState {
    const state = this.requireState(runId);
    const run = this.requireRunWorktree(runId);
    const updated = commitApprovedRun(state, run, opts);
    this.store.save(updated);
    return updated;
  }

  reject(runId: string): RunState {
    const state = this.requireState(runId);
    const run = this.requireRunWorktree(runId);
    const updated = rejectRun(state, run);
    this.store.save(updated);
    return updated;
  }

  status(): RunState | null {
    const ids = this.store.list();
    if (ids.length === 0) return null;
    const states = ids.map((id) => this.store.load(id)!).filter(Boolean);
    states.sort((a, b) => b.updatedAt - a.updatedAt);
    return states[0] ?? null;
  }

  listRuns(): RunState[] {
    return this.store
      .list()
      .map((id) => this.store.load(id))
      .filter((s): s is RunState => s !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  inspect(runId: string): { state: RunState; events: ReturnType<typeof readEvents> } {
    const state = this.requireState(runId);
    return { state, events: readEvents(this.stateDir, runId) };
  }

  /**
   * `agent resume` (§6.2, §6.3, §18.2), hardened: a run paused on a budget
   * limit is reconstructed from its persisted `RunState` — including its
   * redacted transcript (§5.2) — and actually continues the act↔verify
   * loop, instead of only re-attaching and reporting status. A run that
   * isn't `PAUSED` is returned unchanged (DONE/FAILED/CANCELLED have
   * nothing to continue; AWAITING_APPROVAL goes through `approve`/`reject`;
   * ESCALATED needs human review — resuming those automatically isn't
   * this pass's scope, so it's a deliberate no-op here rather than a
   * silent wrong answer).
   */
  async resume(runId: string, opts: ResumeOptions = {}): Promise<RunState> {
    const state = this.requireState(runId);
    if (state.status !== "PAUSED") {
      // Nothing to continue: DONE/FAILED/CANCELLED are terminal (and
      // already cleaned up their worktree via approve/reject), and
      // AWAITING_APPROVAL/ESCALATED go through `approve`/`reject` or
      // human review, not this path.
      return state;
    }

    const run = this.requireRunWorktree(runId);
    if (!fs.existsSync(run.worktreePath)) {
      throw new Error(`worktree for run ${runId} no longer exists at ${run.worktreePath}; cannot resume`);
    }

    if (opts.extendSteps) state.budgets.steps += opts.extendSteps;
    if (opts.extendWallclockMs) state.budgets.wallclockMs += opts.extendWallclockMs;
    if (opts.extendTokens) state.budgets.tokens += opts.extendTokens;
    if (opts.extendCostUsd) state.budgets.costUsd += opts.extendCostUsd;

    const deps = this.buildRunDeps(state.model, state.provider as ProviderKind, run, { baseUrl: state.baseUrl, modelsDir: opts.modelsDir });

    const loop = new AgentLoop(
      state,
      { provider: deps.provider, tools: deps.tools, toolContext: deps.toolContext, run, toolchainCommands: deps.toolchainCommands, evidenceDir: deps.evidenceDir, capability: deps.capability },
      {
        yesMode: opts.yesMode ?? state.yesMode,
        onEvent: (event) => {
          appendEvent(this.stateDir, runId, event);
          this.store.save(state);
          opts.onEvent?.(event);
        }
      }
    );

    const finalState = await loop.resume();
    this.store.save(finalState);
    return finalState;
  }

  private requireState(runId: string): RunState {
    const state = this.store.load(runId);
    if (!state) throw new Error(`no such run: ${runId}`);
    return state;
  }

  private requireRunWorktree(runId: string): RunWorktree {
    const run = loadRunWorktree(this.stateDir, runId);
    if (!run) throw new Error(`no worktree metadata for run: ${runId}`);
    return run;
  }
}
