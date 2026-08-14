import { collect, type NormalizedMessage, type Provider, type ToolSchema } from "@clutchcode/providers";
import { applyEditBlock } from "@clutchcode/tools";
import { deriveToolTransport, extractEditBlocks, scoreStopObedience, scoreStructuredOutput, tier } from "./scoring.js";
import type { CapabilityProfile, ToolTransport } from "./types.js";

/**
 * The capability probe (PROJECT_SPEC.md §4.9, `agent models probe`).
 *
 * A short, local, deterministically-scored benchmark run once per new
 * model to populate its capability profile. No human in the loop, no
 * fuzzy judgment — every check is a pure function of the model's raw
 * output (scoring.ts), so the probe is itself model-stubbable via
 * FakeProvider (§2) exactly like the runtime it feeds.
 *
 * Checks (§4.9):
 *   1. Valid search/replace emission           -> diffApplicationAccuracy
 *   2. Stop-condition obedience                -> instructionFidelity
 *   3. Tool-protocol validity                  -> toolTransport
 *   4. JSON structured-output reliability       -> structuredOutputScore
 *   5. Context probe (needle-in-haystack)       -> effectiveContext
 *   6. Loop check (repeated-action sanity)      -> loopCheckPassed
 */

const EDIT_TOOL_NAME = "edit_file";

const EDIT_FILE_SCHEMA: ToolSchema = {
  name: EDIT_TOOL_NAME,
  description: "Apply SEARCH/REPLACE edit blocks to a file.",
  parameters: {
    type: "object",
    required: ["edits"],
    properties: {
      path: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          required: ["search", "replace"],
          properties: { search: { type: "string" }, replace: { type: "string" } }
        }
      }
    }
  }
};

const RUN_TESTS_SCHEMA: ToolSchema = {
  name: "run_tests",
  description: "Run the project's test suite.",
  parameters: { type: "object", properties: {} }
};

const DIFF_ACC_FIXTURE_PATH = "greeter.txt";
const DIFF_ACC_ORIGINAL = ["function greet(name) {", '  return `Hello, ${name}`;', "}", ""].join("\n");

async function ask(provider: Provider, model: string, messages: NormalizedMessage[], tools?: ToolSchema[]) {
  return collect(provider.chat({ model, messages, tools, maxOutputTokens: 512 }));
}

interface DiffAccuracyResult {
  accuracy: number;
  sources: ToolTransport[];
}

/** Check 1 + 3: score exact-applicable SEARCH/REPLACE emission, and classify the transport it arrived on. */
async function runDiffAccuracyTrials(provider: Provider, model: string, trials: number): Promise<DiffAccuracyResult> {
  const sources: ToolTransport[] = [];
  let successes = 0;

  for (let i = 0; i < trials; i++) {
    const res = await ask(
      provider,
      model,
      [
        { role: "system", content: `You edit files using the ${EDIT_TOOL_NAME} tool. Emit exactly one tool call.` },
        {
          role: "user",
          content: `File ${DIFF_ACC_FIXTURE_PATH}:\n\`\`\`\n${DIFF_ACC_ORIGINAL}\`\`\`\n\nChange the greeting from "Hello" to "Hi", using ${EDIT_TOOL_NAME}.`
        }
      ],
      [EDIT_FILE_SCHEMA]
    );

    const extracted = extractEditBlocks(res, EDIT_TOOL_NAME);
    if (!extracted) {
      sources.push("none");
      continue;
    }
    sources.push(extracted.source);

    let content = DIFF_ACC_ORIGINAL;
    let allApplied = true;
    for (const block of extracted.edits) {
      const applied = applyEditBlock(content, block);
      if (!applied.ok) {
        allApplied = false;
        break;
      }
      content = applied.content;
    }
    if (allApplied) successes++;
  }

  return { accuracy: trials === 0 ? 0 : successes / trials, sources };
}

/** Check 2: stop-condition obedience — average of per-trial scoreStopObedience. */
async function checkInstructionFidelity(provider: Provider, model: string, trials: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < trials; i++) {
    const res = await ask(provider, model, [
      { role: "system", content: "Follow instructions exactly and stop immediately when told." },
      { role: "user", content: 'Reply with exactly the single word "DONE" and nothing else — no punctuation, no explanation.' }
    ]);
    total += scoreStopObedience(res.text);
  }
  return trials === 0 ? 0 : total / trials;
}

/** Check 4: JSON structured-output reliability — average of per-trial scoreStructuredOutput. */
async function checkStructuredOutput(provider: Provider, model: string, trials: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < trials; i++) {
    const res = await ask(provider, model, [
      { role: "system", content: "You emit only well-formed JSON, nothing else." },
      { role: "user", content: 'Reply with ONLY a JSON object of the exact shape {"status":"ok","count":<integer>} and nothing else.' }
    ]);
    total += scoreStructuredOutput(res.text);
  }
  return trials === 0 ? 0 : total / trials;
}

function needleForRung(rung: number): string {
  return `CC-${rung}-PROBE`;
}

function buildHaystack(totalChars: number, needle: string): string {
  const filler = "The quick brown fox jumps over the lazy dog. ";
  const half = Math.max(0, Math.floor(totalChars / 2) - filler.length);
  let text = filler.repeat(Math.ceil(half / filler.length));
  text += `\n\nNEEDLE: the secret code is ${needle}.\n\n`;
  const remaining = Math.max(0, totalChars - text.length);
  text += filler.repeat(Math.ceil(remaining / filler.length));
  return text;
}

/** Default context ladder: fractions of the provider's advertised effective context (§4.1 "advertised vs effective"). */
export function defaultContextRungs(approxEffectiveContext: number): number[] {
  const fractions = [0.1, 0.25, 0.5, 0.75, 1.0];
  const rungs = fractions.map((f) => Math.max(200, Math.round(approxEffectiveContext * f)));
  return [...new Set(rungs)];
}

/**
 * Check 5: needle-in-haystack at increasing lengths. Walks the ladder
 * ascending and stops at the first miss (context reliability is assumed
 * roughly monotonic-decreasing with length) — the largest rung that still
 * recalled the needle is the effective-context estimate.
 */
async function checkEffectiveContext(provider: Provider, model: string, rungs: number[], notes: string[]): Promise<number> {
  let best = 0;
  for (const rung of rungs) {
    const needle = needleForRung(rung);
    const res = await ask(provider, model, [
      { role: "system", content: "Find the secret code hidden in the text and reply with only that code." },
      { role: "user", content: buildHaystack(rung, needle) }
    ]);
    if (!res.text.includes(needle)) {
      notes.push(`context recall failed at ~${rung} chars (last confirmed: ${best})`);
      break;
    }
    best = res.usage?.inputTokens ?? Math.round(rung / 4);
  }
  return best;
}

/**
 * Check 6: repeated-identical-action sanity. The model is shown a
 * conversation where it already ran (and passed) a tool call; a model with
 * good instruction fidelity recognizes the task is done and stops instead
 * of blindly repeating the same call (the #1 loop pathology the runtime's
 * own loop-detector, §6.4, exists to catch at runtime).
 */
async function checkLoopSanity(provider: Provider, model: string): Promise<boolean> {
  const res = await ask(
    provider,
    model,
    [
      { role: "system", content: "If the task is already complete, say so and stop — never repeat a finished action." },
      { role: "user", content: "Fix the failing test in math.js." },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "run_tests", argsJson: "{}" }] },
      { role: "tool", toolCallId: "call_1", content: "All tests passed. The bug is fixed." }
    ],
    [RUN_TESTS_SCHEMA]
  );
  return !res.toolCalls.some((c) => c.name === "run_tests");
}

export interface ProbeOptions {
  /** Trials per scored check (§4.9 default: a handful, keeping the whole probe ~2 minutes). */
  trials?: number;
  /** Override the context-probe ladder (chars); defaults from the provider's advertised context. */
  contextRungs?: number[];
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export async function runCapabilityProbe(provider: Provider, model: string, opts: ProbeOptions = {}): Promise<CapabilityProfile> {
  const trials = opts.trials ?? 3;
  const rungs = opts.contextRungs ?? defaultContextRungs(provider.capabilityDefaults.approxEffectiveContext);
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const start = now();

  const diffAccuracy = await runDiffAccuracyTrials(provider, model, trials);
  const instructionFidelity = await checkInstructionFidelity(provider, model, trials);
  const structuredOutputScore = await checkStructuredOutput(provider, model, trials);
  const effectiveContext = await checkEffectiveContext(provider, model, rungs, notes);
  const loopCheckPassed = await checkLoopSanity(provider, model);

  const toolTransport = deriveToolTransport(diffAccuracy.sources);
  if (toolTransport === "none") {
    notes.push(`no parseable ${EDIT_TOOL_NAME} tool call or JSON edit object in any trial — text-protocol emulation (§4.8) is required`);
  }
  if (!loopCheckPassed) {
    notes.push("repeated an already-finished tool call in the loop-sanity check — expect the runtime's loop detector (§6.4) to engage often");
  }

  const end = now();

  return {
    modelId: model,
    providerId: provider.id,
    probedAt: new Date(end).toISOString(),
    probeDurationMs: end - start,
    trials,
    diffApplicationAccuracy: diffAccuracy.accuracy,
    instructionFidelity,
    longPromptInstructionFidelity: tier(instructionFidelity),
    toolTransport,
    structuredOutputScore,
    structuredOutputReliability: tier(structuredOutputScore),
    effectiveContext,
    loopCheckPassed,
    supportsParallelTools: provider.capabilityDefaults.supportsParallelTools,
    constrainedDecodeAvailable: provider.capabilityDefaults.supportsConstrainedDecode,
    notes
  };
}
