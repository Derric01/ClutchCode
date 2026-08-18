import {
  correctToolchainFact,
  forgetToolchainFact,
  listToolchainMemory,
  showToolchainFact,
  type MemoryFact,
  type ToolchainFactKey,
  type ToolchainMemory,
  type ToolchainMemoryOptions
} from "@clutchcode/memory";

/**
 * `agent memory list/show/forget/correct` (§10.3, §18.2) — the Agent API
 * binding over @clutchcode/memory, so apps/* never depend on it directly
 * (§20 boundary rule, same reason `capability.ts` wraps
 * @clutchcode/capability instead of apps/cli importing it directly).
 */

export function listMemory(repoPath: string, opts?: ToolchainMemoryOptions): ToolchainMemory | undefined {
  return listToolchainMemory(repoPath, opts);
}

export function showMemoryFact(repoPath: string, key: ToolchainFactKey, opts?: ToolchainMemoryOptions): MemoryFact | undefined {
  return showToolchainFact(repoPath, key, opts);
}

export function forgetMemoryFact(repoPath: string, key: ToolchainFactKey, opts?: ToolchainMemoryOptions): boolean {
  return forgetToolchainFact(repoPath, key, opts);
}

export function correctMemoryFact(repoPath: string, key: ToolchainFactKey, value: string, opts?: ToolchainMemoryOptions): void {
  correctToolchainFact(repoPath, key, value, opts);
}
