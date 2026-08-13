import { execFileSync } from "node:child_process";
import {
  Agent,
  initRepo,
  loadConfig,
  loadCredentialsFromEnv,
  markTrusted,
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
  configDir?: string;
  json?: boolean;
}

function newAgent(ctx: CliContext): Agent {
  return new Agent(ctx.repoPath, ctx.stateDir, ctx.configDir);
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

export interface RunCommandOptions {
  task: string;
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  yes?: boolean;
}

export async function cmdRun(ctx: CliContext, opts: RunCommandOptions): Promise<CommandResult> {
  const agent = newAgent(ctx);
  const state = await agent.run({
    task: opts.task,
    providerKind: opts.providerKind,
    model: opts.model,
    baseUrl: opts.baseUrl,
    yesMode: opts.yes
  });
  return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
}

export async function cmdStatus(ctx: CliContext): Promise<CommandResult> {
  const agent = newAgent(ctx);
  const state = agent.status();
  if (!state) {
    return { exitCode: EXIT.SUCCESS, output: ctx.json ? "null" : "no runs yet" };
  }
  return { exitCode: EXIT.SUCCESS, output: formatRunState(state, ctx.json) };
}

export async function cmdDiff(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = newAgent(ctx);
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
  const agent = newAgent(ctx);
  try {
    const state = agent.approve(runId, opts);
    return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export async function cmdReject(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = newAgent(ctx);
  try {
    const state = agent.reject(runId);
    return { exitCode: exitCodeForRunStatus(state.status), output: formatRunState(state, ctx.json) };
  } catch (e) {
    return { exitCode: EXIT.CONFIG_ERROR, output: String((e as Error).message) };
  }
}

export async function cmdInspect(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = newAgent(ctx);
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

export async function cmdResume(ctx: CliContext, runId: string): Promise<CommandResult> {
  const agent = newAgent(ctx);
  try {
    const state = agent.resume(runId);
    return {
      exitCode: EXIT.SUCCESS,
      output: ctx.json
        ? formatRunState(state, true)
        : `${formatRunState(state)}\n\n(note: MVP resume re-attaches and reports state; continuing an in-flight loop is a Phase 2 hardening item, §18.2)`
    };
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

export interface ModelsProbeOptions {
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  trials?: number;
}

function formatCapabilityProfile(profile: CapabilityProfile, json?: boolean): string {
  if (json) return JSON.stringify(profile, null, 2);
  return [
    `${profile.providerId}/${profile.modelId} capability profile (probed ${new Date(profile.probedAt).toISOString()}):`,
    `  diff_acc (SEARCH/REPLACE accuracy): ${(profile.diffAcc * 100).toFixed(0)}%`,
    `  instruction_fidelity (stop obedience): ${(profile.instructionFidelity * 100).toFixed(0)}%`,
    `  tool_transport: ${profile.toolTransport}`,
    `  structured_output_reliability: ${(profile.structuredOutputReliability * 100).toFixed(0)}%`,
    `  effective_context: ~${profile.effectiveContext} chars`,
    `  loop_check_passed: ${profile.loopCheckPassed}`,
    `  constrained_decode: ${profile.supportsConstrainedDecode}`
  ].join("\n");
}

/** `agent models probe` (§4.9, §18.2): probe once, persist, so future `agent run`s adapt without re-probing. */
export async function cmdModelsProbe(ctx: CliContext, opts: ModelsProbeOptions): Promise<CommandResult> {
  const agent = newAgent(ctx);
  const profile = await agent.probeModel(
    { providerKind: opts.providerKind, model: opts.model, baseUrl: opts.baseUrl },
    { trials: opts.trials }
  );
  return { exitCode: EXIT.SUCCESS, output: formatCapabilityProfile(profile, ctx.json) };
}

/** `agent models` (§18.2): shows the persisted profile for a model, if any — doesn't probe. */
export async function cmdModelsShow(ctx: CliContext, providerKind: ProviderKind, model: string): Promise<CommandResult> {
  const agent = newAgent(ctx);
  const profile = agent.getCapabilityProfile(providerKind, model);
  if (!profile) {
    return { exitCode: EXIT.SUCCESS, output: ctx.json ? "null" : `${providerKind}/${model} has not been probed yet — run \`clutchcode models probe\`` };
  }
  return { exitCode: EXIT.SUCCESS, output: formatCapabilityProfile(profile, ctx.json) };
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
  const checks: DoctorCheck[] = [
    { name: "node", ok: true, detail: process.version },
    checkBinary("git", ["--version"]),
    checkBinary("rg", ["--version"]),
    { name: "ANTHROPIC_API_KEY", ok: Boolean(creds.anthropicApiKey), detail: creds.anthropicApiKey ? "set" : "not set" },
    { name: "OPENAI_API_KEY", ok: Boolean(creds.openaiApiKey), detail: creds.openaiApiKey ? "set" : "not set" },
    await checkOllama()
  ];

  if (ctx.json) return { exitCode: EXIT.SUCCESS, output: JSON.stringify({ checks }, null, 2) };
  const lines = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  lines.push("", "At least one of a provider API key or a reachable local Ollama server is needed to run a real task.");
  return { exitCode: EXIT.SUCCESS, output: lines.join("\n") };
}
