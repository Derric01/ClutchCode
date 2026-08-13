import path from "node:path";

/**
 * Filesystem denylist (PROJECT_SPEC.md §5.3).
 *
 * By default the agent cannot READ these paths. Enforced at the tool layer
 * (this module) AND, in later phases, at the sandbox layer (§12.3) for
 * defense in depth. This module is the tool-layer half.
 */

const DEFAULT_DENY_BASENAMES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".git-credentials",
  ".netrc",
  ".bash_history",
  ".zsh_history",
  ".python_history"
];

const DEFAULT_DENY_DIR_SUFFIXES = [
  ".ssh",
  ".aws",
  ".kube",
  path.join(".config", "gcloud"),
  path.join(".docker", "config.json")
];

// .env.example is the one explicit exception (PROJECT_SPEC.md §5.1).
const ALLOW_EXCEPTIONS = new Set([".env.example"]);

export interface DenylistOptions {
  /** Extra basenames to deny, e.g. project-specific secrets files. */
  extraBasenames?: string[];
  /** Extra path-suffix fragments to deny (matched with path separators). */
  extraSuffixes?: string[];
}

export class Denylist {
  private readonly basenames: Set<string>;
  private readonly suffixes: string[];

  constructor(opts: DenylistOptions = {}) {
    this.basenames = new Set([...DEFAULT_DENY_BASENAMES, ...(opts.extraBasenames ?? [])]);
    this.suffixes = [...DEFAULT_DENY_DIR_SUFFIXES, ...(opts.extraSuffixes ?? [])];
  }

  /** Returns true if `p` (any path, relative or absolute) is denylisted for reads. */
  isDenied(p: string): boolean {
    const base = path.basename(p);
    if (ALLOW_EXCEPTIONS.has(base)) return false;

    if (base.startsWith(".env") && !ALLOW_EXCEPTIONS.has(base)) return true;
    if (this.basenames.has(base)) return true;

    const normalized = p.split(path.sep).join("/");
    for (const suffix of this.suffixes) {
      const normalizedSuffix = suffix.split(path.sep).join("/");
      if (
        normalized === normalizedSuffix ||
        normalized.endsWith(`/${normalizedSuffix}`) ||
        normalized.includes(`/${normalizedSuffix}/`)
      ) {
        return true;
      }
    }
    return false;
  }
}

export const defaultDenylist = new Denylist();
