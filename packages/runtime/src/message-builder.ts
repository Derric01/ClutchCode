import type { NormalizedMessage, ToolSchema } from "@clutchcode/providers";
import type { Tool } from "@clutchcode/tools";
import type { CheatFlag, StageResult } from "@clutchcode/verification";

const PROJECT_MEMORY_CHAR_CAP = 4000;

export interface SystemPromptContext {
  /** AGENTS.md's prose (§10.1). */
  projectMemory?: string;
  /** §4.8: only when the capability profile says this model needs the text-protocol fallback. */
  toolProtocolInstructions?: string;
  /** §4.4: capability-driven edit-format guidance, from `@clutchcode/capability`'s `buildEditFormatGuidance`. */
  editFormatGuidance?: string;
}

/**
 * Original prompt text — clean-room, per ADR-016 (never adapted from a
 * reference project's system prompt). Toolchain commands are already
 * handled separately (§14.2 override); AGENTS.md here is the
 * conventions/glossary/don't-touch prose that has nowhere else to go.
 */
export function buildSystemPrompt(ctx: SystemPromptContext = {}): string {
  const base = [
    "You are ClutchCode, a local-first coding agent working inside an isolated git worktree.",
    "Use the available tools to inspect the repository before editing anything — never guess file contents.",
    "Make the smallest correct change that satisfies the task. Prefer edit_file (SEARCH/REPLACE) over rewriting whole files",
    "unless the edit-format guidance below says otherwise for this model.",
    "When you believe the task is complete, stop calling tools and reply with a short summary — an automated,",
    "deterministic verification pipeline (build/test/lint) will run next; you cannot mark your own work successful."
  ].join("\n");

  const parts = [base];

  if (ctx.editFormatGuidance) {
    parts.push("", "## Edit format guidance (§4.4, calibrated to this model)", ctx.editFormatGuidance);
  }

  if (ctx.projectMemory && ctx.projectMemory.trim().length > 0) {
    const trimmed =
      ctx.projectMemory.length > PROJECT_MEMORY_CHAR_CAP
        ? `${ctx.projectMemory.slice(0, PROJECT_MEMORY_CHAR_CAP)}\n... (truncated; read AGENTS.md directly for the rest)`
        : ctx.projectMemory;
    parts.push("", "## Project memory (AGENTS.md — human-authored, follow it; it overrides your own assumptions)", trimmed);
  }

  if (ctx.toolProtocolInstructions) {
    parts.push("", "## Tool-calling protocol", ctx.toolProtocolInstructions);
  }

  return parts.join("\n");
}

export function toolsToSchemas(tools: Map<string, Tool<unknown, unknown>>): ToolSchema[] {
  return [...tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.schema }));
}

export function buildInitialMessages(task: string, ctx: SystemPromptContext = {}): NormalizedMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(ctx) },
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
