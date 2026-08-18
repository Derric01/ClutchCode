import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyAgentsMdOverrides, detectToolchain, type ToolchainCommands } from "@clutchcode/verification";

/**
 * Project-memory correction UX (PROJECT_SPEC.md §10.3): a persisted,
 * provenance-timestamped cache of the machine-derived toolchain facts
 * (§10.2's "machine-derived project cache (detected toolchain...)"),
 * with the mechanisms §10.3 names explicitly:
 *
 * 1. **Provenance + timestamps** — every fact stores `{value, derivedAt,
 *    source}`, not just a bare value.
 * 2. **Invalidation on change** — keyed by a content hash of the manifest
 *    files it was derived from (`package.json`, `Cargo.toml`, lockfiles,
 *    …); editing one invalidates the whole cached record.
 * 3. **Verification is the truth oracle** — `markStale` is the hook a
 *    caller (the agent loop, via `agent-api`) invokes when a cached
 *    command turns out not to exist at all (`command-not-found`, §14.5's
 *    error taxonomy) rather than trusting stale memory over what the OS
 *    just proved.
 * 4. **Human edits win** — `getOrDetectToolchain` still applies
 *    `applyAgentsMdOverrides` on every re-derive, and `correctFact` lets
 *    a human directly overwrite a fact from the CLI (`agent memory
 *    correct`), independent of re-derivation.
 * 5. **The `agent memory` command** (§18.2) — `list`/`show`/`forget`/
 *    `correct` are the primitives this module exposes; the CLI layer is
 *    a thin wrapper (`apps/cli/src/commands.ts`).
 *
 * Deliberately out of scope for this module: the "agent-appended, with
 * consent" AGENTS.md-editing flow §10.1 also describes, and the
 * long-term engineering tier (§10, prior runs/decisions queryable via
 * `history.db`) — both real, separate features, not attempted here.
 */

export type ToolchainFactKey = "language" | "packageManager" | "build" | "test" | "lint" | "typecheck";

export interface MemoryFact {
  value: string;
  /** ISO 8601 timestamp of when this value was last (re-)derived or corrected. */
  derivedAt: string;
  /** How this value was learned — a detector's provenance string, or "human-corrected via `agent memory correct`". */
  source: string;
  stale?: boolean;
  staleReason?: string;
}

export interface ToolchainMemory {
  /** Content hash of the manifest files this record was derived from — a changed hash means the whole record is stale (§10.3 point 2). */
  manifestHash: string;
  facts: Partial<Record<ToolchainFactKey, MemoryFact>>;
}

export interface ToolchainMemoryOptions {
  /** Override for `~/.config/clutchcode/memory` — real usage never sets this; tests point it at a temp dir. */
  configDir?: string;
}

const MANIFEST_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "pytest.ini",
  "tox.ini",
  "uv.lock",
  "poetry.lock"
];

function defaultConfigDir(): string {
  return path.join(os.homedir(), ".config", "clutchcode", "memory");
}

/** Repo paths become filesystem-safe, collision-resistant keys (mirrors `capabilityProfilePath`'s approach in `@clutchcode/capability`). */
function repoKey(repoRoot: string): string {
  const hash = crypto.createHash("sha256").update(path.resolve(repoRoot)).digest("hex").slice(0, 16);
  const base = path.basename(path.resolve(repoRoot)).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${base || "repo"}-${hash}`;
}

function memoryFilePath(repoRoot: string, opts?: ToolchainMemoryOptions): string {
  return path.join(opts?.configDir ?? defaultConfigDir(), `${repoKey(repoRoot)}.json`);
}

/** Content hash of whichever manifest files exist — the invalidation key (§10.3 point 2: "editing package.json/pyproject.toml/CI config invalidates the derived test/build command"). */
export function computeManifestHash(repoRoot: string): string {
  const hash = crypto.createHash("sha256");
  for (const f of MANIFEST_FILES) {
    const p = path.join(repoRoot, f);
    if (fs.existsSync(p)) hash.update(f).update(fs.readFileSync(p));
  }
  return hash.digest("hex");
}

function loadRaw(repoRoot: string, opts?: ToolchainMemoryOptions): ToolchainMemory | undefined {
  const p = memoryFilePath(repoRoot, opts);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ToolchainMemory;
  } catch {
    return undefined; // corrupted cache file — treat exactly like "no cache", never a hard error
  }
}

function saveRaw(repoRoot: string, memory: ToolchainMemory, opts?: ToolchainMemoryOptions): void {
  const p = memoryFilePath(repoRoot, opts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(memory, null, 2), "utf8");
}

function commandsToFacts(commands: ToolchainCommands, now: string): Partial<Record<ToolchainFactKey, MemoryFact>> {
  const facts: Partial<Record<ToolchainFactKey, MemoryFact>> = {
    language: { value: commands.language, derivedAt: now, source: commands.provenance }
  };
  for (const key of ["packageManager", "build", "test", "lint", "typecheck"] as const) {
    const value = commands[key];
    if (value) facts[key] = { value, derivedAt: now, source: commands.provenance };
  }
  return facts;
}

function factsToCommands(facts: Partial<Record<ToolchainFactKey, MemoryFact>>): ToolchainCommands {
  return {
    language: (facts.language?.value as ToolchainCommands["language"]) ?? "unknown",
    packageManager: facts.packageManager?.value,
    build: facts.build?.value,
    test: facts.test?.value,
    lint: facts.lint?.value,
    typecheck: facts.typecheck?.value,
    provenance: facts.language?.source ?? "no cached provenance"
  };
}

export interface GetOrDetectResult {
  commands: ToolchainCommands;
  fromCache: boolean;
}

/**
 * The read path a real run uses: reuse the cached record when the
 * manifest hash still matches and nothing in it is marked stale;
 * otherwise re-derive via `detectToolchain` (+ `AGENTS.md` overrides,
 * §10.3 point 4) and persist the fresh record with new provenance.
 *
 * `detectFrom` and `cacheKeyPath` are deliberately separate parameters,
 * not one "repoRoot": a caller like `@clutchcode/agent-api` detects from
 * a run's ephemeral git-worktree path (the actual files being verified
 * this run) but must cache under the *stable* original repo path — a
 * fresh worktree directory every run would otherwise mean the cache
 * never hits at all, silently defeating the entire point of this module.
 * Callers with no such split (e.g. a plain repo checkout) just pass the
 * same path for both.
 */
export function getOrDetectToolchain(detectFrom: string, cacheKeyPath: string, agentsMdContent?: string, opts?: ToolchainMemoryOptions): GetOrDetectResult {
  const currentHash = computeManifestHash(detectFrom);
  const cached = loadRaw(cacheKeyPath, opts);
  const anyStale = cached && Object.values(cached.facts).some((f) => f?.stale);

  if (cached && cached.manifestHash === currentHash && !anyStale) {
    return { commands: factsToCommands(cached.facts), fromCache: true };
  }

  let commands = detectToolchain(detectFrom);
  if (agentsMdContent) commands = applyAgentsMdOverrides(commands, agentsMdContent);

  saveRaw(cacheKeyPath, { manifestHash: currentHash, facts: commandsToFacts(commands, new Date().toISOString()) }, opts);
  return { commands, fromCache: false };
}

/** All remembered facts for a repo, or `undefined` if nothing has been derived/cached yet. */
export function listToolchainMemory(repoRoot: string, opts?: ToolchainMemoryOptions): ToolchainMemory | undefined {
  return loadRaw(repoRoot, opts);
}

/** One fact's full detail, or `undefined` if it isn't cached. */
export function showToolchainFact(repoRoot: string, key: ToolchainFactKey, opts?: ToolchainMemoryOptions): MemoryFact | undefined {
  return loadRaw(repoRoot, opts)?.facts[key];
}

/** Removes one fact — forces re-derivation of the whole record next time `getOrDetectToolchain` is called for this repo, since the record no longer looks complete/trustworthy as a unit. Returns `false` if there was nothing to forget. */
export function forgetToolchainFact(repoRoot: string, key: ToolchainFactKey, opts?: ToolchainMemoryOptions): boolean {
  const cached = loadRaw(repoRoot, opts);
  if (!cached || !cached.facts[key]) return false;
  delete cached.facts[key];
  saveRaw(repoRoot, cached, opts);
  return true;
}

/**
 * §10.3 point 5, "correct a fact": a human directly overwrites a cached
 * value, e.g. `agent memory correct test "pytest -q --maxfail=1"`. Creates
 * the record if none existed yet.
 *
 * Always stamps the *current* manifest hash, not just when creating a new
 * record — a real bug caught in code review: reusing `cached.manifestHash`
 * unchanged meant a correction landing on a record whose hash was already
 * stale (e.g. `package.json` was edited earlier and nothing had re-derived
 * since) got silently discarded on the very next `getOrDetectToolchain`
 * call — it would see the hash mismatch, conclude the whole record was
 * stale, and re-derive everything from scratch, overwriting the human's
 * correction with no warning. That directly contradicts this module's own
 * "human edits win" contract (§10.3 point 4).
 */
export function correctToolchainFact(repoRoot: string, key: ToolchainFactKey, value: string, opts?: ToolchainMemoryOptions): void {
  const cached = loadRaw(repoRoot, opts) ?? { manifestHash: "", facts: {} };
  cached.manifestHash = computeManifestHash(repoRoot);
  cached.facts[key] = { value, derivedAt: new Date().toISOString(), source: "human-corrected via `agent memory correct`" };
  saveRaw(repoRoot, cached, opts);
}

/**
 * §10.3 point 3, "verification is the truth oracle": the agent loop
 * calls this when a cached command turned out not to exist at all
 * (classified `command-not-found`) — memory was wrong, not the model's
 * edit. Marks just that fact stale so the *next* run re-derives instead
 * of repeating the same broken command. A no-op if nothing is cached for
 * this repo yet (nothing to mark).
 */
export function markToolchainFactStale(repoRoot: string, key: ToolchainFactKey, reason: string, opts?: ToolchainMemoryOptions): void {
  const cached = loadRaw(repoRoot, opts);
  const fact = cached?.facts[key];
  if (!cached || !fact) return;
  fact.stale = true;
  fact.staleReason = reason;
  saveRaw(repoRoot, cached, opts);
}
