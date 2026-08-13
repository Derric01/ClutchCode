import type { CapabilityProfile } from "./types.js";

/**
 * Edit-format selection & fallback (PROJECT_SPEC.md §4.4):
 *
 * ```
 * select_edit_format(profile, file):
 *     if profile.constrained_decode and profile.diff_acc >= 0.85: return SEARCH_REPLACE (grammar-enforced)
 *     if profile.diff_acc >= 0.75:                                return SEARCH_REPLACE
 *     if file.is_new or file.loc <= WHOLE_FILE_LOC_CAP(profile):  return WHOLE_FILE
 *     if profile.diff_acc >= 0.5:                                 return SEARCH_REPLACE (with tighter reminders)
 *     else:                                                       return WHOLE_FILE (chunked if needed)
 * ```
 *
 * `WHOLE_FILE_LOC_CAP(profile)` scales with effective context (~400 LOC at
 * 8k, larger at 32k) so a whole-file rewrite can never blow the window.
 */

export type EditFormat = "search_replace_grammar_enforced" | "search_replace" | "search_replace_tight" | "whole_file";

export interface FileEditContext {
  isNew: boolean;
  loc: number;
}

const BASE_LOC_CAP = 400;
const BASE_CONTEXT = 8_000;
const MIN_LOC_CAP = 100;

export function wholeFileLocCap(profile: CapabilityProfile): number {
  const scaled = Math.round((profile.effectiveContext / BASE_CONTEXT) * BASE_LOC_CAP);
  return Math.max(MIN_LOC_CAP, scaled);
}

export function selectEditFormat(profile: CapabilityProfile, file: FileEditContext): EditFormat {
  if (profile.supportsConstrainedDecode && profile.diffAcc >= 0.85) return "search_replace_grammar_enforced";
  if (profile.diffAcc >= 0.75) return "search_replace";
  if (file.isNew || file.loc <= wholeFileLocCap(profile)) return "whole_file";
  if (profile.diffAcc >= 0.5) return "search_replace_tight";
  return "whole_file";
}

/** §4.4's repeated-failure fallback: after this many failed edit_file attempts on the same file, downgrade to write_file (whole-file). */
export const MAX_EDIT_RETRIES = 2;

/** Short, capability-driven guidance for the system prompt — the per-file algorithm above, summarized for a model that can't call a function to decide for itself. */
export function buildEditFormatGuidance(profile: CapabilityProfile): string {
  const cap = wholeFileLocCap(profile);
  const pct = Math.round(profile.diffAcc * 100);
  if (profile.diffAcc >= 0.75) {
    return `This model's measured SEARCH/REPLACE accuracy is high (${pct}%) — prefer edit_file for all files.`;
  }
  return (
    `This model's measured SEARCH/REPLACE accuracy is limited (${pct}%) — prefer write_file (a full rewrite) for files ` +
    `under about ${cap} lines or when creating a new file; reserve edit_file's SEARCH/REPLACE for larger existing files, ` +
    "and keep each SEARCH block short and exact. If edit_file fails repeatedly on the same file, switch to write_file."
  );
}
