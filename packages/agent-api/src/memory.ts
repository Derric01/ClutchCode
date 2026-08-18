import path from "node:path";
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

/**
 * §13.4 monorepos: a scoped run (`agent run --scope path/`) caches its
 * toolchain memory under `<repoPath>/<scope>`, not the bare repo root —
 * `Agent.run`'s `buildRunDeps` computes exactly this same join. Every
 * memory-inspection function below needs the identical key or it silently
 * reads/writes a different cache file than the one a scoped run actually
 * used — a real bug caught in review: `agent memory list` after a scoped
 * run used to show "nothing remembered" even though a fact genuinely was
 * cached, just under a different key.
 */
export function resolveMemoryCacheKeyPath(repoPath: string, scope?: string): string {
  return scope ? path.join(repoPath, scope) : repoPath;
}

export function listMemory(repoPath: string, opts?: ToolchainMemoryOptions, scope?: string): ToolchainMemory | undefined {
  return listToolchainMemory(resolveMemoryCacheKeyPath(repoPath, scope), opts);
}

export function showMemoryFact(repoPath: string, key: ToolchainFactKey, opts?: ToolchainMemoryOptions, scope?: string): MemoryFact | undefined {
  return showToolchainFact(resolveMemoryCacheKeyPath(repoPath, scope), key, opts);
}

export function forgetMemoryFact(repoPath: string, key: ToolchainFactKey, opts?: ToolchainMemoryOptions, scope?: string): boolean {
  return forgetToolchainFact(resolveMemoryCacheKeyPath(repoPath, scope), key, opts);
}

export function correctMemoryFact(repoPath: string, key: ToolchainFactKey, value: string, opts?: ToolchainMemoryOptions, scope?: string): void {
  correctToolchainFact(resolveMemoryCacheKeyPath(repoPath, scope), key, value, opts);
}
