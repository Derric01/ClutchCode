import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a tool-provided path against the workspace root and refuse escape
 * (§12.3 filesystem confinement — "writes confined to the run's git
 * worktree + explicitly allowed paths").
 *
 * Real vulnerability caught in round 3 of security review, reproduced for
 * real against a throwaway repo: containment used to be decided by pure
 * string prefix-matching on `path.resolve()` output — it never resolved a
 * symlink, so a symlinked directory *inside* the workspace (e.g. checked
 * into the repo, or created by an earlier tool call via `shell`) that
 * points *outside* it made `inside: true` even though the OS-level write
 * follows the symlink and lands somewhere else entirely. Confirmed: with a
 * workspace-relative symlink `shared -> /tmp/outside`, requesting
 * `shared/pwned.txt` returned `inside: true`, and `write_file` — whose
 * `PolicyEngine` decision is gated on that flag with no approval prompt at
 * all when it's `true` — went on to genuinely write outside the workspace
 * via `fs.writeFileSync`. The identical mechanism gives `read_file` an
 * arbitrary-file-read primitive (e.g. reading `~/.aws/credentials` into
 * model context, which then leaves the machine as part of the request to
 * a cloud LLM provider).
 *
 * Fixed by resolving the real path of the deepest *existing* ancestor
 * (walking up until one is found — the requested leaf itself usually
 * doesn't exist yet, e.g. a brand-new file `write_file` is about to
 * create) and checking containment against *that* realpath, re-appending
 * the non-existent tail. This catches a symlinked directory component
 * even when the final path segment doesn't exist yet.
 */
function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // doesn't exist (yet) — nothing to resolve
  }
}

export function resolveInWorkspace(workspaceRoot: string, requested: string): { abs: string; inside: boolean } {
  const abs = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(workspaceRoot, requested);
  const root = path.resolve(workspaceRoot);
  const realRoot = realOrSelf(root);

  let existingAncestor = abs;
  const tail: string[] = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break; // reached the filesystem root
    tail.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const realExistingAncestor = realOrSelf(existingAncestor);
  const realAbs = tail.length > 0 ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;

  const inside = realAbs === realRoot || realAbs.startsWith(realRoot + path.sep);
  return { abs, inside };
}
