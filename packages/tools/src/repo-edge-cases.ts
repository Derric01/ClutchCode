/**
 * Path-matching helpers for PROJECT_SPEC.md §13.4's submodule/LFS cases —
 * pure functions over the `submodulePaths`/`lfsPatterns` a `ToolContext`
 * carries (computed once per run from repo metadata, §13.4), so every
 * fs tool call doesn't need to shell out to git.
 */

function normalize(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** True if `relPath` is `submodulePath` itself or lives underneath it. */
export function isInsideAnySubmodule(relPath: string, submodulePaths: string[]): boolean {
  const target = normalize(relPath);
  return submodulePaths.some((sp) => {
    const spNorm = normalize(sp).replace(/\/+$/, "");
    return target === spNorm || target.startsWith(`${spNorm}/`);
  });
}

/**
 * A deliberately small glob matcher — `*` (non-slash run), `**` (any run,
 * incl. slashes), `?` (one non-slash char), else literal — enough for the
 * `.gitattributes` patterns LFS actually uses (`*.psd`, `assets/**`,
 * `vendor/*.bin`). Not a general gitignore engine (see `edge-cases.ts` in
 * `@clutchcode/git` for the deliberate scope note).
 */
function globToRegExp(pattern: string): RegExp {
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      src += ".*";
      i++;
    } else if (c === "*") {
      src += "[^/]*";
    } else if (c === "?") {
      src += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      src += `\\${c}`;
    } else {
      src += c;
    }
  }
  return new RegExp(`^${src}$`);
}

/** A pattern containing `/` is anchored to the repo root (like `.gitattributes`); a bare pattern like `*.psd` matches by basename anywhere in the tree (like `.gitignore`). */
export function matchesLfsPattern(relPath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const target = normalize(relPath);
  const basename = target.split("/").pop() ?? target;
  return patterns.some((pattern) => {
    const cleanPattern = pattern.replace(/^\/+/, "");
    const anchored = cleanPattern.includes("/");
    const re = globToRegExp(cleanPattern);
    return anchored ? re.test(target) : re.test(basename);
  });
}

/**
 * The LFS pointer file format (https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md)
 * — a small text stand-in for the real (potentially huge) binary content
 * git-lfs's smudge filter would otherwise check out. Pure text parsing, no
 * git I/O, which is why it lives here next to `matchesLfsPattern` rather
 * than in `@clutchcode/git` (see that package's `edge-cases.ts` for the
 * .gitattributes-reading half of §13.4's LFS handling).
 */
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

export function isLfsPointerContent(content: string): boolean {
  return content.startsWith(LFS_POINTER_PREFIX);
}

/** Parses `oid sha256:<hex>` / `size <bytes>` out of an LFS pointer file's body, for a useful message instead of dumping the pointer text verbatim. */
export function parseLfsPointer(content: string): { oid?: string; size?: number } {
  const oidMatch = content.match(/^oid sha256:([0-9a-f]{64})$/m);
  const sizeMatch = content.match(/^size (\d+)$/m);
  return {
    oid: oidMatch?.[1],
    size: sizeMatch ? Number(sizeMatch[1]) : undefined
  };
}

/**
 * A cheap, standard heuristic (the same one git/grep use): a NUL byte in
 * the first few KB means binary content. §13.4/§4.5: "large binaries not
 * read into context" — this is what actually enforces that for a real
 * checked-out binary (LFS-smudged or not), not just LFS pointer files.
 */
const BINARY_SNIFF_BYTES = 8000;

export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}
