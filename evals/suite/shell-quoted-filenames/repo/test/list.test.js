'use strict';

// The repository's own suite — GREEN on arrival, and that is the point.
// Every fixture name here is a single word, so the word-splitting bug is
// invisible to it. Only the held-out oracle uses a name with a space in it.

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const result = spawnSync('bash', ['scripts/list-reports.sh'], { encoding: 'utf8' });
assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);

const lines = result.stdout.split('\n').filter((line) => line.length > 0);
assert.deepStrictEqual([...lines].sort(), ['alpha.txt', 'beta.txt']);

console.log('PASS');
