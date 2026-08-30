#!/usr/bin/env node
import { buildProgram } from "./program.js";

/**
 * The `clutchcode` bin entry (PROJECT_SPEC.md §18.2). Deliberately nothing
 * but "build the command tree, parse argv": the tree itself lives in
 * `program.ts` so tests can inspect it without importing a module that
 * parses `process.argv` and calls `process.exit` at import time.
 */
buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(4);
  });
