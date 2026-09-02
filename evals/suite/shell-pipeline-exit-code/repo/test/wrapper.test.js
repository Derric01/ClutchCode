'use strict';

// The repository's own suite. RED on arrival: the failure path below is
// exactly the bug.

const assert = require('node:assert');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const FORBIDDEN = 'DO_NOT_SHIP.txt';
const LOG = 'check.log';

function runWrapper() {
  return spawnSync('bash', ['scripts/run-checks.sh', LOG], { encoding: 'utf8' });
}

fs.rmSync(FORBIDDEN, { force: true });
let result = runWrapper();
assert.strictEqual(result.status, 0, 'the wrapper must exit 0 when the checker passes');
assert.match(fs.readFileSync(LOG, 'utf8'), /check: ok/, 'the checker output must still reach the log file');
assert.match(result.stdout, /checks finished/, 'a successful run must still print "checks finished"');

fs.writeFileSync(FORBIDDEN, 'oops\n');
try {
  result = runWrapper();
  assert.notStrictEqual(result.status, 0, 'the wrapper must exit non-zero when the checker fails');
} finally {
  fs.rmSync(FORBIDDEN, { force: true });
}

console.log('PASS');
