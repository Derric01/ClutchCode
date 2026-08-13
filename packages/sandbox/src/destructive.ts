/**
 * Destructive-command detection (PROJECT_SPEC.md §12.1/§12.2).
 *
 * Deliberately conservative pattern list: false positives ("ask" when it
 * wasn't strictly necessary) are cheap; false negatives are not. This is
 * NOT a complete list — §12.7 states plainly a novel destructive command
 * can slip past pattern matching, which is why worktree isolation (§13)
 * exists as a second line of defense.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*|--recursive.*--force|--force.*--recursive)\b/i,
  /\brm\s+-rf?\b/i,
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

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}
