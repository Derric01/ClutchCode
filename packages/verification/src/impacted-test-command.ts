import type { Language } from "./toolchain.js";

/**
 * Best-effort "run just these test files" command construction (§14.4).
 * The spec itself flags impact-mapping as language-dependent and
 * [C:Med] — this is intentionally a narrow, honest heuristic, not a
 * general solution: it only fires as a fast, early-exit-on-failure pass
 * ahead of the authoritative full-suite run (see AgentLoop), so a wrong or
 * no-op filter never weakens the completion gate — it only costs a little
 * time it was trying to save.
 *
 * Node: most JS test runners (vitest, jest, mocha, ava, tap) accept
 * trailing positional file args after `--` when invoked through an npm
 * script. Python: pytest accepts file paths directly. Go/Rust: file-level
 * selection doesn't map cleanly onto `go test`/`cargo test` (package- and
 * name-based instead) — skipped rather than guessed.
 */
export function buildImpactedTestCommand(baseCommand: string, files: string[], language: Language): string | null {
  if (files.length === 0) return null;

  const quoted = files.map((f) => `"${f}"`).join(" ");

  switch (language) {
    case "node":
      return `${baseCommand} -- ${quoted}`;
    case "python":
      return `${baseCommand} ${quoted}`;
    case "go":
    case "rust":
    case "unknown":
      return null;
    default: {
      const exhaustive: never = language;
      throw new Error(`unhandled language: ${exhaustive as string}`);
    }
  }
}
