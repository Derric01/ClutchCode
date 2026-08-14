/**
 * Credential lookup (PROJECT_SPEC.md §5.1). Precedence in the full spec is
 * (1) OS keychain, (2) encrypted file store, (3) environment variables.
 * Phase 1 implements tier 3 only — the documented escape hatch, always
 * available, no native keychain bindings required to build/test. Tiers 1–2
 * are a named Phase-2 gap, not a silent omission.
 */

export interface Credentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

export function loadCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL
  };
}
