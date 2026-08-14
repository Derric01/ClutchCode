export { Agent } from "./agent.js";
export type { RunOptions, ResumeOptions, ApproveOptions } from "./agent.js";

// Re-exported so `apps/*` never need to depend on @clutchcode/runtime
// directly (§20 boundary rule: apps depend only on agent-api).
export type { RunState, RunStatus, RuntimeEvent, ToolCallLogEntry, VerificationResultSummary, Budgets } from "@clutchcode/runtime";
export { loadConfig, saveConfig, isTrustedRepo, markTrusted, configPath, DEFAULT_CONFIG } from "./config.js";
export type { AgentConfig, ProviderConfig } from "./config.js";
export { loadCredentialsFromEnv } from "./credentials.js";
export type { Credentials } from "./credentials.js";
export { buildProvider } from "./provider-factory.js";
export type { ProviderKind, BuildProviderOptions } from "./provider-factory.js";
export { initRepo } from "./scaffold.js";
export type { InitResult } from "./scaffold.js";
export { appendEvent, readEvents } from "./events.js";
export { saveRunWorktree, loadRunWorktree } from "./worktree-store.js";
export { probeModel, listModelProfiles } from "./capability.js";
export type { ProbeModelOptions, ProbeModelResult } from "./capability.js";
export type { CapabilityProfile } from "@clutchcode/capability";
