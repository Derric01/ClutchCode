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
 *
 * Follow-up gap, caught in a later review round and reproduced for real
 * against a throwaway workspace: the walk-up above originally decided
 * "does this ancestor exist" with `fs.existsSync`, which *follows* a
 * symlink to judge existence — so a **dangling** symlink (its target
 * doesn't exist yet) reported `existsSync === false` for its own path,
 * exactly like an ordinary not-yet-created file. That let the walk skip
 * straight past the symlink itself, treat it as a plain missing tail
 * component, and re-append it *unresolved* onto whatever ancestor
 * happened to exist above it. Confirmed concretely: a dangling symlink
 * `workspace/link -> /tmp/outside/pwned.txt` (the target directory exists,
 * the target file does not) made `resolveInWorkspace` report `inside:
 * true`, and a subsequent `fs.writeFileSync(abs, ...)` — where `abs` is
 * still the *unresolved* `workspace/link` — genuinely created
 * `/tmp/outside/pwned.txt` on disk, following the symlink exactly the way
 * a real POSIX `open(..., O_CREAT)` does for a broken symlink whose parent
 * directory exists. Fixed by walking up via `fs.lstatSync` (which reports
 * a symlink's *own* existence without following it) instead of
 * `fs.existsSync`, and by resolving one symlink hop at a time — including
 * a dangling one — via `fs.readlinkSync` rather than only ever calling
 * `fs.realpathSync` once at the end.
 */
function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // doesn't exist (yet) — nothing to resolve
  }
}

/**
 * Resolve `absPath` (already absolute) as far into its real, symlink-free
 * form as the filesystem currently allows. The common case — every
 * component exists — is handled by a single `fs.realpathSync` call. When
 * that fails, walk the path one component at a time using `fs.lstatSync`
 * (reports whether *that exact entry* exists, without dereferencing a
 * final symlink) so a dangling symlink is still recognized as an entry to
 * resolve — via `fs.readlinkSync`, one hop at a time, tolerating chains —
 * rather than silently passed through as an ordinary not-yet-existing
 * path. Only a component that doesn't exist at all (lstat itself throws)
 * stops resolution; everything from there on is appended verbatim, same
 * as the plain "brand-new file" case this function has always supported.
 */
function resolveRealAsFarAsPossible(absPath: string): string {
  try {
    return fs.realpathSync(absPath);
  } catch {
    // fall through — something in the chain doesn't fully exist: either a
    // genuinely-missing tail (the ordinary case) or a dangling symlink
    // (the case this function exists to still get right).
  }

  const root = path.parse(absPath).root;
  const segments = absPath.slice(root.length).split(path.sep).filter((s) => s.length > 0);

  let current = root;
  let linkHops = 0;

  for (let i = 0; i < segments.length; i++) {
    let candidate = path.join(current, segments[i]!); // i < segments.length, so this index is always present
    for (;;) {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(candidate);
      } catch {
        // this entry doesn't exist at all — nothing further to resolve;
        // append it and every remaining requested segment verbatim.
        return path.join(candidate, ...segments.slice(i + 1));
      }
      if (!stat.isSymbolicLink()) {
        current = candidate;
        break;
      }
      if (++linkHops > 40) {
        // mirrors a typical OS ELOOP threshold (Linux's MAXSYMLINKS) —
        // bail out loudly rather than spin on a symlink cycle.
        throw new Error(`too many levels of symbolic links resolving "${absPath}"`);
      }
      const target = fs.readlinkSync(candidate);
      candidate = path.isAbsolute(target)
        ? path.normalize(target)
        : path.normalize(path.join(path.dirname(candidate), target));
      // loop again: the substituted target may itself be a symlink
      // (including a dangling one), or may not exist at all.
    }
  }
  return current;
}

/**
 * `real` (the fully symlink-resolved target, same value already computed
 * internally for the containment check) matters to callers beyond
 * `inside`: a further gap in the same class, caught in the same review
 * round and reproduced for real — the §5.3 secrets denylist
 * (`Denylist.isDenied`) does pure basename/suffix matching on whatever
 * path string it's given. Every call site denylist-checked `abs` (the
 * *requested*, unresolved path) — so a symlink *entirely inside* the
 * workspace, aliasing a denylisted file under an innocuous name (e.g.
 * `notenv.txt -> .env`, both inside the workspace — `inside` is correctly
 * `true`, this was never the escape bug above), sailed straight past the
 * denylist on both `read_file` and `write_file`/`edit_file`: confirmed
 * `read_file({path: "notenv.txt"})` returned the real `.env` file's
 * content verbatim, because the check ran against the basename
 * `"notenv.txt"`, never against the real target `.env` the OS actually
 * reads. Callers now denylist-check `real` instead of `abs` — the same
 * fix, applied at the call sites, not inside this function — so the check
 * runs against what's actually being read from/written to.
 */
export function resolveInWorkspace(workspaceRoot: string, requested: string): { abs: string; real: string; inside: boolean } {
  const abs = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(workspaceRoot, requested);
  const root = path.resolve(workspaceRoot);
  const realRoot = realOrSelf(root);

  const realAbs = resolveRealAsFarAsPossible(abs);

  const inside = realAbs === realRoot || realAbs.startsWith(realRoot + path.sep);
  return { abs, real: realAbs, inside };
}
