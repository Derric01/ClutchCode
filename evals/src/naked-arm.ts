import fs from "node:fs";
import path from "node:path";

import { buildProvider, loadCredentials, type Credentials, type ProviderKind } from "@clutchcode/agent-api";
import { isSafeRelPath } from "@clutchcode/git";
import { collect, type CollectedResponse, type Delta, type NormalizedMessage } from "@clutchcode/providers";

import { checkTaskRequirements, materializeTaskRepo, runOracle, type EvalCategory, type EvalTask } from "./eval-task.js";
import { makeTempDir } from "./fixture-repo.js";

/**
 * The **naked arm** of the §16.4 A/B (PROJECT_SPEC.md §16.1, §16.4).
 *
 * §16.1 states the product's central claim: *"VTCR of a 14B-class local
 * model **with the ClutchCode harness** materially exceeds the same
 * model's single-shot/naked VTCR."* §16.4 makes it a concrete experiment:
 * "model X naked single-shot vs model X under ClutchCode". `eval-runner.ts`
 * measures the ClutchCode arm. This file is the other one, and without it
 * no VTCR *delta* can honestly be quoted.
 *
 * ## What "naked" means here, precisely
 *
 * One model call. The task text plus the repository's files in the prompt.
 * Whole-file replies parsed out of the reply text and written straight to
 * disk. Then the **same held-out oracle** the ClutchCode arm is graded by.
 *
 * Nothing from the harness participates:
 *
 * | ClutchCode arm | naked arm |
 * |---|---|
 * | tools (`read_file`, `search`, `shell`, `edit_file`) | none — the prompt is all the model gets |
 * | the §6 state machine and its repair iterations | one call, whatever comes back |
 * | §14 deterministic gate + its failure fed back (§14.5) | no gate, no feedback |
 * | §14.6 cheat detection, §14.7 approval contract | neither |
 * | §4.4 edit-format selection + SEARCH/REPLACE cascade | one fixed whole-file format |
 * | §4.5 context budgeting, §4.9 capability probe | a flat, generous output cap |
 * | §13 worktree isolation | writes directly into the delivered repo |
 *
 * ## Fairness is the whole point, so it is engineered for
 *
 * A rigged baseline would make the delta meaningless, and the failure mode
 * is asymmetric: it is very easy to accidentally build a naked arm that
 * loses for reasons that have nothing to do with the harness. Three
 * deliberate choices push the other way:
 *
 * 1. **The naked arm gets the whole repository in its prompt** (up to a
 *    stated byte budget), not a retrieved subset. Retrieval is a harness
 *    feature (§9); withholding files would be scoring §9 twice.
 * 2. **The reply parser is deliberately tolerant** — it accepts every
 *    common way a model labels a whole-file block (a bare path line, a
 *    path in the fence info string, a backticked path, a `File:` prefix, a
 *    markdown heading). A picky parser would turn a formatting quirk into
 *    a scored failure, and the delta would be measuring our parser.
 * 3. **The naked arm is graded on the held-out oracle alone.** The
 *    ClutchCode arm additionally has to pass its own deterministic gate
 *    with zero cheat flags (§14.7) before its oracle result even counts.
 *    That asymmetry favours the naked arm, which makes the published delta
 *    a conservative floor rather than a flattering one.
 *
 * What is *not* claimed: nothing in this file has been run against a real
 * 14B local model. This environment has no model server and no API key, so
 * every scored run here is against scripted replies over a real HTTP
 * endpoint. The machinery is verified; the number §16.4 asks for is not
 * measured. See `docs/EVAL_METHODOLOGY.md`.
 */

// ---------------------------------------------------------------------------
// 1. Reading the repository into a prompt
// ---------------------------------------------------------------------------

export interface NakedRepoFile {
  /** Repository-relative, POSIX-separated. */
  path: string;
  content: string;
}

export type OmissionReason = "binary" | "too-large" | "total-budget";

export interface CollectedRepoFiles {
  files: NakedRepoFile[];
  /**
   * Files deliberately left out of the prompt, and why. Reported rather
   * than dropped silently: a naked arm that scores badly because its
   * prompt was quietly truncated is a measurement artifact, and a delta
   * built on one would be wrong in the direction that flatters us.
   */
  omitted: Array<{ path: string; reason: OmissionReason }>;
}

export interface CollectRepoFilesOptions {
  /** Skip any single file larger than this. Default 64 KiB. */
  maxFileBytes?: number;
  /** Stop adding files once the prompt's file content passes this. Default 400 KiB. */
  maxTotalBytes?: number;
  /** Directory names never descended into. */
  ignoreDirs?: string[];
}

const DEFAULT_IGNORE_DIRS = [".git", "node_modules", "__pycache__", ".venv", "venv", "dist", ".pytest_cache", ".ruff_cache", ".mypy_cache"];
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 400 * 1024;

/** A NUL byte anywhere in the file is the standard, cheap "this is not text" test — the same one `git diff` uses. */
function looksBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

/**
 * Read a repository into the list of files a naked prompt will carry.
 *
 * Ordering is `localeCompare` on the repository-relative path, not
 * filesystem order, so two runs of the same task build a byte-identical
 * prompt — a benchmark whose prompt depends on `readdir` order is not
 * reproducible.
 */
export function collectRepoFiles(repoPath: string, opts: CollectRepoFilesOptions = {}): CollectedRepoFiles {
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const ignoreDirs = new Set(opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS);

  const candidates: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        candidates.push(childRel);
      }
      // Symlinks and anything else are skipped: a naked prompt is text,
      // and following a link out of the repository is exactly the shape
      // this repo validates against everywhere else.
    }
  };
  walk(repoPath, "");
  candidates.sort((a, b) => a.localeCompare(b));

  const files: NakedRepoFile[] = [];
  const omitted: CollectedRepoFiles["omitted"] = [];
  let total = 0;

  for (const rel of candidates) {
    const buf = fs.readFileSync(path.join(repoPath, rel));
    if (buf.byteLength > maxFileBytes) {
      omitted.push({ path: rel, reason: "too-large" });
      continue;
    }
    if (looksBinary(buf)) {
      omitted.push({ path: rel, reason: "binary" });
      continue;
    }
    if (total + buf.byteLength > maxTotalBytes) {
      omitted.push({ path: rel, reason: "total-budget" });
      continue;
    }
    total += buf.byteLength;
    files.push({ path: rel, content: buf.toString("utf8") });
  }

  return { files, omitted };
}

// ---------------------------------------------------------------------------
// 2. The prompt
// ---------------------------------------------------------------------------

/**
 * Written from scratch for this harness (ADR-016: our prompts are ours;
 * reference projects' prompt text is study-only and never copied). It is
 * deliberately short and mechanical — a baseline should not be carrying
 * prompt engineering the ClutchCode arm does not also get.
 */
export const NAKED_SYSTEM_PROMPT = [
  "You are an expert software engineer. You are given a task and the complete contents of a small repository.",
  "You get exactly one reply: there are no tools, no test results, and no second turn.",
  "",
  "Reply with the full new contents of every file you need to change or create, and nothing else.",
  "Use exactly this form for each file — the repository-relative path on its own line, then a fenced block:",
  "",
  "path/to/file.ext",
  "```",
  "<the complete new contents of that file>",
  "```",
  "",
  "Rules:",
  "- Emit the ENTIRE file, never a diff, a patch, or an excerpt with elisions.",
  "- Emit a block only for files you actually change or create; leave everything else alone.",
  "- Paths are relative to the repository root.",
  "- Do not add commentary before, between, or after the blocks."
].join("\n");

/** The delimiter used to present input files. Not a code fence, so a file that itself contains fences cannot terminate its own section. */
function fileSection(file: NakedRepoFile): string {
  return `----- BEGIN FILE ${file.path} -----\n${file.content}${file.content.endsWith("\n") ? "" : "\n"}----- END FILE ${file.path} -----`;
}

/** Build the single request the naked arm sends. Pure — directly assertable without a provider. */
export function buildNakedPrompt(task: EvalTask, files: NakedRepoFile[]): NormalizedMessage[] {
  const body = [
    "# Task",
    "",
    task.prompt,
    "",
    `# Repository (${files.length} file${files.length === 1 ? "" : "s"})`,
    "",
    ...files.map(fileSection)
  ].join("\n");

  return [
    { role: "system", content: NAKED_SYSTEM_PROMPT },
    { role: "user", content: body }
  ];
}

// ---------------------------------------------------------------------------
// 3. Parsing whole-file blocks out of the reply
// ---------------------------------------------------------------------------

export interface ParsedWholeFile {
  path: string;
  content: string;
}

export interface WholeFileParseResult {
  files: ParsedWholeFile[];
  /** Fenced blocks whose file could not be identified — the commonest way a naked single-shot fails to land at all. */
  unlabeledBlocks: number;
  /** Every fenced block seen, labeled or not. */
  totalBlocks: number;
}

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/;

/**
 * Does this token look like a file path rather than a language tag?
 *
 * The discriminator is an extension or a directory separator: `js`,
 * `python` and `javascript` have neither, `src/slug.js` and `deps.json`
 * have one. Deliberately conservative in the direction that costs the
 * naked arm nothing — a block whose path is not recognized here still gets
 * a second chance from the preceding label line.
 */
function looksLikePath(s: string): boolean {
  if (s.length === 0 || s.length > 200) return false;
  if (!/^[A-Za-z0-9._][A-Za-z0-9._\-/]*$/.test(s)) return false;
  return /\.[A-Za-z0-9]+$/.test(s) || s.includes("/");
}

/**
 * Normalize the shapes a model uses for a repository-relative path.
 * Generous on purpose (see the fairness note at the top): `./src/x.js` and
 * `/src/x.js` both mean "src/x.js" to a model writing a reply, and
 * treating either as unparseable would score a formatting habit as a
 * failure. Safety is not weakened by this — `applyWholeFileBlocks`
 * validates independently, and is tested against traversal directly.
 */
function normalizeCandidatePath(s: string): string {
  let out = s.trim();
  while (out.startsWith("./")) out = out.slice(2);
  if (out.startsWith("/")) out = out.slice(1);
  return out;
}

function pathFromInfoString(info: string): string | undefined {
  for (const rawToken of info.split(/\s+/)) {
    // `title="src/slug.js"` / `name=src/slug.js` — take the value half.
    const token = rawToken.includes("=") ? rawToken.slice(rawToken.indexOf("=") + 1) : rawToken;
    const cleaned = normalizeCandidatePath(token.replace(/^[`'"]+|[`'"]+$/g, ""));
    if (looksLikePath(cleaned)) return cleaned;
  }
  return undefined;
}

function pathFromLabelLine(line: string): string | undefined {
  let s = line.trim();
  s = s.replace(/^#{1,6}\s+/, ""); // markdown heading
  s = s.replace(/^[-*+]\s+/, ""); // list bullet
  s = s.replace(/^\*\*(.*)\*\*$/, "$1"); // bold
  s = s.replace(/^(?:file|filename|path)\s*[:=]\s*/i, "");
  s = s.trim().replace(/[:,]+$/, "");
  s = s.replace(/^[`'"]+|[`'"]+$/g, "");
  const cleaned = normalizeCandidatePath(s);
  return looksLikePath(cleaned) ? cleaned : undefined;
}

/** How many lines back from a fence a label is still considered that block's label. */
const LABEL_LOOKBACK_LINES = 4;

/**
 * Parse the reply into whole-file writes.
 *
 * A block is closed by a line consisting only of the same fence character
 * repeated at least as many times as the opener — the CommonMark rule.
 * That means a file whose own content contains a longer fence run round-
 * trips, but a file containing a fence run of the same length does not;
 * documented rather than hidden, and irrelevant to a suite of `.js`/`.py`
 * fixtures.
 *
 * When the same path appears twice, the **last** block wins: a model that
 * emits a file and then corrects itself means the correction.
 */
export function parseWholeFileBlocks(text: string): WholeFileParseResult {
  const lines = text.split("\n");
  const byPath = new Map<string, string>();
  let unlabeledBlocks = 0;
  let totalBlocks = 0;

  let i = 0;
  while (i < lines.length) {
    const open = FENCE_RE.exec(lines[i] ?? "");
    if (!open) {
      i += 1;
      continue;
    }
    const marker = open[1] ?? "```";
    const info = open[2] ?? "";
    const fenceChar = marker[0]!;
    const fenceLen = marker.length;

    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j += 1) {
      const candidate = (lines[j] ?? "").trim();
      if (candidate.length >= fenceLen && candidate.split("").every((c) => c === fenceChar)) {
        closed = true;
        break;
      }
      body.push(lines[j] ?? "");
    }
    // An unterminated fence at the end of a truncated reply still carries
    // whatever the model managed to emit; refusing it would throw away the
    // one thing a `length`-finished naked reply actually produced.
    totalBlocks += 1;

    let filePath = pathFromInfoString(info);
    if (filePath === undefined) {
      for (let back = i - 1; back >= 0 && back >= i - LABEL_LOOKBACK_LINES; back -= 1) {
        const line = lines[back] ?? "";
        if (line.trim().length === 0) continue;
        filePath = pathFromLabelLine(line);
        break;
      }
    }

    if (filePath === undefined) {
      unlabeledBlocks += 1;
    } else {
      const joined = body.join("\n");
      // A fenced block cannot express whether the file ends with a
      // newline, so the POSIX text-file convention is applied.
      byPath.set(filePath, joined.length === 0 || joined.endsWith("\n") ? joined : `${joined}\n`);
    }

    i = closed ? j + 1 : j;
  }

  return { files: [...byPath].map(([p, content]) => ({ path: p, content })), unlabeledBlocks, totalBlocks };
}

// ---------------------------------------------------------------------------
// 4. Applying them
// ---------------------------------------------------------------------------

export interface ApplyOutcome {
  written: string[];
  /** Paths refused, with the reason — never written, never silently ignored. */
  rejected: Array<{ path: string; reason: string }>;
}

/**
 * Write parsed whole-file blocks into the delivered repository.
 *
 * The paths come from a language model, so they are untrusted text that is
 * about to become a filesystem path — the exact class this repo validates
 * at every entry point rather than at one call site. It reuses
 * `@clutchcode/git`'s shared `isSafeRelPath` (the same validator
 * `SnapshotBackup` uses) instead of growing a fourth private copy, plus a
 * `.git` guard: rewriting the repository's own metadata is never a
 * legitimate "file I changed", and a delivered repo is still a real git
 * repo the oracle runs inside.
 */
export function applyWholeFileBlocks(repoPath: string, files: ParsedWholeFile[]): ApplyOutcome {
  const root = path.resolve(repoPath);
  const written: string[] = [];
  const rejected: ApplyOutcome["rejected"] = [];

  for (const file of files) {
    if (!isSafeRelPath(file.path)) {
      rejected.push({ path: file.path, reason: "not a safe repository-relative path" });
      continue;
    }
    if (file.path.split(/[/\\]/)[0] === ".git") {
      rejected.push({ path: file.path, reason: "refuses to write into .git" });
      continue;
    }
    const resolved = path.resolve(root, file.path);
    // Defense in depth: the structural check above should already make
    // this unreachable, but the containment re-check is what actually
    // guarantees the write lands inside the repository.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      rejected.push({ path: file.path, reason: "resolves outside the repository" });
      continue;
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, file.content, "utf8");
    written.push(file.path);
  }

  return { written, rejected };
}

// ---------------------------------------------------------------------------
// 5. One scored naked run
// ---------------------------------------------------------------------------

export interface NakedTaskResult {
  taskId: string;
  category: EvalCategory;
  language: string;
  /** Which repetition of the §16.4 A/B this run was — 1-based. */
  repetition: number;
  /**
   * The naked arm's VTCR numerator: the held-out oracle passed against the
   * delivered repository. There is no gate and no cheat detector to also
   * satisfy — see the fairness note at the top of this file.
   */
  solved: boolean;
  oracleExitCode: number | null;
  /** Fenced blocks in the reply, and what became of them. */
  blocksEmitted: number;
  unlabeledBlocks: number;
  filesWritten: number;
  filesRejected: number;
  /** Always 1 for a completed naked run. Recorded, not assumed: "single-shot" is the defining property of this arm. */
  modelCalls: number;
  promptFiles: number;
  promptChars: number;
  tokens: number;
  wallclockMs: number;
  finishReason: string;
  /** Set when the run threw instead of finishing — an environment/provider failure, reported rather than scored as a model failure. */
  error?: string;
}

export interface NakedRunOptions {
  providerKind: ProviderKind;
  model: string;
  baseUrl?: string;
  /** Parent directory for the scratch repo. A fresh temp dir by default. */
  workDir?: string;
  keepWorkDir?: boolean;
  /** 1-based repetition index (§16.4's "K seeds"). Default 1. */
  repetition?: number;
  /**
   * Output cap for the single call. Deliberately a flat, generous number
   * rather than §4.5's context budgeter: budgeting is one of the harness
   * features under test, so the baseline must not inherit it. 8192 is
   * comfortably more than a whole-file rewrite of anything in this suite.
   */
  maxOutputTokens?: number;
  temperature?: number;
  promptFiles?: CollectRepoFilesOptions;
  /** Defaults to `loadCredentials()` (§5.1), exactly as `Agent.run` does. */
  credentials?: Credentials;
  onTaskResult?: (result: NakedTaskResult) => void;
}

export const DEFAULT_NAKED_MAX_OUTPUT_TOKENS = 8192;

function baseResult(task: EvalTask, repetition: number): NakedTaskResult {
  return {
    taskId: task.id,
    category: task.category,
    language: task.language,
    repetition,
    solved: false,
    oracleExitCode: null,
    blocksEmitted: 0,
    unlabeledBlocks: 0,
    filesWritten: 0,
    filesRejected: 0,
    modelCalls: 0,
    promptFiles: 0,
    promptChars: 0,
    tokens: 0,
    wallclockMs: 0,
    finishReason: "error"
  };
}

export interface RunNakedTaskResult {
  result: NakedTaskResult;
  /** Where the task ran — present only when `keepWorkDir` was set. */
  workDir?: string;
}

/** Run one task through the naked arm: materialize → one model call → write → held-out oracle. */
export async function runNakedTask(task: EvalTask, opts: NakedRunOptions): Promise<RunNakedTaskResult> {
  const repetition = opts.repetition ?? 1;
  const parent = opts.workDir ?? makeTempDir("clutchcode-naked-run-");
  const taskDir = path.join(parent, `${task.id}-r${repetition}`);
  const repoPath = path.join(taskDir, "repo");
  const startedAt = Date.now();

  const finish = (result: NakedTaskResult): RunNakedTaskResult => {
    opts.onTaskResult?.(result);
    return { result, workDir: opts.keepWorkDir ? taskDir : undefined };
  };

  // Same refusal as the ClutchCode arm: a missing interpreter says nothing
  // about the model, and scoring it as a failure would depress one arm's
  // VTCR for an environment reason — which in an A/B does not cancel out,
  // it manufactures a delta.
  const requirements = checkTaskRequirements(task);
  if (!requirements.ok) {
    return finish({
      ...baseResult(task, repetition),
      error: `not run: this host is missing ${requirements.missing.join(", ")} (declared in the task's "requires")`
    });
  }

  try {
    materializeTaskRepo(task, repoPath);

    const collected = collectRepoFiles(repoPath, opts.promptFiles);
    const messages = buildNakedPrompt(task, collected.files);
    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

    const provider = buildProvider({
      kind: opts.providerKind,
      baseUrl: opts.baseUrl,
      credentials: opts.credentials ?? loadCredentials()
    });

    let modelCalls = 0;
    let response: CollectedResponse;
    // A provider failure is reported as an *error*, never quietly scored
    // as an unsolved task: an unreachable endpoint or a 500 is not the
    // model failing the task, and in an A/B a silently-unsolved arm does
    // not cancel out — it manufactures a delta. `collect` folds an error
    // delta into `finishReason: "error"` and drops the message, so the
    // stream is watched on the way past to keep it.
    let providerError: string | undefined;
    const watchErrors = async function* (stream: AsyncGenerator<Delta, void, void>): AsyncGenerator<Delta, void, void> {
      for await (const delta of stream) {
        if (delta.type === "error" && providerError === undefined) providerError = delta.message;
        yield delta;
      }
    };

    try {
      modelCalls = 1;
      response = await collect(
        watchErrors(
          provider.chat({
            model: opts.model,
            messages,
            // No `tools`: a naked single-shot has none. This is the line
            // that makes the arm naked, so it is stated by omission on
            // purpose and asserted in `naked-arm.test.ts`.
            maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_NAKED_MAX_OUTPUT_TOKENS,
            temperature: opts.temperature
          })
        )
      );
    } catch (err) {
      return finish({
        ...baseResult(task, repetition),
        modelCalls,
        promptFiles: collected.files.length,
        promptChars,
        wallclockMs: Date.now() - startedAt,
        error: (err as Error).message
      });
    }

    const parsed = parseWholeFileBlocks(response.text);
    const applied = applyWholeFileBlocks(repoPath, parsed.files);
    const oracle = runOracle(task, repoPath);

    return finish({
      ...baseResult(task, repetition),
      solved: oracle.passed,
      oracleExitCode: oracle.exitCode,
      blocksEmitted: parsed.totalBlocks,
      unlabeledBlocks: parsed.unlabeledBlocks,
      filesWritten: applied.written.length,
      filesRejected: applied.rejected.length,
      modelCalls,
      promptFiles: collected.files.length,
      promptChars,
      tokens: (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0),
      wallclockMs: Date.now() - startedAt,
      finishReason: response.finishReason,
      ...(response.finishReason === "error"
        ? { error: providerError ?? "the provider stream ended in an error with no message" }
        : {})
    });
  } finally {
    if (!opts.keepWorkDir) fs.rmSync(taskDir, { recursive: true, force: true });
  }
}
