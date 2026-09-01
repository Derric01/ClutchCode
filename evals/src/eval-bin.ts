#!/usr/bin/env node
import { buildEvalProgram } from "./eval-cli.js";

/**
 * The `clutchcode-eval` bin entry (PROJECT_SPEC.md §16.3b). Deliberately
 * nothing but "build the command tree, parse argv" — the tree itself lives
 * in `eval-cli.ts` so tests can inspect and drive it without importing a
 * module that parses `process.argv` at import time.
 */
buildEvalProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
