import type { NormalizedMessage, ToolSchema } from "@clutchcode/providers";
import type { Tool } from "@clutchcode/tools";
import type { CheatFlag, StageResult } from "@clutchcode/verification";
import { selectEditFormat, wholeFileLocCap, type EditFormatProfile } from "@clutchcode/capability";

/**
 * Translates the §4.4 `select_edit_format` decision tree into a per-run
 * prompt directive. The runtime doesn't know which file the model will
 * touch next (that's the model's call, turn by turn), but `diffAcc`,
 * `constrainedDecodeAvailable`, and `effectiveContext` are fixed for the
 * whole run — so this evaluates the two representative cases (a small/new
 * file, and a large existing one) once and phrases the resulting policy in
 * prose, with the LOC cap spelled out so the model can apply it itself.
 */
export function buildEditFormatGuidance(profile: EditFormatProfile): string {
  const cap = wholeFileLocCap(profile.effectiveContext);
  const small = selectEditFormat(profile, { isNew: true, loc: 0 });
  const large = selectEditFormat(profile, { isNew: false, loc: cap + 1 });

  if (small.format === "whole-file" && large.format === "whole-file") {
    return `Your probed diff-application accuracy is low: use write_file (whole-file rewrite) for files up to ~${cap} lines; for larger files, edit_file's SEARCH/REPLACE still applies but expect it to need a retry.`;
  }
  if (large.format === "search-replace" && large.tighterReminders) {
    return `Prefer edit_file (SEARCH/REPLACE) for existing files — your diff-application accuracy is moderate, so make each SEARCH block short and match it character-for-character; write_file is fine for new files or existing files up to ~${cap} lines.`;
  }
  const enforced = large.format === "search-replace" && large.grammarEnforced ? " (grammar-enforced)" : "";
  return `Use edit_file (SEARCH/REPLACE)${enforced} for existing files; write_file is fine for new files.`;
}

/** Original prompt text — clean-room, per ADR-016 (never adapted from a reference project's system prompt). */
export function buildSystemPrompt(editFormatProfile?: EditFormatProfile): string {
  const lines = [
    "You are ClutchCode, a local-first coding agent working inside an isolated git worktree.",
    "Use the available tools to inspect the repository before editing anything — never guess file contents.",
    "Make the smallest correct change that satisfies the task.",
    editFormatProfile ? buildEditFormatGuidance(editFormatProfile) : "Prefer edit_file (SEARCH/REPLACE) over rewriting whole files.",
    "When you believe the task is complete, stop calling tools and reply with a short summary — an automated,",
    "deterministic verification pipeline (build/test/lint) will run next; you cannot mark your own work successful."
  ];
  return lines.join("\n");
}

export function toolsToSchemas(tools: Map<string, Tool<unknown, unknown>>): ToolSchema[] {
  return [...tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.schema }));
}

export function buildInitialMessages(task: string, editFormatProfile?: EditFormatProfile): NormalizedMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(editFormatProfile) },
    { role: "user", content: task }
  ];
}

/** Fed back into the conversation on a verification failure (§14.5 repair loop: "feed the FAILURE, truncated, not the whole log"). */
export function buildRepairMessage(stage: StageResult, failureClass: string): NormalizedMessage {
  const parts = [
    `Verification stage "${stage.stage}" failed (classified as ${failureClass}, exit code ${stage.exitCode}).`,
    stage.stdout ? `stdout:\n${stage.stdout}` : "",
    stage.stderr ? `stderr:\n${stage.stderr}` : "",
    "Analyze this failure and make a targeted fix, then stop calling tools so verification can re-run."
  ].filter(Boolean);
  return { role: "user", content: parts.join("\n\n") };
}

/** §14.6: cheat flags force human review — the model is told plainly, not asked to "fix" its way around the block. */
export function buildCheatReviewMessage(flags: CheatFlag[]): NormalizedMessage {
  const lines = flags.map((f) => `- [${f.rule}] ${f.file}: ${f.message}`);
  return {
    role: "user",
    content: [
      "Automated cheat detection flagged this change and blocked automatic completion:",
      ...lines,
      "This run now requires human review. Do not attempt to work around these checks."
    ].join("\n")
  };
}
