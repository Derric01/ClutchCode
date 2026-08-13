import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * The standard fixture repo used by every replay transcript (evals/fixtures/*.json):
 * a Node project with a one-line bug in `add()` and a real `assert()`-based
 * test that catches it. Kept identical across scenarios so a single
 * recorded transcript's tool-call args/paths are portable and comparable.
 */

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

export function makeFixtureRepo(): string {
  const dir = makeTempDir("clutchcode-eval-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "eval@example.com"]);
  git(dir, ["config", "user.name", "Eval"]);

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "eval-fixture", scripts: { test: "node math.test.js" } }, null, 2), "utf8");
  fs.writeFileSync(
    path.join(dir, "math.js"),
    ["// TODO: fix the implementation", "function add(a, b) {", "  return a - b;", "}", "module.exports = { add };", ""].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "math.test.js"),
    ["const assert = require('assert');", "const { add } = require('./math.js');", "", "assert(add(2, 3) === 5, 'expected 5');", "console.log('PASS');", ""].join(
      "\n"
    ),
    "utf8"
  );

  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial buggy commit"]);
  return dir;
}
