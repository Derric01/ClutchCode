export { Agent } from "./agent.js";
export type { RunOptions, ResumeOptions, ApproveOptions, PrOptions, PrResult } from "./agent.js";

// Re-exported so `apps/*` never need to depend on @clutchcode/runtime
// directly (§20 boundary rule: apps depend only on agent-api).
export type { RunState, RunStatus, RuntimeEvent, ToolCallLogEntry, VerificationResultSummary, Budgets } from "@clutchcode/runtime";
// Re-exported for the same reason, but from @clutchcode/git (§20 boundary rule extends to every internal package, not just runtime).
export type { CheckpointRecord } from "@clutchcode/git";
// Re-exported for the same reason, but from @clutchcode/sandbox — `agent doctor` reports the resolved Tier 1 backend (§12.5/§12.6).
export { detectSandboxBackend } from "@clutchcode/sandbox";
export type { SandboxBackend, SandboxCapability } from "@clutchcode/sandbox";
export { loadConfig, saveConfig, isTrustedRepo, markTrusted, configPath, DEFAULT_CONFIG } from "./config.js";
export type { AgentConfig, ProviderConfig } from "./config.js";
export { loadCredentialsFromEnv, loadCredentials, saveCredential, clearCredential } from "./credentials.js";
export type { Credentials, CredentialKind, CredentialWriteResult, CredentialStorageBackend } from "./credentials.js";
export { detectKeychainBackend } from "./keychain.js";
export type { KeychainBackend, KeychainDetection } from "./keychain.js";
export { defaultCredentialConfigDir } from "./credential-file-store.js";
export type { FileStoreOptions } from "./credential-file-store.js";
export { buildProvider } from "./provider-factory.js";
export type { ProviderKind, BuildProviderOptions } from "./provider-factory.js";
export { initRepo } from "./scaffold.js";
export type { InitResult } from "./scaffold.js";
export { appendEvent, readEvents } from "./events.js";
export { saveRunWorktree, loadRunWorktree } from "./worktree-store.js";
export { probeModel, listModelProfiles } from "./capability.js";
export type { ProbeModelOptions, ProbeModelResult } from "./capability.js";
export type { CapabilityProfile } from "@clutchcode/capability";
export { listMemory, showMemoryFact, forgetMemoryFact, correctMemoryFact } from "./memory.js";
export type { MemoryFact, ToolchainFactKey, ToolchainMemory, ToolchainMemoryOptions } from "@clutchcode/memory";
