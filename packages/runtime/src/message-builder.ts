import type { NormalizedMessage, ToolSchema } from "@clutchcode/providers";
import type { Tool } from "@clutchcode/tools";
import type { CheatFlag, StageResult } from "@clutchcode/verification";

/** Original prompt text — clean-room, per ADR-016 (never adapted from a reference project's system prompt). */
export function buildSystemPrompt(): string {
  return [
    "You are ClutchCode, a local-first coding agent working inside an isolated git worktree.",
    "Use the available tools to inspect the repository before editing anything — never guess file contents.",
    "Make the smallest correct change that satisfies the task. Prefer edit_file (SEARCH/REPLACE) over rewriting whole files.",
    "When you believe the task is complete, stop calling tools and reply with a short summary — an automated,",
    "deterministic verification pipeline (build/test/lint) will run next; you cannot mark your own work successful."
  ].join("\n");
}

export function toolsToSchemas(tools: Map<string, Tool<unknown, unknown>>): ToolSchema[] {
  return [...tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.schema }));
}

/**
 * `adaptationNote` (§4.2, optional) is the capability profile's edit-format
 * guidance (`describeAdaptationGuidance`, §4.4) — sent as its own system
 * message rather than concatenated into `buildSystemPrompt()` so the fixed
 * prompt stays testable/stable on its own, and so a run with no probed
 * profile for its model sends exactly the same messages as before this
 * existed.
 */
export function buildInitialMessages(task: string, adaptationNote?: string): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [{ role: "system", content: buildSystemPrompt() }];
  if (adaptationNote) messages.push({ role: "system", content: adaptationNote });
  messages.push({ role: "user", content: task });
  return messages;
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
