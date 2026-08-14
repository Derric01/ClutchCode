import fs from "node:fs";
import path from "node:path";
import { git } from "./git-exec.js";

/**
 * The §13.4 "awkward cases" that are detectable purely from repo metadata
 * (submodule pointers, LFS-tracked patterns) — read once per run and
 * handed to the tool layer, rather than shelled out to on every read/write.
 */

/**
 * Every submodule's path, relative to the repo root (§13.4: "Worktree
 * inherits submodule pointers; agent edits to submodules are ASK+separate-
 * commit"). Reads `.gitmodules` directly via `git config` so this works
 * whether or not the submodules are actually initialized/checked out —
 * detection only needs the *pointer*, not the submodule's own content.
 */
export function listSubmodules(repoPath: string): string[] {
  if (!fs.existsSync(path.join(repoPath, ".gitmodules"))) return [];
  const out = git(["config", "--file", ".gitmodules", "--get-regexp", "\\.path$"], { cwd: repoPath, allowFailure: true });
  if (!out.trim()) return [];
  return out
    .trim()
    .split("\n")
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();
    })
    .filter(Boolean);
}

/**
 * Every `.gitattributes` glob pattern tagged `filter=lfs` (§13.4: "LFS
 * pointers respected; large binaries not read into context; edits to LFS
 * files flagged"). Only the root `.gitattributes` is read — nested
 * per-directory `.gitattributes` (valid in git, rare in practice) are a
 * known simplification, not silently mis-handled: a file they'd cover
 * just isn't flagged as LFS, the same as if it weren't LFS-tracked at all.
 */
export function listLfsPatterns(repoPath: string): string[] {
  const attrPath = path.join(repoPath, ".gitattributes");
  if (!fs.existsSync(attrPath)) return [];
  const lines = fs.readFileSync(attrPath, "utf8").split("\n");
  const patterns: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const pattern = parts[0]!;
    const attrs = parts.slice(1);
    if (attrs.includes("filter=lfs")) patterns.push(pattern);
  }
  return patterns;
}
