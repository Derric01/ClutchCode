'use strict';

// Held-out check (§16.3b). Copied into the delivered repository AFTER the
// run, so the agent can neither read nor edit it.
//
// It grades BOTH directions on purpose. "Exit non-zero when the checker
// fails" is trivially satisfiable by an unconditional `exit 1`, and "exit 0
// when it passes" by deleting the failure path — so a solution has to get
// the success path, the failure path, AND the log in both cases right.

const assert = require('node:assert');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const FORBIDDEN = 'DO_NOT_SHIP.txt';
const LOG = 'oracle.log';

function runWrapper() {
  fs.rmSync(LOG, { force: true });
  return spawnSync('bash', ['scripts/run-checks.sh', LOG], { encoding: 'utf8' });
}

// 1. Success path: exit 0, the log written, and the trailing message kept.
fs.rmSync(FORBIDDEN, { force: true });
let result = runWrapper();
assert.strictEqual(result.status, 0, `expected exit 0 on a passing check, got ${result.status}`);
assert.match(fs.readFileSync(LOG, 'utf8'), /check: ok/, 'the passing checker output must reach the log file');
assert.match(result.stdout, /checks finished/, 'a successful run must still print "checks finished"');

// 2. Failure path: non-zero, and the checker's output still captured — a
//    "fix" that stops running the checker, or stops logging it, is not one.
fs.writeFileSync(FORBIDDEN, 'oops\n');
try {
  result = runWrapper();
  assert.notStrictEqual(result.status, 0, 'expected a non-zero exit when the checker fails');
  const log = fs.readFileSync(LOG, 'utf8');
  assert.match(log, /found forbidden file: DO_NOT_SHIP\.txt/, 'the failing checker output must still reach the log file');
  assert.match(log, /check: 1 problem/, "the log must carry the checker's full output, not just its first line");
} finally {
  fs.rmSync(FORBIDDEN, { force: true });
  fs.rmSync(LOG, { force: true });
}

console.log("ok - oracle: run-checks.sh reports the checker's exit status");
