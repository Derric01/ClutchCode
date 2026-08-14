import { execFileSync } from "node:child_process";
import {
  Agent,
  detectSandboxBackend,
  initRepo,
  listModelProfiles,
  loadConfig,
  loadCredentialsFromEnv,
  markTrusted,
  probeModel,
  type Budgets,
  type CapabilityProfile,
  type ProviderKind,
  type RunState
} from "@clutchcode/agent-api";
import { exitCodeForRunStatus, EXIT } from "./exit-codes.js";

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface CliContext {
  repoPath: string;
  stateDir?: string;
  json?: boolean;
  /** Override for capability-profile storage (default: ~/.config/clutchcode/models); not repo-scoped. */
  modelsDir?: string;
}

function summarizeRunState(state: RunState): Record<string, unknown> {
  return {
    runId: state.runId,
    task: state.task,
    status: state.status,
    stepIndex: state.stepIndex,
    consumed: state.consumed,
    repairIterations: state.repairIterations,
    verificationResults: state.verificationResults,
    escalationReason: state.escalationReason,
    lastError: state.lastError
  };
}

function formatRunState(state: RunState, json?: boolean): string {
  if (json) return JSON.stringify(summarizeRunState(state), null, 2);
  const lines = [
    `run ${state.runId} — ${state.status}`,
    `task: ${state.task}`,
    `steps: ${state.consumed.steps}/${state.budgets.steps}  tokens: ${state.consumed.tokens}/${state.budgets.tokens}`
  ];
  if (state.verificationResults.length > 0) {
    const last = state.verificationResults[state.verificationResults.length - 1]!;
    lines.push(`verification: ${last.allGreen ? "green" : `red (${last.firstFailureStage})`}; cheat flags: ${last.cheatFlagCount}`);
  }
  if (state.escalationReason) lines.push(`reason: ${state.escalationReason}`);
  if (state.lastError) lines.push(`last error: [${state.lastError.class}] ${state.lastError.detail}`);
  return lines.join("\n");
}

export async function cmdInit(ctx: CliContext): Promise<CommandResult> {
  const result = initRepo(ctx.repoPath);
  const output = ctx.json
    ? JSON.stringify(result)
    : [
        result.configCreated ? "created agent.toml" : "agent.toml already exists, left untouched",
        result.agentsMdCreated ? "created AGENTS.md" : "AGENTS.md already exists, left untouched"
      ].join("\n");
  return { exitCode: EXIT.SUCCESS, output };
}

/**
 * Builds `{ steps, wallclockMs, tokens, costUsd }` from only the fields the
 * caller actually set. `Agent.run`/`Agent.resume` spread this straight over
 * defaults/existing budgets (§6.3) — an object literal with an *explicit*
 * `undefined` value for an unset flag would spread right over that default
 * and silently zero it out, so unset flags must be omitted entirely, not
 * included as `undefined`.
 */
function definedBudgets(opts: { steps?: number; wallclockMs?: number; tokens?: number; costUsd?: number }): Partial<Budgets> | undefined {
  const budgets: Partial<Budgets> = {};
  if (opts.steps !== undefined) budgets.steps = opts.steps;
  if (opts.wallclockMs !== undefined) budgets.wallclockMs = opts.wallclockMs;
  if (opts.tokens !== undefined) budgets.tokens = opts.tokens;
  if (opts.costUsd !== undefined) budgets.costUsd = opts.costUsd;
  return Object.keys(budgets).length > 0 ? budgets : undefined;
}

export interface RunCommandOptions {
  task: string;
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  yes?: boolean;
  /** §6.3 budget overrides; unset fields keep the config/default value. */
  maxSteps?: number;
  maxWallclockMs?: number;
  maxTokens?: number;
  costCeilingUsd?: number;
  /** §13.4 monorepos: pin verification (toolchain + pipeline cwd) to this subdir. */
  scope?: string;
}

export async function cmdRun(ctx: CliContext, opts: RunCommandOptions): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const state = await agent.run({
      task: opts.task,
      providerKind: opts.providerKind,
      model: opts.model,
      baseUrl: opts.baseUrl,
      yesMode: opts.yes,
      modelsDir: ctx.modelsDir,
      scope: opts.scope,
      budgets: definedBudgets({ steps: opts.maxSteps, wallclockMs: opts.maxWallclockMs, tokens: opts.maxTokens, costUsd: opts.costCeilingUsd })
    });
    return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export async function cmdStatus(ctx: CliContext): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  const state = agent.status();
  if (!state) {
    return { exitCode: EXIT.SUCCESS, output: ctx.json ? "null" : "no runs yet" };
  }
  return { exitCode: EXIT.SUCCESS, output: formatRunState(state, ctx.json) };
}

export async function cmdDiff(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const diff = agent.diff(runId);
    return { exitCode: EXIT.SUCCESS, output: ctx.json ? JSON.stringify({ runId, diff }) : diff || "(no changes)" };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export interface ApproveCommandOptions {
  squash?: boolean;
  message?: string;
}

export async function cmdApprove(ctx: CliContext, runId: string, opts: ApproveCommandOptions): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const state = agent.approve(runId, opts);
    return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export async function cmdReject(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const state = agent.reject(runId);
    return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export async function cmdInspect(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const { state, events } = agent.inspect(runId);
    if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify({ state: summarizeRunState(state), events }, null, 2) };
    const lines = [formatRunState(state), "", `--- decision trail (${events.length} events) ---`];
    for (const e of events) {
      lines.push(`[${new Date(e.ts).toISOString()}] ${e.type}${"tool" in e ? ` ${e.tool}` : ""}`);
    }
    return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export interface ResumeCommandOptions {
  /** §6.3's "ask to extend/stop": how much to raise each budget before continuing a PAUSED run. A run that isn't PAUSED ignores these and is returned as-is. */
  extendSteps?: number;
  extendWallclockMs?: number;
  extendTokens?: number;
  extendCostUsd?: number;
  /** Overrides the run's original `--yes` for this resume only. */
  yes?: boolean;
}

export async function cmdResume(ctx: CliContext, runId: string, opts: ResumeCommandOptions = {}): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const state = await agent.resume(runId, {
      extendSteps: opts.extendSteps,
      extendWallclockMs: opts.extendWallclockMs,
      extendTokens: opts.extendTokens,
      extendCostUsd: opts.extendCostUsd,
      yesMode: opts.yes,
      modelsDir: ctx.modelsDir
    });
    return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

/** `agent checkpoints <runId>` (§13.3): every checkpoint commit made so far, oldest first. */
export async function cmdCheckpoints(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const checkpoints = agent.checkpoints(runId);
    if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify(checkpoints) };
    if (checkpoints.length === 0) return { exitCode: EXIT.SUCCESS, output: "no checkpoints yet" };
    return { exitCode: EXIT.SUCCESS, output: checkpoints.map((c) => `${c.sha.slice(0, 10)}  ${c.message}`).join("\n") };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

/** `agent rollback <runId> <sha>` (§13.3): resets the worktree to an earlier checkpoint, including removing untracked files created after it. */
export async function cmdRollback(ctx: CliContext, runId: string, sha: string): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const state = agent.rollback(runId, sha);
    return { exitCode: EXIT.SUCCESS, output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export interface PrCommandOptions {
  remote?: string;
  base?: string;
}

/** `agent pr <runId>` (§13.5): pushes the run's branch and opens a PR (via `gh` if available). Never runs without this explicit command. */
export async function cmdPr(ctx: CliContext, runId: string, opts: PrCommandOptions = {}): Promise<CommandResult> {
  const agent = new Agent(ctx.repoPath, ctx.stateDir);
  try {
    const result = await agent.pr(runId, opts);
    if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify(result) };
    const lines = [`pushed ${result.branch} to ${result.remote}`];
    if (result.method === "gh") lines.push(`PR opened: ${result.url}`);
    else if (result.method === "compare-url") lines.push(`open a PR: ${result.url}`);
    else lines.push("install/authenticate the `gh` CLI to open a PR automatically, or open one manually on your git host.");
    return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export async function cmdTrust(ctx: CliContext): Promise<CommandResult> {
  const config = markTrusted(ctx.repoPath);
  return { exitCode: EXIT.SUCCESS, output: ctx.json ? JSON.stringify(config) : `trusted: ${ctx.repoPath}` };
}

export async function cmdProviders(ctx: CliContext): Promise<CommandResult> {
  const config = loadConfig(ctx.repoPath);
  const creds = loadCredentialsFromEnv();
  const rows = [
    { kind: "anthropic", credentialPresent: Boolean(creds.anthropicApiKey) },
    { kind: "openai-compatible", credentialPresent: Boolean(creds.openaiApiKey) },
    { kind: "ollama", credentialPresent: true } // local server, no API key
  ];
  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify({ configured: config.providers, detected: rows }) };
  const lines = ["configured providers:", ...Object.entries(config.providers).map(([name, p]) => `  ${name}: ${p.kind}`)];
  lines.push("credential presence (env vars, §5.1):");
  for (const r of rows) lines.push(`  ${r.kind}: ${r.credentialPresent ? "present" : "not set"}`);
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function checkBinary(name: string, args: string[]): DoctorCheck {
  try {
    const out = execFileSync(name, args, { encoding: "utf8" }).trim().split("\n")[0];
    return { name, ok: true, detail: out ?? "found" };
  } catch {
    return { name, ok: false, detail: "not found on PATH" };
  }
}

async function checkOllama(): Promise<DoctorCheck> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timer);
    return { name: "ollama", ok: res.ok, detail: res.ok ? "reachable at localhost:11434" : `HTTP ${res.status}` };
  } catch {
    return { name: "ollama", ok: false, detail: "not reachable at localhost:11434 (not installed/running, or Profile C/API-only — that's fine)" };
  }
}

/** `agent doctor` (§4.10, §18.2): real, honest checks — never fabricated. No GPU/VRAM probing in this MVP pass. */
export async function cmdDoctor(ctx: CliContext): Promise<CommandResult> {
  const creds = loadCredentialsFromEnv();
  const sandbox = detectSandboxBackend();
  const checks: DoctorCheck[] = [
    { name: "node", ok: true, detail: process.version },
    checkBinary("git", ["--version"]),
    checkBinary("rg", ["--version"]),
    { name: "ANTHROPIC_API_KEY", ok: Boolean(creds.anthropicApiKey), detail: creds.anthropicApiKey ? "set" : "not set" },
    { name: "OPENAI_API_KEY", ok: Boolean(creds.openaiApiKey), detail: creds.openaiApiKey ? "set" : "not set" },
    { name: "sandbox (§12.5/§12.6)", ok: sandbox.backend !== "none", detail: `${sandbox.backend} — ${sandbox.reason}` },
    await checkOllama()
  ];

  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify({ checks }, null, 2) };
  const lines = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  lines.push("", "At least one of a provider API key or a reachable local Ollama server is needed to run a real task.");
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}

export interface ModelsProbeOptions {
  model: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  force?: boolean;
  trials?: number;
}

function formatProfile(profile: CapabilityProfile): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    `model: ${profile.modelId}  (provider: ${profile.providerId})`,
    `probed: ${profile.probedAt}  (${profile.trials} trial(s), ${profile.probeDurationMs}ms)`,
    `diff-application accuracy: ${pct(profile.diffApplicationAccuracy)}  → edit format ${profile.diffApplicationAccuracy >= 0.75 ? "search/replace" : "whole-file (fallback)"}`,
    `tool transport: ${profile.toolTransport}`,
    `structured-output reliability: ${profile.structuredOutputReliability} (${pct(profile.structuredOutputScore)})`,
    `instruction fidelity: ${profile.longPromptInstructionFidelity} (${pct(profile.instructionFidelity)})`,
    `effective context: ~${profile.effectiveContext} tokens`,
    `loop-check: ${profile.loopCheckPassed ? "passed" : "FAILED — repeats an already-finished action"}`
  ];
  if (profile.notes.length > 0) lines.push(`notes: ${profile.notes.join("; ")}`);
  return lines.join("\n");
}

/** `agent models probe <model>` (§4.9): run/reuse the capability probe and persist the profile. */
export async function cmdModelsProbe(ctx: CliContext, opts: ModelsProbeOptions): Promise<CommandResult> {
  const result = await probeModel({
    providerKind: opts.providerKind,
    model: opts.model,
    baseUrl: opts.baseUrl,
    force: opts.force,
    trials: opts.trials,
    modelsDir: ctx.modelsDir
  });
  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify(result) };
  const header = result.cached ? `(cached profile from ${result.path}; pass --force to re-probe)\n\n` : "";
  return { exitCode: EXIT.SUCCESS, output: `${header}${formatProfile(result.profile)}` };
}

/** `agent models list` (§4.9): every previously-probed model's profile. */
export async function cmdModelsList(ctx: CliContext): Promise<CommandResult> {
  const profiles = listModelProfiles(ctx.modelsDir);
  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify(profiles) };
  if (profiles.length === 0) {
    return { exitCode: EXIT.SUCCESS, output: "no probed models yet — run `clutchcode models probe <model>`" };
  }
  const lines = profiles.map(
    (p) =>
      `${p.modelId}\tprovider=${p.providerId}\tdiff_acc=${p.diffApplicationAccuracy.toFixed(2)}\ttransport=${p.toolTransport}\tctx=${p.effectiveContext}`
  );
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}
