import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * The eval task format behind the per-model scoreboard (PROJECT_SPEC.md
 * §16.3a bullet 3, §16.3b).
 *
 * A task is a **directory**, not a blob of embedded strings, so every
 * fixture file is a real file on disk that can be read, run, linted and
 * diffed by hand:
 *
 * ```
 * evals/suite/<task-id>/
 *   task.json    metadata: id, category, language, prompt, solutionPaths, oracle command
 *   repo/        the starting repository — copied into a fresh git repo and committed
 *   oracle/      the HELD-OUT check — copied into the delivered repo only AFTER the run
 *   solution/    the reference ("golden") solution — copied over repo/ by the validity test
 * ```
 *
 * The held-out oracle is the load-bearing part. The agent's own
 * deterministic gate (§14.1) runs the repository's own commands, which the
 * agent can see and edit; the oracle is copied in after the run finishes,
 * so it grades the delivered result against a check the model never had
 * access to — the same reason SWE-bench applies its golden *test* patch
 * after the model's patch rather than before. Without it, a task whose
 * gate is already green (see `node-feature-slugify`) would score a point
 * for an agent that changed nothing at all.
 */

export const EVAL_CATEGORIES = ["bug-fix", "feature", "refactor", "test-add", "dependency-bump"] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export interface EvalTask {
  id: string;
  category: EvalCategory;
  /** Display label for the scoreboard ("node", "python", …) — not used to pick a toolchain; §14.2 detection does that from the repo itself. */
  language: string;
  description: string;
  /** The task text handed to the agent verbatim, exactly as a user would type it. */
  prompt: string;
  /**
   * The file(s) a correct solution has to touch. Used only for §16.2's
   * retrieval-sufficiency metric — "did the run ever look at the file it
   * needed?" — never to grade correctness, which is the oracle's job alone.
   */
  solutionPaths: string[];
  /**
   * Whether the repository's *own* deterministic gate (§14.1) is red or
   * green before the agent touches anything. Declared, not inferred, and
   * enforced by the suite-validity test — because the two kinds of task
   * measure different things: a `red` task gives the agent a failing gate
   * to chase, while a `green` one gives it no signal at all, so only the
   * held-out oracle can tell a real solution from a no-op. A suite made
   * entirely of `red` tasks would silently overstate VTCR.
   */
  startingGate: "red" | "green";
  /**
   * Binaries this task genuinely cannot run without — its toolchain
   * (`pytest`, `ruff`) or its oracle's interpreter. Checked by actually
   * **running** each one, not by looking for it on PATH: the same lesson
   * `detectBwrapUsable` exists for. A task whose requirements aren't met is
   * skipped by the validity test and refused by the runner, rather than
   * scored as a failure the model caused — a missing interpreter says
   * nothing about the agent.
   */
  requires: string[];
  /** argv for the held-out check, run from the delivered repository's root. No shell: the array is exec'd directly. */
  oracleCommand: string[];
  /** Absolute path to the task directory this was loaded from. */
  dir: string;
}

export interface OracleResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const ORACLE_TIMEOUT_MS = 120_000;

function fail(source: string, message: string): never {
  throw new Error(`invalid eval task at ${source}: ${message}`);
}

/**
 * Rejects a path that would escape the task directory when joined onto it.
 * Suite data is ours, but `--suite <dir>` takes a path from the command
 * line, and "a value that becomes a filesystem path" is exactly the class
 * this repo validates at every entry point rather than at one call site.
 */
function assertSafeRelPath(p: string, source: string, field: string): void {
  if (p.length === 0) fail(source, `${field} must not be empty`);
  if (p.includes("\0")) fail(source, `${field} must not contain a NUL byte`);
  if (path.isAbsolute(p)) fail(source, `${field} must be relative, got "${p}"`);
  const normalized = path.normalize(p);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    fail(source, `${field} must stay inside the task directory, got "${p}"`);
  }
}

export function parseTaskJson(raw: unknown, dir: string): EvalTask {
  const source = path.join(dir, "task.json");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(source, "expected a JSON object");
  const o = raw as Record<string, unknown>;

  const str = (field: string): string => {
    const v = o[field];
    if (typeof v !== "string" || v.trim().length === 0) fail(source, `"${field}" must be a non-empty string`);
    return v as string;
  };

  const id = str("id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(source, `"id" must be lowercase kebab-case, got "${id}"`);
  if (id !== path.basename(dir)) fail(source, `"id" ("${id}") must match the task directory name ("${path.basename(dir)}")`);

  const category = str("category");
  if (!(EVAL_CATEGORIES as readonly string[]).includes(category)) {
    fail(source, `"category" must be one of ${EVAL_CATEGORIES.join(", ")}, got "${category}"`);
  }

  const solutionPathsRaw = o.solutionPaths;
  if (!Array.isArray(solutionPathsRaw) || solutionPathsRaw.length === 0) fail(source, `"solutionPaths" must be a non-empty array`);
  const solutionPaths = solutionPathsRaw.map((p, i) => {
    if (typeof p !== "string") fail(source, `solutionPaths[${i}] must be a string`);
    assertSafeRelPath(p, source, `solutionPaths[${i}]`);
    return p;
  });

  const requiresRaw = o.requires ?? [];
  if (!Array.isArray(requiresRaw)) fail(source, `"requires" must be an array of binary names when present`);
  const requires = requiresRaw.map((r, i) => {
    if (typeof r !== "string" || !/^[A-Za-z0-9._-]+$/.test(r)) fail(source, `requires[${i}] must be a bare binary name`);
    return r as string;
  });

  const startingGate = str("startingGate");
  if (startingGate !== "red" && startingGate !== "green") fail(source, `"startingGate" must be "red" or "green", got "${startingGate}"`);

  const oracle = o.oracle;
  if (typeof oracle !== "object" || oracle === null) fail(source, `"oracle" must be an object`);
  const commandRaw = (oracle as Record<string, unknown>).command;
  if (!Array.isArray(commandRaw) || commandRaw.length === 0) fail(source, `"oracle.command" must be a non-empty argv array`);
  const oracleCommand = commandRaw.map((c, i) => {
    if (typeof c !== "string" || c.length === 0) fail(source, `oracle.command[${i}] must be a non-empty string`);
    return c;
  });

  for (const required of ["repo", "oracle", "solution"]) {
    const sub = path.join(dir, required);
    if (!fs.existsSync(sub) || !fs.statSync(sub).isDirectory()) fail(source, `the task directory is missing a "${required}/" directory`);
  }

  return {
    id,
    category: category as EvalCategory,
    language: str("language"),
    description: str("description"),
    prompt: str("prompt"),
    solutionPaths,
    requires,
    startingGate,
    oracleCommand,
    dir
  };
}

export function loadEvalTask(dir: string): EvalTask {
  const file = path.join(dir, "task.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`invalid eval task at ${file}: ${(err as Error).message}`);
  }
  return parseTaskJson(raw, path.resolve(dir));
}

/** The bundled realistic-task suite (§16.3a bullet 3): `evals/suite/`. */
export function defaultSuiteDir(): string {
  return path.join(import.meta.dirname, "..", "suite");
}

export function loadSuite(dir: string = defaultSuiteDir()): EvalTask[] {
  if (!fs.existsSync(dir)) throw new Error(`no eval suite directory at ${dir}`);
  const tasks = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "task.json")))
    .map((e) => loadEvalTask(path.join(dir, e.name)))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (tasks.length === 0) throw new Error(`no tasks found under ${dir} (a task is a directory containing task.json)`);
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) throw new Error(`duplicate eval task id "${t.id}" in ${dir}`);
    seen.add(t.id);
  }
  return tasks;
}

/** Recursively copy `from` over `to`, creating directories as needed. Overwrites; never deletes. */
export function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

/**
 * Materialize a task's starting repository into `dir` as a **real git
 * repo** with one commit — worktree isolation (§13.1) needs a git repo, and
 * the eval must exercise the same delivery path a user's run does.
 */
export function materializeTaskRepo(task: EvalTask, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  copyTree(path.join(task.dir, "repo"), dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "eval@clutchcode.invalid"]);
  git(dir, ["config", "user.name", "ClutchCode Eval"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", `eval fixture: ${task.id}`]);
  return dir;
}

/** Copy the task's reference ("golden") solution over a materialized repo — used by the suite-validity test, never during a scored run. */
export function applyReferenceSolution(task: EvalTask, repoPath: string): void {
  copyTree(path.join(task.dir, "solution"), repoPath);
}

/**
 * Run the held-out oracle against a delivered repository.
 *
 * The oracle's files are copied in **here**, after the run is over —
 * overwriting anything the agent happened to create at the same path,
 * which is deliberate: the held-out check always wins.
 */
export interface RequirementCheck {
  ok: boolean;
  /** Binaries that are missing or could not be executed. */
  missing: string[];
}

/**
 * Are this task's declared requirements actually usable here?
 *
 * Runs `<binary> --version` rather than looking for the file on PATH —
 * a binary being present does not mean it works (this repo learned that
 * the expensive way with bwrap, see `detectBwrapUsable`). Results are
 * memoized per binary since a suite re-asks the same question per task.
 */
const requirementCache = new Map<string, boolean>();

export function checkTaskRequirements(task: EvalTask): RequirementCheck {
  const missing: string[] = [];
  for (const bin of task.requires) {
    let usable = requirementCache.get(bin);
    if (usable === undefined) {
      const proc = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
      usable = !proc.error && proc.status === 0;
      requirementCache.set(bin, usable);
    }
    if (!usable) missing.push(bin);
  }
  return { ok: missing.length === 0, missing };
}

export function runOracle(task: EvalTask, repoPath: string): OracleResult {
  copyTree(path.join(task.dir, "oracle"), repoPath);

  const start = Date.now();
  const proc = spawnSync(task.oracleCommand[0]!, task.oracleCommand.slice(1), {
    cwd: repoPath,
    encoding: "utf8",
    timeout: ORACLE_TIMEOUT_MS,
    maxBuffer: 20_000_000
  });
  const durationMs = Date.now() - start;
  const timedOut = proc.error !== undefined && (proc.error as NodeJS.ErrnoException).code === "ETIMEDOUT";

  return {
    passed: !timedOut && proc.status === 0,
    exitCode: proc.status,
    stdout: proc.stdout ?? "",
    stderr: timedOut ? `oracle timed out after ${ORACLE_TIMEOUT_MS}ms` : (proc.stderr ?? ""),
    durationMs
  };
}
