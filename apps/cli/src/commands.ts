import type { Readable, Writable } from "node:stream";
import { execFileSync } from "node:child_process";
import {
  Agent,
  clearCredential,
  correctMemoryFact,
  detectKeychainBackend,
  detectSandboxBackend,
  forgetMemoryFact,
  initRepo,
  listMemory,
  listModelProfiles,
  loadConfig,
  loadCredentials,
  markTrusted,
  probeModel,
  saveCredential,
  showMemoryFact,
  type Budgets,
  type CapabilityProfile,
  type CredentialKind,
  type FileStoreOptions,
  type ProviderKind,
  type RunState,
  type ToolchainFactKey
} from "@clutchcode/agent-api";
import { serveAgentRpc, type AgentRpcServerHandle } from "@clutchcode/agent-rpc";
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
  /** Override for `process.env` — real CLI usage never sets this; tests use it to point credential commands at a throwaway OS keychain instead of the real one. */
  env?: NodeJS.ProcessEnv;
  /** Override for the §5.1 tier 2 encrypted file store's location (default: ~/.config/clutchcode); tests point it at a temp dir. */
  credentialFileStore?: FileStoreOptions;
  /** Override for the §10.3 project-memory store's location (default: ~/.config/clutchcode/memory); tests point it at a temp dir. */
  memoryDir?: string;
  /** §13.4 monorepos: the `agent memory` commands' own `--scope` — must match the subdir a scoped run used, or its cached facts are invisible/uncorrectable here (memory is cached per-scope, not just per-repo). */
  scope?: string;
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
  /** §8.2: "default" | "quickfix" | "review-only"; default "default". Mutually exclusive with workflowFile. */
  workflowId?: string;
  /** §8.1: path to a JSON-Schema-validated user-declarative workflow file. Mutually exclusive with workflowId. */
  workflowFile?: string;
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
      memoryDir: ctx.memoryDir,
      scope: opts.scope,
      workflowId: opts.workflowId,
      workflowFile: opts.workflowFile,
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
      modelsDir: ctx.modelsDir,
      memoryDir: ctx.memoryDir
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

/** Maps the CLI-facing provider name to the §5.1 keychain account it stores a key under. `ollama` has no key entry — it's a local server. */
const CREDENTIAL_PROVIDERS: Record<string, CredentialKind> = { anthropic: "anthropicApiKey", "openai-compatible": "openaiApiKey" };

export async function cmdProviders(ctx: CliContext): Promise<CommandResult> {
  const config = loadConfig(ctx.repoPath);
  const creds = loadCredentials(ctx.env, ctx.credentialFileStore); // §5.1: OS keychain, then the encrypted file store, then env vars
  const { backend, reason } = detectKeychainBackend(process.platform, ctx.env);
  const rows = [
    { kind: "anthropic", credentialPresent: Boolean(creds.anthropicApiKey) },
    { kind: "openai-compatible", credentialPresent: Boolean(creds.openaiApiKey) },
    { kind: "ollama", credentialPresent: true } // local server, no API key
  ];
  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify({ configured: config.providers, detected: rows, keychain: { backend, reason } }) };
  const storageTier = backend === "none" ? "encrypted file store (~/.config/clutchcode/credentials.age)" : `OS keychain [${backend}]`;
  const lines = ["configured providers:", ...Object.entries(config.providers).map(([name, p]) => `  ${name}: ${p.kind}`)];
  lines.push(`credential presence (§5.1 — ${storageTier} first, env vars as the fallback):`);
  for (const r of rows) lines.push(`  ${r.kind}: ${r.credentialPresent ? "present" : "not set"}`);
  lines.push(`OS keychain backend: ${backend} (${reason})`);
  lines.push("set a key with `agent providers set-key <anthropic|openai-compatible>` (reads the value from stdin, never argv/history)");
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}

function readAllStdin(stdin: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => (data += chunk));
    stdin.on("end", () => resolve(data));
    stdin.on("error", reject);
  });
}

/**
 * `agent providers set-key <provider>` (§5.1 tiers 1/2): stores an API key
 * in the OS keychain, or the encrypted file store when no keychain exists
 * on this platform. Reads the value from stdin rather than an argument or
 * an interactive prompt — never lands in shell history or a process
 * listing, and stays scriptable (`echo -n "$KEY" | agent providers set-key anthropic`).
 */
export async function cmdProvidersSetKey(ctx: CliContext, provider: string, stdin: Readable): Promise<CommandResult> {
  const kind = CREDENTIAL_PROVIDERS[provider];
  if (!kind) return { exitCode: EXIT.CONFIG_ERROR, output: `unknown provider "${provider}" — expected one of: ${Object.keys(CREDENTIAL_PROVIDERS).join(", ")}` };

  const value = (await readAllStdin(stdin)).trim();
  if (!value) return { exitCode: EXIT.CONFIG_ERROR, output: "no key provided on stdin — pipe the key in, e.g. `echo -n \"$KEY\" | agent providers set-key anthropic`" };

  const result = saveCredential(kind, value, ctx.env, ctx.credentialFileStore);
  if (!result.ok) {
    return {
      exitCode: EXIT.CONFIG_ERROR,
      output: `could not store the key (tried: ${result.backend}) — set the ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} environment variable instead (§5.1 tier 3)`
    };
  }
  return {
    exitCode: EXIT.SUCCESS,
    output: ctx.json ? JSON.stringify({ provider, backend: result.backend, ok: true }) : `${provider}: key stored (${result.backend})`
  };
}

export async function cmdProvidersUnsetKey(ctx: CliContext, provider: string): Promise<CommandResult> {
  const kind = CREDENTIAL_PROVIDERS[provider];
  if (!kind) return { exitCode: EXIT.CONFIG_ERROR, output: `unknown provider "${provider}" — expected one of: ${Object.keys(CREDENTIAL_PROVIDERS).join(", ")}` };

  const result = clearCredential(kind, ctx.env, ctx.credentialFileStore);
  const humanLine = result.ok ? `${provider}: key removed (${result.backend})` : `${provider}: nothing to remove (backend: ${result.backend})`;
  return { exitCode: EXIT.SUCCESS, output: ctx.json ? JSON.stringify({ provider, backend: result.backend, ok: result.ok }) : humanLine };
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

/** `agent doctor` (§4.10, §18.2): real, honest checks — never fabricated. No GPU/VRAM probing in this pass (tracked as a Phase 2 follow-up). */
export async function cmdDoctor(ctx: CliContext): Promise<CommandResult> {
  const creds = loadCredentials(ctx.env, ctx.credentialFileStore); // §5.1: OS keychain, then the encrypted file store, then env vars
  const sandbox = detectSandboxBackend();
  const keychain = detectKeychainBackend(process.platform, ctx.env);
  const checks: DoctorCheck[] = [
    { name: "node", ok: true, detail: process.version },
    checkBinary("git", ["--version"]),
    checkBinary("rg", ["--version"]),
    { name: "anthropic credential", ok: Boolean(creds.anthropicApiKey), detail: creds.anthropicApiKey ? "available (keychain or ANTHROPIC_API_KEY)" : "not set" },
    { name: "openai-compatible credential", ok: Boolean(creds.openaiApiKey), detail: creds.openaiApiKey ? "available (keychain or OPENAI_API_KEY)" : "not set" },
    { name: "OS keychain (§5.1)", ok: keychain.backend !== "none", detail: `${keychain.backend} — ${keychain.reason}` },
    { name: "sandbox (§12.5/§12.6)", ok: sandbox.backend !== "none", detail: `${sandbox.backend} — ${sandbox.reason}` },
    ...(sandbox.backend === "bwrap"
      ? [{ name: "seccomp hardening (§12.6)", ok: sandbox.seccomp?.supported ?? false, detail: sandbox.seccomp?.reason ?? "not evaluated" }]
      : []),
    await checkOllama()
  ];

  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify({ checks }, null, 2) };
  const lines = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  lines.push("", "At least one of a provider API key or a reachable local Ollama server is needed to run a real task.");
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}

const MEMORY_FACT_KEYS: ToolchainFactKey[] = ["language", "packageManager", "build", "test", "lint", "typecheck"];

function memoryOpts(ctx: CliContext): { configDir?: string } | undefined {
  return ctx.memoryDir ? { configDir: ctx.memoryDir } : undefined;
}

function parseMemoryFactKey(key: string): ToolchainFactKey | undefined {
  return (MEMORY_FACT_KEYS as string[]).includes(key) ? (key as ToolchainFactKey) : undefined;
}

/** `agent memory list` (§10.3, §18.2): every remembered toolchain fact, with provenance and staleness. */
export async function cmdMemoryList(ctx: CliContext): Promise<CommandResult> {
  const memory = listMemory(ctx.repoPath, memoryOpts(ctx), ctx.scope);
  if (!memory) {
    return { exitCode: EXIT.SUCCESS, output: ctx.json ? "null" : "nothing remembered yet for this repo — run `agent run` once, or `agent memory correct <key> <value>` to seed a fact" };
  }
  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify(memory) };
  const lines = [`manifest hash: ${memory.manifestHash.slice(0, 12)}…`];
  for (const key of MEMORY_FACT_KEYS) {
    const fact = memory.facts[key];
    if (!fact) continue;
    lines.push(`  ${key}: ${fact.value}${fact.stale ? " [STALE]" : ""}`);
    lines.push(`    source: ${fact.source}`);
    lines.push(`    derived: ${fact.derivedAt}`);
    if (fact.stale && fact.staleReason) lines.push(`    stale reason: ${fact.staleReason}`);
  }
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}

/** `agent memory show <key>` (§10.3, §18.2): one fact's full detail. */
export async function cmdMemoryShow(ctx: CliContext, key: string): Promise<CommandResult> {
  const factKey = parseMemoryFactKey(key);
  if (!factKey) return { exitCode: EXIT.CONFIG_ERROR, output: `unknown fact "${key}" — expected one of: ${MEMORY_FACT_KEYS.join(", ")}` };

  const fact = showMemoryFact(ctx.repoPath, factKey, memoryOpts(ctx), ctx.scope);
  if (!fact) return { exitCode: EXIT.SUCCESS, output: ctx.json ? "null" : `${key}: nothing remembered yet` };
  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify(fact) };
  const lines = [`${key}: ${fact.value}${fact.stale ? " [STALE]" : ""}`, `source: ${fact.source}`, `derived: ${fact.derivedAt}`];
  if (fact.stale && fact.staleReason) lines.push(`stale reason: ${fact.staleReason}`);
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}

/** `agent memory forget <key>` (§10.3, §18.2): removes one fact — the next run re-derives it. */
export async function cmdMemoryForget(ctx: CliContext, key: string): Promise<CommandResult> {
  const factKey = parseMemoryFactKey(key);
  if (!factKey) return { exitCode: EXIT.CONFIG_ERROR, output: `unknown fact "${key}" — expected one of: ${MEMORY_FACT_KEYS.join(", ")}` };

  const removed = forgetMemoryFact(ctx.repoPath, factKey, memoryOpts(ctx), ctx.scope);
  const humanLine = removed ? `${key}: forgotten — the next run will re-derive it` : `${key}: nothing to forget`;
  return { exitCode: EXIT.SUCCESS, output: ctx.json ? JSON.stringify({ key, removed }) : humanLine };
}

/** `agent memory correct <key> <value>` (§10.3 point 5, §18.2): a human directly overwrites a fact. */
export async function cmdMemoryCorrect(ctx: CliContext, key: string, value: string): Promise<CommandResult> {
  const factKey = parseMemoryFactKey(key);
  if (!factKey) return { exitCode: EXIT.CONFIG_ERROR, output: `unknown fact "${key}" — expected one of: ${MEMORY_FACT_KEYS.join(", ")}` };
  if (!value.trim()) return { exitCode: EXIT.CONFIG_ERROR, output: "no value provided — usage: agent memory correct <key> <value>" };

  correctMemoryFact(ctx.repoPath, factKey, value, memoryOpts(ctx), ctx.scope);
  return { exitCode: EXIT.SUCCESS, output: ctx.json ? JSON.stringify({ key, value }) : `${key}: corrected to "${value}"` };
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

/**
 * `clutchcode serve` (§18.1/§18.5): the Agent API's stdio JSON-RPC
 * binding, the same shape a VS Code (or, later, Zed/Neovim) client
 * spawns and speaks to — "the extension spawns/attaches to the runtime;
 * no separate reimplementation of agent logic in the extension." A thin
 * pass-through over `serveAgentRpc` so it's callable with any
 * Readable/Writable pair — tests use in-memory streams; `cli.ts` wires
 * real `process.stdin`/`process.stdout` and owns the process lifecycle
 * (this function doesn't call `process.exit` itself, so it stays testable).
 */
export function cmdServe(ctx: CliContext, stdin: Readable, stdout: Writable): AgentRpcServerHandle {
  return serveAgentRpc({ repoPath: ctx.repoPath, stateDir: ctx.stateDir }, stdin, stdout);
}
