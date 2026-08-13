import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { Denylist, PolicyEngine, Redactor } from "@clutchcode/sandbox";
import { nativeToolSet, type Tool } from "@clutchcode/tools";
import { createRunWorktree, diffAgainstBase, type RunWorktree } from "@clutchcode/git";
import { applyAgentsMdOverrides, detectToolchain, type ToolchainCommands } from "@clutchcode/verification";
import {
  AgentLoop,
  RunStateStore,
  commitApprovedRun,
  createRunState,
  rejectRun,
  type RunState,
  type RuntimeEvent
} from "@clutchcode/runtime";
import { CapabilityProfileStore, defaultProfileFromProvider, runCapabilityProbe, type CapabilityProfile, type ProbeOptions } from "@clutchcode/capability";

import { loadConfig, isTrustedRepo } from "./config.js";
import { loadCredentialsFromEnv } from "./credentials.js";
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
  onEvent?: (event: RuntimeEvent) => void;
}

export interface ApproveOptions {
  squash?: boolean;
  message?: string;
}

function defaultStateDir(): string {
  return path.join(os.homedir(), ".local", "state", "clutchcode");
}

function defaultConfigDir(): string {
  return path.join(os.homedir(), ".config", "clutchcode");
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

/**
 * The Agent API boundary (PROJECT_SPEC.md §18.1, §20, ADR-011): the one
 * surface `apps/*` are allowed to depend on. This MVP ships the in-process
 * binding only — the stdio JSON-RPC binding for editor clients (VS Code,
 * §18.5) is the named fast-follow (§21), and would wrap this same class
 * without apps/cli or apps/vscode changing.
 */
export class Agent {
  private readonly stateDir: string;
  private readonly configDir: string;
  private readonly store: RunStateStore;
  private readonly capabilityStore: CapabilityProfileStore;

  constructor(
    private readonly repoPath: string,
    stateDir?: string,
    configDir?: string
  ) {
    this.stateDir = stateDir ?? defaultStateDir();
    this.configDir = configDir ?? defaultConfigDir();
    this.store = new RunStateStore(this.stateDir);
    this.capabilityStore = new CapabilityProfileStore(this.configDir);
  }

  async run(opts: RunOptions): Promise<RunState> {
    const config = loadConfig(this.repoPath);
    const credentials = loadCredentialsFromEnv();
    const runId = opts.runId ?? newRunId();

    const run = createRunWorktree({ repoPath: this.repoPath, stateDir: this.stateDir, runId, slug: slugify(opts.task) });
    saveRunWorktree(this.stateDir, run);

    let toolchainCommands: ToolchainCommands = detectToolchain(run.worktreePath);
    let projectMemory: string | undefined;
    const agentsMdPath = path.join(run.worktreePath, "AGENTS.md");
    if (fs.existsSync(agentsMdPath)) {
      projectMemory = fs.readFileSync(agentsMdPath, "utf8");
      toolchainCommands = applyAgentsMdOverrides(toolchainCommands, projectMemory);
    }

    const evidenceDir = path.join(this.stateDir, "runs", runId, "evidence");
    const tools: Map<string, Tool<unknown, unknown>> = nativeToolSet();
    const redactor = new Redactor();
    // §5.2 tier 1: known credential values are registered for exact-match
    // redaction (highest precision), on top of the pattern-based fallback.
    for (const secret of [credentials.anthropicApiKey, credentials.openaiApiKey]) {
      if (secret) redactor.registerSecret(secret);
    }
    const toolContext = {
      workspaceRoot: run.worktreePath,
      evidenceDir,
      policy: new PolicyEngine(),
      denylist: new Denylist(),
      redactor,
      repoTrustMode: isTrustedRepo(config, this.repoPath) ? ("trusted" as const) : ("untrusted" as const),
      networkAllowlist: []
    };

    const state = createRunState({
      runId,
      task: opts.task,
      provider: opts.providerKind,
      model: opts.model,
      budgets: config.policy?.costCeilingUsd !== undefined ? { costUsd: config.policy.costCeilingUsd } : undefined
    });
    state.worktreePath = run.worktreePath;
    state.baseCommit = run.baseCommit;
    this.store.save(state);

    const provider = buildProvider({ kind: opts.providerKind, baseUrl: opts.baseUrl, credentials });

    // §4.9: a previously-probed profile drives adaptation; absent one, fall
    // back to the provider adapter's own declared defaults (§4.9 "fall back
    // to static defaults if probe fails") rather than assuming the worst.
    const capabilityProfile: CapabilityProfile =
      this.capabilityStore.load(opts.providerKind, opts.model) ?? defaultProfileFromProvider(provider, opts.model);

    const loop = new AgentLoop(
      state,
      { provider, tools, toolContext, run, toolchainCommands, evidenceDir, projectMemory, capabilityProfile },
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

  /** `agent resume` (MVP, thin per §18.2): re-attach and report state; mid-run resumption of the loop is Phase 2. */
  resume(runId: string): RunState {
    const state = this.requireState(runId);
    const run = this.requireRunWorktree(runId);
    if (!fs.existsSync(run.worktreePath)) {
      throw new Error(`worktree for run ${runId} no longer exists at ${run.worktreePath}; cannot resume`);
    }
    return state;
  }

  /** `agent models probe` (§4.9, §18.2): probe once, persist the profile so future runs adapt without re-probing. */
  async probeModel(opts: { providerKind: ProviderKind; model: string; baseUrl?: string }, probeOpts: ProbeOptions = {}): Promise<CapabilityProfile> {
    const credentials = loadCredentialsFromEnv();
    const provider = buildProvider({ kind: opts.providerKind, baseUrl: opts.baseUrl, credentials });
    const profile = await runCapabilityProbe(provider, opts.model, probeOpts);
    this.capabilityStore.save(profile);
    return profile;
  }

  /** The persisted profile for a model, if it has been probed (§4.9) — null if not, without probing. */
  getCapabilityProfile(providerKind: ProviderKind, model: string): CapabilityProfile | null {
    return this.capabilityStore.load(providerKind, model);
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
