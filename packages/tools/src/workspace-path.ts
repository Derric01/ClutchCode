import path from "node:path";

/**
 * Resolve a tool-provided path against the workspace root and refuse escape
 * (§12.3 filesystem confinement — "writes confined to the run's git
 * worktree + explicitly allowed paths").
 */
export function resolveInWorkspace(workspaceRoot: string, requested: string): { abs: string; inside: boolean } {
  const abs = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(workspaceRoot, requested);
  const root = path.resolve(workspaceRoot);
  const inside = abs === root || abs.startsWith(root + path.sep);
  return { abs, inside };
}
