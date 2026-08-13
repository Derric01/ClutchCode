/**
 * Secret redaction as a pipeline stage (PROJECT_SPEC.md §5.2).
 *
 * Every string crossing a boundary (model context assembly, tool-output
 * ingestion, transcript/event writes, crash reports) must pass through
 * `Redactor.scrub()`. The canary test in this package's test file asserts a
 * known secret value never survives a scrub, across all four boundaries.
 */

// Provider-prefix patterns, ordered most-specific first. Kept intentionally
// simple/robust over "clever": a false positive (over-redaction) is cheap;
// a false negative (a leaked key) is not.
const PATTERN_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "openai", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "xai", re: /\bxai-[A-Za-z0-9_-]{20,}\b/g },
  { name: "google", re: /\bAIza[A-Za-z0-9_-]{30,}\b/g },
  // Generic high-entropy bearer-style token, catch-all fallback.
  { name: "generic", re: /\b[A-Za-z0-9_-]{32,}\b/g }
];

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export interface RedactionResult {
  text: string;
  redactedCount: number;
}

export class Redactor {
  private readonly knownSecrets: string[] = [];

  /** Register a known credential value (from the credential store) for exact-match redaction. */
  registerSecret(value: string): void {
    if (value && value.length >= 4) this.knownSecrets.push(value);
  }

  /**
   * Scrub a string. Order: exact known-secret matches first (highest
   * precision), then provider-prefix patterns, then a high-entropy generic
   * fallback (only fires on tokens that look random, to bound false
   * positives on ordinary identifiers).
   */
  scrub(input: string): RedactionResult {
    let text = input;
    let redactedCount = 0;

    for (const secret of this.knownSecrets) {
      if (secret && text.includes(secret)) {
        const occurrences = text.split(secret).length - 1;
        redactedCount += occurrences;
        text = text.split(secret).join("«REDACTED:known-secret»");
      }
    }

    for (const rule of PATTERN_RULES) {
      text = text.replace(rule.re, (match) => {
        if (rule.name === "generic") {
          // Only redact generic 32+ char tokens that are plausibly a secret:
          // high entropy AND not "REDACTED" itself (avoid re-matching our own output).
          if (match.includes("REDACTED")) return match;
          if (shannonEntropy(match) < 3.5) return match;
        }
        redactedCount += 1;
        return `«REDACTED:${rule.name}»`;
      });
    }

    return { text, redactedCount };
  }
}
