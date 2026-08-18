import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

import { Denylist, PolicyEngine, Redactor, detectSandboxBackend } from "@clutchcode/sandbox";
import { nativeToolSet, type Tool, type ToolContext } from "@clutchcode/tools";
import {
  createRunWorktree,
  diffAgainstBase,
  diffFilesAgainstBase,
  diffStat,
  githubCompareUrl,
  isGitRepo,
  listCheckpoints,
  listLfsPatterns,
  listSubmodules,
  parseGitHubRemote,
  pushBranch,
  remoteUrl,
  rollbackTo,
  type CheckpointRecord,
  type FileDiff,
  type RunWorktree
} from "@clutchcode/git";
import type { FailureClass, StageResult, ToolchainCommands } from "@clutchcode/verification";
import { getOrDetectToolchain, markToolchainFactStale, type ToolchainFactKey } from "@clutchcode/memory";
import { defaultModelsDir, loadCapabilityProfile, resolveCapability, type EffectiveCapability } from "@clutchcode/capability";
import type { Provider } from "@clutchcode/providers";
import {
  AgentLoop,
  BUILTIN_WORKFLOW_IDS,
  RunStateStore,
  commitApprovedRun,
  createRunState,
  isBuiltinWorkflowId,
  loadWorkflowDeclaration,
  rejectRun,
  resolveBuiltinWorkflowPlan,
  resolveWorkflowPlan,
  type Budgets,
  type RunState,
  type RuntimeEvent,
  type WorkflowPlan
} from "@clutchcode/runtime";

import { loadConfig, isTrustedRepo, type AgentConfig } from "./config.js";
import { loadCredentials, type Credentials } from "./credentials.js";
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
  /** §8.2: one of `BUILTIN_WORKFLOW_IDS` ("default" | "quickfix" | "review-only"); default "default". Mutually exclusive with `workflowFile`. */
  workflowId?: string;
  /** §8.1: path to a JSON-Schema-validated user-declarative workflow file — see `@clutchcode/runtime`'s `loadWorkflowDeclaration`. Its own `id` becomes `state.workflowId`. Mutually exclusive with `workflowId`. */
  workflowFile?: string;
  /** Capability-profile storage directory (§4.9); default: ~/.config/clutchcode/models — same default `agent models probe` writes to. */
  modelsDir?: string;
  /** Overrides the default budgets (§6.3) for this run; unset fields keep the config/default value. `agent.toml`'s `policy.costCeilingUsd` still applies unless overridden here. */
  budgets?: Partial<Budgets>;
  /** §13.4 monorepos: pin the verification (toolchain detection + pipeline cwd) scope to this subdir, relative to the repo root. */
  scope?: string;
  /** Override for the §10.3 project-memory store's location (default: ~/.config/clutchcode/memory); real usage never sets this, tests use it for isolation. */
  memoryDir?: string;
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
  /** Override for the §10.3 project-memory store's location; see `RunOptions.memoryDir`. */
  memoryDir?: string;
  onEvent?: (event: RuntimeEvent) => void;
}

export interface ApproveOptions {
  squash?: boolean;
  message?: string;
}

export interface PrOptions {
  /** Default: "origin". */
  remote?: string;
  /** Default: whatever branch `repoPath` had checked out when the run started (`RunWorktree.baseBranch`). */
  base?: string;
}

export interface PrResult {
  branch: string;
  remote: string;
  /** How the PR was (or wasn't) actually opened, beyond the push, which always happens. */
  method: "gh" | "compare-url" | "manual";
  /** The PR URL (`gh`) or a real GitHub compare URL (`compare-url`) — absent for `manual`. */
  url?: string;
}

function isGhAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** §13.5: "a body summarizing the task, diff stats, and verification results." */
function buildPrBody(state: RunState, run: RunWorktree): string {
  const stat = diffStat(run).trim();
  const lastVerify = state.verificationResults.at(-1);
  const verifyLine = lastVerify
    ? `Verification: ${lastVerify.allGreen ? "green" : `red (first failure: ${lastVerify.firstFailureStage})`}, ${lastVerify.cheatFlagCount} cheat flag(s) (§14).`
    : "Verification: not run yet.";
  return [
    `Task: ${state.task}`,
    "",
    verifyLine,
    "",
    "Diff stat:",
    "```",
    stat || "(no changes)",
    "```",
    "",
    "_Opened by ClutchCode's `agent pr` — pushes are never automatic (§13.5)._"
  ].join("\n");
}

/** The non-`gh` half of `agent pr`: a real GitHub compare URL when the remote is recognizably GitHub, else just a confirmation that the branch was pushed. Split out from `pr()` so it's testable without a `gh` install or a real network push. */
function resolveFallbackPrResult(repoPath: string, remote: string, base: string, branch: string): PrResult {
  const href = remoteUrl(repoPath, remote);
  const ghRef = href ? parseGitHubRemote(href) : null;
  if (ghRef) {
    return { branch, remote, method: "compare-url", url: githubCompareUrl(ghRef, base, branch) };
  }
  return { branch, remote, method: "manual" };
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
  verifyCwd: string;
  /** §10.3 point 3: reacts to a real verification failure by marking the matching cached toolchain fact stale, so the *next* run re-derives instead of repeating a proven-wrong command. */
  onVerificationFailure: (stage: StageResult, failureClass: FailureClass) => void;
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
  private buildRunDeps(
    model: string,
    providerKind: ProviderKind,
    run: RunWorktree,
    opts: { baseUrl?: string; modelsDir?: string; scope?: string; memoryDir?: string }
  ): RunDeps {
    const config = loadConfig(this.repoPath);
    const credentials = loadCredentials(); // §5.1: OS keychain first, env vars as the fallback

    // §13.4 monorepos: "the agent's ... verification scope can be pinned to
    // a subdir (--scope path/); test selection uses the subdir's toolchain."
    // Deliberately scoped to *verification* only (toolchain detection +
    // pipeline cwd) — fs read/write stays repo-wide, since a scoped
    // package in a real monorepo routinely needs to read siblings it
    // depends on; restricting reads to the scope dir would break that.
    const verifyCwd = opts.scope ? path.join(run.worktreePath, opts.scope) : run.worktreePath;
    if (opts.scope && !fs.existsSync(verifyCwd)) {
      throw new Error(`--scope "${opts.scope}" does not exist in the worktree (resolved to ${verifyCwd})`);
    }

    // §10.3: a persisted, provenance-timestamped cache — not a fresh
    // `detectToolchain` call every run — with `AGENTS.md` overrides
    // (point 4, "human edits win") re-applied on every re-derive. Cached
    // under the *stable* repo (+scope) path, not `verifyCwd` — that's a
    // fresh git-worktree directory every single run, so keying the cache
    // on it would mean it never hits at all, silently defeating the
    // point of caching; `detectFrom` still reads the live worktree
    // content, since that's what's actually being verified this run.
    const memoryCacheKeyPath = opts.scope ? path.join(this.repoPath, opts.scope) : this.repoPath;
    const agentsMdPath = path.join(run.worktreePath, "AGENTS.md");
    const agentsMdContent = fs.existsSync(agentsMdPath) ? fs.readFileSync(agentsMdPath, "utf8") : undefined;
    const memoryOpts = opts.memoryDir ? { configDir: opts.memoryDir } : undefined;
    const { commands: toolchainCommands } = getOrDetectToolchain(verifyCwd, memoryCacheKeyPath, agentsMdContent, memoryOpts);

    // §10.3 point 3, "verification is the truth oracle": a command that
    // turns out not to exist at all means the cached fact was wrong, not
    // that the model's edit was — mark just that fact stale so the next
    // run re-derives instead of repeating the same broken command.
    const onVerificationFailure = (stage: StageResult, failureClass: FailureClass): void => {
      if (failureClass !== "command-not-found") return;
      const key = stage.stage as ToolchainFactKey; // StageName ("build"|"test"|"lint"|"typecheck") is a subset of ToolchainFactKey
      markToolchainFactStale(memoryCacheKeyPath, key, `verification actually ran "${stage.command}" and got exit code ${stage.exitCode} (command not found)`, memoryOpts);
    };

    const evidenceDir = path.join(this.stateDir, "runs", run.runId, "evidence");
    const tools: Map<string, Tool<unknown, unknown>> = nativeToolSet();
    const redactor = new Redactor();
    // §5.2 tier 1: known credential values are registered for exact-match
    // redaction (highest precision), on top of the pattern-based fallback.
    for (const secret of [credentials.anthropicApiKey, credentials.openaiApiKey]) {
      if (secret) redactor.registerSecret(secret);
    }
    // §12.6: Tier 1 (bwrap/Seatbelt) is used automatically when available;
    // `policy.sandboxTier = "tier0"` in agent.toml is the documented
    // escape hatch (§12.2 "Override: agent config policy ...") for a setup
    // where Tier 1's confinement breaks a legitimate workflow.
    const sandbox =
      config.policy?.sandboxTier === "tier0"
        ? { backend: "none" as const, reason: "policy.sandboxTier = \"tier0\" in agent.toml" }
        : detectSandboxBackend();

    const toolContext: ToolContext = {
      workspaceRoot: run.worktreePath,
      evidenceDir,
      policy: new PolicyEngine(),
      denylist: new Denylist(),
      redactor,
      repoTrustMode: isTrustedRepo(config, this.repoPath) ? ("trusted" as const) : ("untrusted" as const),
      networkAllowlist: [],
      // §13.4: read once per run from repo metadata, not shelled out to per tool call.
      submodulePaths: listSubmodules(run.worktreePath),
      lfsPatterns: listLfsPatterns(run.worktreePath),
      sandbox
    };

    const provider = buildProvider({ kind: providerKind, baseUrl: opts.baseUrl, credentials });

    // §4.2/§4.9 adaptation layer: use a persisted capability profile if this
    // model has been probed (`agent models probe`); otherwise fall back to
    // the provider's own best-effort defaults (ADR-015) — never block a run
    // on probing.
    const modelsDir = opts.modelsDir ?? defaultModelsDir();
    const capabilityProfile = loadCapabilityProfile(model, modelsDir);
    const capability = resolveCapability(capabilityProfile, provider.capabilityDefaults);

    return { provider, tools, toolContext, toolchainCommands, evidenceDir, capability, credentials, config, verifyCwd, onVerificationFailure };
  }

  async run(opts: RunOptions): Promise<RunState> {
    if (!isGitRepo(this.repoPath)) {
      // §13.4 "not a git repo at all": worktree isolation needs a git repo
      // to branch/worktree from. `SnapshotBackup` (this package) exists as
      // the spec's named fallback primitive for that case, but wiring a
      // full parallel non-git AgentLoop execution path (checkpoint/diff/
      // rollback/approve all re-based on snapshots instead of git) is a
      // distinctly larger, separate piece of work this pass doesn't
      // attempt — so this fails loudly and actionably instead of half-
      // supporting it via a confusing git error three calls deep.
      throw new Error(
        `${this.repoPath} is not a git repository — ClutchCode needs one for worktree isolation (§13.1). Run "git init" (or "clutchcode init" to scaffold config too) and try again.`
      );
    }

    if (opts.workflowId !== undefined && opts.workflowFile !== undefined) {
      throw new Error(`"workflowId" and "workflowFile" are mutually exclusive — pick one (§8.1/§8.2)`);
    }

    // §8.1/§8.2: resolve whichever of the two was given (or neither, for
    // "default") into a `resolvedWorkflowId` for `state.workflowId` and a
    // `workflowPlan` for `AgentLoop`. `workflowPlan` stays undefined for
    // the plain "default" case (no id, no file) — `AgentLoop`'s own
    // constructor already resolves that from `state.workflowId` itself,
    // so there's nothing extra to compute here.
    let resolvedWorkflowId: string | undefined = opts.workflowId;
    let workflowPlan: WorkflowPlan | undefined;
    if (opts.workflowFile !== undefined) {
      const declaration = loadWorkflowDeclaration(opts.workflowFile);
      resolvedWorkflowId = declaration.id;
      workflowPlan = resolveWorkflowPlan(declaration);
    } else if (opts.workflowId !== undefined) {
      if (!isBuiltinWorkflowId(opts.workflowId)) {
        throw new Error(
          `unknown workflow "${opts.workflowId}" — expected one of: ${BUILTIN_WORKFLOW_IDS.join(", ")} (§8.2), or pass workflowFile for a custom declarative workflow (§8.1)`
        );
      }
      workflowPlan = resolveBuiltinWorkflowPlan(opts.workflowId);
    }

    const runId = opts.runId ?? newRunId();

    const run = createRunWorktree({ repoPath: this.repoPath, stateDir: this.stateDir, runId, slug: slugify(opts.task) });
    saveRunWorktree(this.stateDir, run);

    const deps = this.buildRunDeps(opts.model, opts.providerKind, run, { baseUrl: opts.baseUrl, modelsDir: opts.modelsDir, scope: opts.scope, memoryDir: opts.memoryDir });

    const state = createRunState({
      runId,
      task: opts.task,
      workflowId: resolvedWorkflowId,
      workflowPlan,
      provider: opts.providerKind,
      model: opts.model,
      capabilityProfileId: deps.capability.probed ? opts.model : undefined,
      baseUrl: opts.baseUrl,
      yesMode: opts.yesMode,
      scope: opts.scope,
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
      {
        provider: deps.provider,
        tools: deps.tools,
        toolContext: deps.toolContext,
        run,
        toolchainCommands: deps.toolchainCommands,
        evidenceDir: deps.evidenceDir,
        capability: deps.capability,
        verifyCwd: deps.verifyCwd,
        onVerificationFailure: deps.onVerificationFailure
        // No `workflowPlan` override here — `state.workflowPlan` (set by
        // `createRunState` above) is already the resolved plan `AgentLoop`
        // reads by default; passing it twice would just be redundant.
      },
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

  /** Per-file before/after content (§18.5) — what a native two-sided diff view needs that `diff()`'s unified-diff text can't drive on its own. */
  diffFiles(runId: string): FileDiff[] {
    const run = this.requireRunWorktree(runId);
    return diffFilesAgainstBase(run);
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

  /** `agent checkpoints <runId>` (§13.3): every checkpoint commit made so far, oldest first. */
  checkpoints(runId: string): CheckpointRecord[] {
    const run = this.requireRunWorktree(runId);
    return listCheckpoints(run);
  }

  /**
   * `agent rollback <runId> <sha>` (§13.3): resets the worktree to an
   * earlier checkpoint, including removing untracked files created after
   * it. Accepts a checkpoint's full or abbreviated sha (`git log --oneline`
   * width) — resolved against `checkpoints()` first so a typo'd/foreign
   * sha fails with a clear error instead of `git reset --hard` silently
   * doing something the caller didn't mean.
   */
  rollback(runId: string, sha: string): RunState {
    const state = this.requireState(runId);
    const run = this.requireRunWorktree(runId);
    const match = listCheckpoints(run).find((c) => c.sha === sha || c.sha.startsWith(sha));
    if (!match) {
      throw new Error(`no checkpoint matching "${sha}" for run ${runId}; see \`agent checkpoints ${runId}\` for valid values`);
    }
    rollbackTo(run, match.sha);
    this.store.save(state); // bumps updatedAt; rollback changes worktree content, not run status
    return state;
  }

  /**
   * `agent pr <runId>` (§13.5): pushes the run's branch and opens a PR —
   * "never auto-pushes without explicit command," and this command *is*
   * that explicit command. Unlike `approve`, this does not merge locally
   * or remove the worktree: the branch is meant to live under review.
   * Opens the PR via the `gh` CLI when it's on PATH and authenticated;
   * otherwise falls back to a real GitHub compare URL when the remote is
   * recognizably GitHub, or just confirms the push.
   */
  async pr(runId: string, opts: PrOptions = {}): Promise<PrResult> {
    const state = this.requireState(runId);
    const run = this.requireRunWorktree(runId);
    if (!fs.existsSync(run.worktreePath)) {
      throw new Error(`worktree for run ${runId} no longer exists at ${run.worktreePath}; nothing to open a PR for`);
    }

    const remote = opts.remote ?? "origin";
    const base = opts.base ?? run.baseBranch;
    if (!base) {
      throw new Error(`run ${runId} has no known base branch (started from a detached HEAD) — pass an explicit base`);
    }

    pushBranch(run, remote);

    if (isGhAvailable()) {
      try {
        const title = `clutchcode: ${state.task}`;
        const body = buildPrBody(state, run);
        const out = execFileSync("gh", ["pr", "create", "--head", run.branch, "--base", base, "--title", title, "--body", body], {
          cwd: run.repoPath,
          encoding: "utf8"
        }).trim();
        const url = out.split("\n").pop();
        return { branch: run.branch, remote, method: "gh", url };
      } catch {
        // `gh` exists but the create failed (not authenticated, PR already
        // exists, etc.) — the push already succeeded either way, so fall
        // through to the compare-url/manual result rather than throwing
        // away that success.
      }
    }

    return resolveFallbackPrResult(run.repoPath, remote, base, run.branch);
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

    const deps = this.buildRunDeps(state.model, state.provider as ProviderKind, run, { baseUrl: state.baseUrl, modelsDir: opts.modelsDir, scope: state.scope, memoryDir: opts.memoryDir });

    const loop = new AgentLoop(
      state,
      {
        provider: deps.provider,
        tools: deps.tools,
        toolContext: deps.toolContext,
        run,
        toolchainCommands: deps.toolchainCommands,
        evidenceDir: deps.evidenceDir,
        capability: deps.capability,
        verifyCwd: deps.verifyCwd,
        onVerificationFailure: deps.onVerificationFailure
      },
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
