/**
 * Edit-format selection & fallback (PROJECT_SPEC.md §4.4), driven by the
 * capability profile (§4.9) instead of a fixed choice per model:
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
 * `WHOLE_FILE_LOC_CAP(profile)` scales with effective context so a
 * whole-file rewrite can never blow the context window. No fuzzy
 * edit-distance fallback exists anywhere in this cascade (ADR-002,
 * learned from Aider — see `packages/tools/src/edit-cascade.ts`).
 */

export interface EditFormatProfile {
  diffApplicationAccuracy: number;
  constrainedDecodeAvailable: boolean;
  effectiveContext: number;
}

export interface EditFormatFile {
  isNew: boolean;
  /** Lines of code in the file (0 for a new/empty file). */
  loc: number;
}

export type EditFormatDecision =
  | { format: "search-replace"; grammarEnforced: boolean; tighterReminders: boolean }
  | { format: "whole-file"; chunked: boolean };

/** ~400 LOC at an 8k effective context, scaling linearly, clamped to a sane range. */
export function wholeFileLocCap(effectiveContext: number): number {
  const cap = Math.round((effectiveContext / 8000) * 400);
  return Math.max(100, Math.min(cap, 4000));
}

export function selectEditFormat(profile: EditFormatProfile, file: EditFormatFile): EditFormatDecision {
  const { diffApplicationAccuracy: diffAcc, constrainedDecodeAvailable, effectiveContext } = profile;

  if (constrainedDecodeAvailable && diffAcc >= 0.85) {
    return { format: "search-replace", grammarEnforced: true, tighterReminders: false };
  }
  if (diffAcc >= 0.75) {
    return { format: "search-replace", grammarEnforced: false, tighterReminders: false };
  }
  if (file.isNew || file.loc <= wholeFileLocCap(effectiveContext)) {
    return { format: "whole-file", chunked: false };
  }
  if (diffAcc >= 0.5) {
    return { format: "search-replace", grammarEnforced: false, tighterReminders: true };
  }
  return { format: "whole-file", chunked: true };
}
