'use strict';

// Held-out check (§16.3b). Copied into the delivered repository AFTER the
// run, so the agent never sees it.
//
// It grades against logs it writes itself, never the committed sample, so
// a script that hardcodes the sample's counts fails. Case 3 is the one that
// separates a real implementation from `grep -c ERROR`: an INFO line whose
// message contains the word ERROR is an INFO line.

const assert = require('node:assert');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SCRIPT = 'scripts/summarize-log.sh';

function summarize(file) {
  return spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });
}

function expectLines(result, expected, why) {
  assert.strictEqual(result.status, 0, `${why}: expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.deepStrictEqual(result.stdout.split('\n').filter((l) => l.length > 0), expected, why);
}

const files = [];
function writeLog(name, lines) {
  fs.writeFileSync(name, lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8');
  files.push(name);
  return name;
}

try {
  // 1. Counts the oracle chose, not the repository's committed sample.
  const busy = writeLog('oracle-busy.log', [
    '2026-02-01T00:00:00Z ERROR a',
    '2026-02-01T00:00:01Z ERROR b',
    '2026-02-01T00:00:02Z ERROR c',
    '2026-02-01T00:00:03Z WARN d',
    '2026-02-01T00:00:04Z INFO e'
  ]);
  expectLines(summarize(busy), ['ERROR 3', 'WARN 1', 'INFO 1', 'TOTAL 5'], 'counts on a log the oracle wrote');

  // 2. An empty log is all zeros and still a success.
  const empty = writeLog('oracle-empty.log', []);
  expectLines(summarize(empty), ['ERROR 0', 'WARN 0', 'INFO 0', 'TOTAL 0'], 'an empty log');

  // 3. The level is the SECOND FIELD, not a substring of the line. A
  //    `grep -c ERROR` implementation gets this wrong, and it is the most
  //    common way to get it wrong.
  const tricky = writeLog('oracle-tricky.log', [
    '2026-02-01T00:00:00Z INFO retrying after ERROR upload failed',
    '2026-02-01T00:00:01Z INFO WARN is only a word here',
    '2026-02-01T00:00:02Z ERROR real failure',
    '2026-02-01T00:00:03Z DEBUG ignored entirely',
    ''
  ]);
  expectLines(summarize(tricky), ['ERROR 1', 'WARN 0', 'INFO 2', 'TOTAL 3'], 'the level is the second field, not a substring');

  // 4. A missing argument and a missing file are both errors, with nothing
  //    on stdout and something on stderr.
  for (const [args, why] of [
    [[], 'no argument at all'],
    [['oracle-does-not-exist.log'], 'a path that is not a file']
  ]) {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0, `${why}: expected a non-zero exit`);
    assert.strictEqual(result.stdout.trim(), '', `${why}: expected nothing on stdout, got ${JSON.stringify(result.stdout)}`);
    assert.notStrictEqual(result.stderr.trim(), '', `${why}: expected a usage message on stderr`);
  }
} finally {
  for (const file of files) fs.rmSync(file, { force: true });
}

console.log('ok - oracle: summarize-log.sh counts by level');
