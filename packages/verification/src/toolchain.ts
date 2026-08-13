import fs from "node:fs";
import path from "node:path";

/**
 * Toolchain auto-detection and override (PROJECT_SPEC.md §14.2).
 *
 * ```
 * detect():
 *   node   → package.json scripts (test/build/lint); pnpm/yarn/npm by lockfile
 *   python → pyproject/pytest.ini/tox; uv/poetry/pip by lockfile
 *   rust   → Cargo.toml (cargo test/clippy/build)
 *   go     → go.mod (go test/vet/build)
 *   fallback: ask; persist the answer to project memory with provenance
 * override: AGENTS.md commands win; explicit config override.
 * ```
 */

export type Language = "node" | "python" | "rust" | "go" | "unknown";

export interface ToolchainCommands {
  language: Language;
  packageManager?: string;
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
  /** Provenance per §10.3: every derived fact records how it was learned. */
  provenance: string;
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function detectNode(repoRoot: string): ToolchainCommands | null {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  let pkg: any;
  try {
    pkg = readJson(pkgPath);
  } catch {
    return { language: "node", provenance: `package.json at ${pkgPath} is not valid JSON` };
  }
  const scripts: Record<string, string> = pkg.scripts ?? {};

  const packageManager = fs.existsSync(path.join(repoRoot, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(repoRoot, "yarn.lock"))
      ? "yarn"
      : "npm";
  const run = (script: string) => `${packageManager} run ${script}`;

  return {
    language: "node",
    packageManager,
    build: scripts.build ? run("build") : undefined,
    test: scripts.test ? run("test") : undefined,
    lint: scripts.lint ? run("lint") : undefined,
    typecheck: scripts.typecheck ? run("typecheck") : scripts["type-check"] ? run("type-check") : undefined,
    provenance: `derived from scripts in ${pkgPath} (package manager: ${packageManager}, by lockfile)`
  };
}

function detectPython(repoRoot: string): ToolchainCommands | null {
  const markers = ["pyproject.toml", "setup.py", "pytest.ini", "tox.ini"];
  if (!markers.some((m) => fs.existsSync(path.join(repoRoot, m)))) return null;

  const packageManager = fs.existsSync(path.join(repoRoot, "uv.lock"))
    ? "uv"
    : fs.existsSync(path.join(repoRoot, "poetry.lock"))
      ? "poetry"
      : "pip";

  return {
    language: "python",
    packageManager,
    test: "pytest -q",
    lint: "ruff check .",
    provenance: `derived from a python project marker in ${repoRoot} (package manager: ${packageManager}, by lockfile)`
  };
}

function detectRust(repoRoot: string): ToolchainCommands | null {
  const cargoToml = path.join(repoRoot, "Cargo.toml");
  if (!fs.existsSync(cargoToml)) return null;
  return {
    language: "rust",
    packageManager: "cargo",
    build: "cargo build",
    test: "cargo test",
    lint: "cargo clippy",
    provenance: `derived from ${cargoToml}`
  };
}

function detectGo(repoRoot: string): ToolchainCommands | null {
  const goMod = path.join(repoRoot, "go.mod");
  if (!fs.existsSync(goMod)) return null;
  return {
    language: "go",
    packageManager: "go",
    build: "go build ./...",
    test: "go test ./...",
    lint: "go vet ./...",
    provenance: `derived from ${goMod}`
  };
}

/** Best-effort, deterministic detection. Order matters when a repo has more than one manifest. */
export function detectToolchain(repoRoot: string): ToolchainCommands {
  const detectors = [detectNode, detectPython, detectRust, detectGo];
  for (const detector of detectors) {
    const result = detector(repoRoot);
    if (result) return result;
  }
  return { language: "unknown", provenance: `no recognized toolchain manifest found under ${repoRoot}` };
}

const OVERRIDE_LINE_RE = /^\s*[-*]?\s*(build|test|lint|typecheck)\s*:\s*`?([^`\r\n]+?)`?\s*$/gim;

/**
 * "Human edits win" (§10.3): explicit `build:`/`test:`/`lint:`/`typecheck:`
 * lines in AGENTS.md override whatever auto-detection produced.
 */
export function applyAgentsMdOverrides(commands: ToolchainCommands, agentsMdContent: string): ToolchainCommands {
  const overridden: ToolchainCommands = { ...commands };
  let any = false;
  OVERRIDE_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OVERRIDE_LINE_RE.exec(agentsMdContent))) {
    const key = m[1]!.toLowerCase() as "build" | "test" | "lint" | "typecheck";
    overridden[key] = m[2]!.trim();
    any = true;
  }
  if (any) overridden.provenance = "overridden by AGENTS.md (human-authored, wins per §10.3)";
  return overridden;
}
