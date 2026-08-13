import crypto from "node:crypto";
import { collect, type NormalizedMessage, type Provider, type ToolSchema } from "@clutchcode/providers";
import { applyEditBlock, type EditBlock } from "@clutchcode/tools";
import type { CapabilityProfile, ToolTransport } from "./types.js";

/**
 * The capability probe (PROJECT_SPEC.md §4.9): "a short, local, ~2-minute
 * benchmark run once per new model to populate its capability profile."
 * Every check is deterministic scoring (no human, no LLM-judge) against a
 * real `Provider` — which means it runs identically against `FakeProvider`
 * in tests (scripted "strong"/"weak" model transcripts) as it does against
 * a real API or local server.
 */

export interface ProbeOptions {
  trials?: number;
  /** Testability hook: overrides the random needle generator used by the context probe (defaults to crypto-random). */
  needleGenerator?: () => string;
}

const DEFAULT_TRIALS = 2;
const PROBE_VERSION = 1;
const CONTEXT_PROBE_SIZES = [1_000, 4_000, 8_000, 16_000, 32_000];

const SEARCH_REPLACE_RE = /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>>\s*REPLACE/;

function parseSearchReplaceBlock(text: string): EditBlock | null {
  const m = SEARCH_REPLACE_RE.exec(text);
  if (!m) return null;
  return { search: m[1]!, replace: m[2]! };
}

async function ask(provider: Provider, model: string, content: string, tools?: ToolSchema[]) {
  const messages: NormalizedMessage[] = [{ role: "user", content }];
  return collect(provider.chat({ model, messages, tools }));
}

/** Check 1: valid SEARCH/REPLACE emission — fraction of trials producing an exactly-applicable block. */
async function probeDiffAccuracy(provider: Provider, model: string, trials: number): Promise<number> {
  const original = "function add(a, b) {\n  return a - b;\n}\n";
  const prompt = [
    "Here is a file's content:",
    "```",
    original.trimEnd(),
    "```",
    "Reply with EXACTLY one SEARCH/REPLACE block in this format and nothing else:",
    "<<<<<<< SEARCH",
    "(exact lines to find)",
    "=======",
    "(replacement lines)",
    ">>>>>>> REPLACE",
    "Task: change `return a - b;` to `return a + b;`."
  ].join("\n");

  let successes = 0;
  for (let i = 0; i < trials; i++) {
    const response = await ask(provider, model, prompt);
    const block = parseSearchReplaceBlock(response.text);
    if (block) {
      const result = applyEditBlock(original, block);
      if (result.ok && result.content.includes("return a + b;")) successes++;
    }
  }
  return successes / trials;
}

/** Check 2: stop-condition obedience — does it stop when told, or ramble? */
async function probeInstructionFidelity(provider: Provider, model: string, trials: number): Promise<number> {
  const prompt = "Reply with exactly the single word DONE and absolutely nothing else — no punctuation, no explanation.";
  let successes = 0;
  for (let i = 0; i < trials; i++) {
    const response = await ask(provider, model, prompt);
    if (response.text.trim() === "DONE") successes++;
  }
  return successes / trials;
}

/** Check 3: tool-protocol validity — native tool call vs JSON vs needs-emulation. */
async function probeToolTransport(provider: Provider, model: string): Promise<ToolTransport> {
  const tool: ToolSchema = {
    name: "probe_tool",
    description: 'A probe-only tool. Call it with {"ok": true}.',
    parameters: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
  };
  const response = await ask(provider, model, "Call the probe_tool tool with ok=true.", [tool]);
  if (response.toolCalls.length > 0) return "native";

  try {
    const parsed = JSON.parse(response.text.trim());
    if (parsed && typeof parsed === "object") return "json";
  } catch {
    /* not JSON */
  }
  return "emulation";
}

/** Check 4: JSON structured-output reliability. */
async function probeStructuredOutput(provider: Provider, model: string, trials: number): Promise<number> {
  const prompt = 'Reply with ONLY a JSON object of the exact shape {"answer": <number>}, nothing else. Set answer to 42.';
  let successes = 0;
  for (let i = 0; i < trials; i++) {
    const response = await ask(provider, model, prompt);
    try {
      const parsed = JSON.parse(response.text.trim()) as { answer?: unknown };
      if (typeof parsed.answer === "number") successes++;
    } catch {
      /* invalid JSON */
    }
  }
  return successes / trials;
}

function buildHaystack(size: number, needle: string): string {
  const filler = "The quick brown fox jumps over the lazy dog. ".repeat(Math.ceil(size / 46) + 1);
  const insertPos = Math.floor(filler.length / 2);
  return `${filler.slice(0, insertPos)} The secret code is ${needle}. ${filler.slice(insertPos)}`.slice(0, size + 200);
}

/** Check 5: needle-in-haystack at increasing lengths → an effective-context estimate. */
async function probeEffectiveContext(provider: Provider, model: string, needleGenerator: () => string): Promise<number> {
  let maxSucceeded = 0;
  for (const size of CONTEXT_PROBE_SIZES) {
    const needle = needleGenerator();
    const haystack = buildHaystack(size, needle);
    const response = await ask(provider, model, `${haystack}\n\nWhat is the secret code mentioned above? Reply with ONLY the code, nothing else.`);
    if (response.text.includes(needle)) maxSucceeded = size;
    else break; // sizes are ascending; stop at the first failure
  }
  return maxSucceeded;
}

/** Check 6: loop-check sanity — does the model avoid redundantly repeating an already-satisfied action? */
async function probeLoopCheck(provider: Provider, model: string): Promise<boolean> {
  const prompt =
    "You already ran list_files and got the result: ['a.txt']. The task was just to list the files. " +
    "Do not call any more tools — reply with a one-line summary of what you found.";
  const tool: ToolSchema = { name: "list_files", description: "List files.", parameters: { type: "object", properties: {} } };
  const response = await ask(provider, model, prompt, [tool]);
  return response.toolCalls.length === 0;
}

/**
 * Run the full probe against a real (or fake) provider and produce a
 * persisted-ready `CapabilityProfile`. Roughly 6 + 2*trials round trips.
 */
export async function runCapabilityProbe(provider: Provider, model: string, opts: ProbeOptions = {}): Promise<CapabilityProfile> {
  const trials = opts.trials ?? DEFAULT_TRIALS;
  const needleGenerator = opts.needleGenerator ?? (() => `NEEDLE-${crypto.randomBytes(4).toString("hex")}`);

  const diffAcc = await probeDiffAccuracy(provider, model, trials);
  const instructionFidelity = await probeInstructionFidelity(provider, model, trials);
  const toolTransport = await probeToolTransport(provider, model);
  const structuredOutputReliability = await probeStructuredOutput(provider, model, trials);
  const effectiveContext = await probeEffectiveContext(provider, model, needleGenerator);
  const loopCheckPassed = await probeLoopCheck(provider, model);

  return {
    providerId: provider.id,
    modelId: model,
    diffAcc,
    instructionFidelity,
    toolTransport,
    structuredOutputReliability,
    effectiveContext,
    loopCheckPassed,
    supportsConstrainedDecode: provider.supportsConstrainedDecode,
    probedAt: Date.now(),
    probeVersion: PROBE_VERSION
  };
}
