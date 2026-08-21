/**
 * Destructive-command detection (PROJECT_SPEC.md §12.1/§12.2).
 *
 * Deliberately conservative pattern list: false positives ("ask" when it
 * wasn't strictly necessary) are cheap; false negatives are not. This is
 * NOT a complete list — §12.7 states plainly a novel destructive command
 * can slip past pattern matching, which is why worktree isolation (§13)
 * exists as a second line of defense.
 *
 * `rm` specifically is handled by `isDestructiveRm` below rather than a
 * fixed set of regex alternatives — see its doc comment for why (a real
 * gap caught in a later review round: every equivalent spelling of
 * `rm -rf` needed its own alternative, and several common, non-adversarial
 * ones — just a different flag order or a mix of short/long forms — slipped
 * through untouched).
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+push\s+.*-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-\w*[dfx]\w*/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /\bchmod\s+-R\s+000\b/i,
  /\bchown\s+-R\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i
];

/**
 * `rm` invocations that combine recursive + force (equivalent to `rm -rf`),
 * or that are recursive on their own, are dangerous regardless of exactly
 * how the flags are spelled — but a fixed regex alternative list only ever
 * matches the concrete spellings someone thought to enumerate. Reproduced
 * for real: `rm -f -r x`, `rm --force -r x`, and `rm -f --recursive x` are
 * all functionally identical to `rm -rf x` (POSIX/GNU option parsing
 * doesn't care about flag order or short/long mixing), and `rm --recursive
 * x` is functionally identical to the already-flagged `rm -r x` — none of
 * these four were matched by the previous pure-regex approach. Fixed by
 * tokenizing each `rm` invocation's own argument list (split from any
 * other command in a `;`/`&&`/`||`/`|`/newline-separated pipeline, so
 * flags on one command don't bleed into another) and checking, independent
 * of order or short/long form, whether it requests recursion at all —
 * closing the whole class of reordering/mixing bypasses at once instead of
 * enumerating more concrete spellings one at a time.
 */
function isDestructiveRm(command: string): boolean {
  const segments = command.split(/;|&&|\|\||\||\n/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter((t) => t.length > 0);
    const rmIdx = tokens.findIndex((t) => t === "rm" || t.endsWith("/rm"));
    if (rmIdx === -1) continue;

    // Recursive alone is already how the old short-form `-r` pattern
    // treated it (a non-interactive `rm -r` deletes a whole tree with no
    // prompt, since `rm` only ever pauses for confirmation under `-i`),
    // so recursive-alone stays destructive here too, regardless of
    // short/long form — force+recursive is just a stricter subset of
    // that. Force-alone (no recursion, e.g. `rm -f singlefile`) is left
    // unflagged, same as before this fix.
    let recursive = false;
    for (const tok of tokens.slice(rmIdx + 1)) {
      if (tok === "--") break; // end-of-options marker — nothing after this is a flag
      if (tok === "--recursive") recursive = true;
      else if (tok.length > 1 && tok.startsWith("-") && !tok.startsWith("--")) {
        for (const ch of tok.slice(1)) {
          if (ch === "r" || ch === "R") recursive = true;
        }
      }
    }
    if (recursive) return true;
  }
  return false;
}

export function isDestructiveCommand(command: string): boolean {
  if (isDestructiveRm(command)) return true;
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}
