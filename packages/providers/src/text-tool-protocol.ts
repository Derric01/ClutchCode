import type { ToolSchema } from "./types.js";

/**
 * Tool-call text protocol for models without reliable native tool calling
 * (PROJECT_SPEC.md §4.8) — the local-model floor. Informed by Cline's XML
 * tool protocol at the *pattern* level (`research/repos/cline.md`);
 * reimplemented clean-room per LICENSE_AND_REUSE_ANALYSIS.md §3. The exact
 * wire grammar is a bounded design choice the spec leaves open (§29 point
 * 10) — this one is deliberately simple and generic:
 *
 * ```
 * <tool name="edit_file">
 * <arg name="path">src/foo.ts</arg>
 * <arg name="edits">[{"search":"a","replace":"b"}]</arg>
 * </tool>
 * ```
 *
 * Exactly one `<tool>` block per turn. An arg value that looks like JSON
 * (`{`/`[`-prefixed) is parsed as JSON; otherwise it's a raw string. No
 * `<tool>` block at all means the model is done — the same "stop calling
 * tools" convention as native mode.
 */

export const MAX_TOOL_PARSE_RETRIES = 2;

export interface ParsedToolCall {
  name: string;
  argsJson: string;
}

export type TextProtocolParseResult =
  | { kind: "none" } // no <tool> block — the model is done
  | { kind: "call"; call: ParsedToolCall }
  | { kind: "error"; error: string };

const TOOL_BLOCK_RE = /<tool\s+name="([^"]*)"\s*>([\s\S]*?)<\/tool>/;
const ALL_TOOL_BLOCKS_RE = /<tool\s+name="[^"]*"\s*>[\s\S]*?<\/tool>/g;
const ARG_RE = /<arg\s+name="([^"]*)"\s*>([\s\S]*?)<\/arg>/g;

export function renderToolProtocolInstructions(tools: ToolSchema[]): string {
  const toolDescriptions = tools
    .map((t) => `- ${t.name}: ${t.description}\n  parameters (JSON Schema): ${JSON.stringify(t.parameters)}`)
    .join("\n");

  return [
    "Your model does not support native tool calling, so tools are invoked with this exact text protocol.",
    "To call a tool, emit EXACTLY ONE block, and nothing else in that turn:",
    "",
    '<tool name="TOOL_NAME">',
    '<arg name="ARG_NAME">ARG_VALUE</arg>',
    "(one <arg> per parameter)",
    "</tool>",
    "",
    "Rules:",
    "- ARG_VALUE is the raw value for a string/number parameter, or JSON for an object/array parameter (e.g. edit_file's `edits`).",
    "- Exactly one <tool> block per turn — never more than one, never partial.",
    "- When you are done and need no more tools, reply with plain text and NO <tool> block.",
    "",
    "Available tools:",
    toolDescriptions
  ].join("\n");
}

export function parseToolProtocolResponse(text: string): TextProtocolParseResult {
  const blocks = text.match(ALL_TOOL_BLOCKS_RE);
  if (!blocks || blocks.length === 0) return { kind: "none" };
  if (blocks.length > 1) return { kind: "error", error: `expected exactly one <tool> block, found ${blocks.length}` };

  const match = TOOL_BLOCK_RE.exec(blocks[0]!);
  if (!match) return { kind: "error", error: "malformed <tool> block" };
  const [, name, inner] = match;
  if (!name) return { kind: "error", error: "<tool> block is missing a name attribute" };

  const args: Record<string, unknown> = {};
  ARG_RE.lastIndex = 0;
  let argMatch: RegExpExecArray | null;
  while ((argMatch = ARG_RE.exec(inner!))) {
    const [, argName, rawValue] = argMatch;
    if (!argName) continue;
    const trimmed = (rawValue ?? "").trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        args[argName] = JSON.parse(trimmed);
      } catch {
        return { kind: "error", error: `arg "${argName}" looks like JSON but failed to parse` };
      }
    } else {
      args[argName] = trimmed;
    }
  }

  return { kind: "call", call: { name, argsJson: JSON.stringify(args) } };
}
