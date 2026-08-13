/**
 * Child-process env scrubbing (PROJECT_SPEC.md §12.3).
 *
 * Child tool/shell processes get a minimal env — no `*_API_KEY`, `AWS_*`,
 * `GH_TOKEN`, etc. — so a spawned command cannot read credentials out of
 * the environment. Only an explicit allowlist passes through.
 */

const ALLOWED_EXACT = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "USER",
  "LOGNAME",
  "PWD",
  "NODE_ENV",
  // pnpm/npm/node runtime needs, harmless to a tool subprocess:
  "npm_config_cache",
  "NODE_PATH"
]);

// Anything matching these patterns is stripped even if it doesn't match a
// deny pattern below — allowlist-first, not denylist-first, is the safer
// default (§12.3: "allowlisted passthrough only").
const DENY_PATTERNS: RegExp[] = [
  /_API_KEY$/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /^AWS_/i,
  /^GH_/i,
  /^GITHUB_/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^AZURE_/i,
  /^GCP_/i,
  /^GOOGLE_APPLICATION_CREDENTIALS$/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i
];

export interface ScrubEnvOptions {
  /** Extra env var names to pass through beyond the default allowlist (e.g. a project-declared safe var). */
  extraAllowed?: string[];
}

export function scrubEnv(source: NodeJS.ProcessEnv, opts: ScrubEnvOptions = {}): Record<string, string> {
  const allowed = new Set([...ALLOWED_EXACT, ...(opts.extraAllowed ?? [])]);
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (DENY_PATTERNS.some((re) => re.test(key))) continue;
    if (allowed.has(key)) out[key] = value;
  }

  return out;
}
