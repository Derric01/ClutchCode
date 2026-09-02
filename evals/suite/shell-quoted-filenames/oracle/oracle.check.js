'use strict';

// Held-out check (§16.3b). Copied into the delivered repository AFTER the
// run finishes, so the agent never sees it.
//
// It builds its OWN directory, passed as the script's first argument, so it
// cannot be satisfied by hardcoding the repository's committed fixture
// names — and one of those names contains a space, which is the whole
// point of the task and the one thing the repository's own suite cannot
// see.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIR = 'oracle-reports';
const EXPECTED = ['Q3 summary.txt', 'alpha beta.md', 'plain.txt'];

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
for (const name of EXPECTED) fs.writeFileSync(path.join(DIR, name), `${name}\n`, 'utf8');

try {
  const result = spawnSync('bash', ['scripts/list-reports.sh', DIR], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);

  const lines = result.stdout.split('\n').filter((line) => line.length > 0);
  assert.strictEqual(
    lines.length,
    EXPECTED.length,
    `expected exactly ${EXPECTED.length} lines, got ${lines.length}: ${JSON.stringify(lines)}`
  );
  assert.deepStrictEqual([...lines].sort(), [...EXPECTED].sort(), 'each file must produce exactly one line with its exact name');

  // An empty directory must produce NO output at all — not one blank line.
  // This is not pedantry: it is what separates a real fix from `for f in
  // "$(ls "$DIR")"`, which quotes the substitution into a single word and
  // therefore looks correct for spaced names (newlines survive the echo)
  // while emitting one empty iteration for an empty directory. "One line
  // per file" means zero files produce zero lines, and the comparison is
  // byte-exact rather than trimmed so that difference is visible.
  const empty = 'oracle-empty';
  fs.rmSync(empty, { recursive: true, force: true });
  fs.mkdirSync(empty, { recursive: true });
  const emptyResult = spawnSync('bash', ['scripts/list-reports.sh', empty], { encoding: 'utf8' });
  assert.strictEqual(emptyResult.status, 0, `expected exit 0 on an empty directory, got ${emptyResult.status}: ${emptyResult.stderr}`);
  assert.strictEqual(emptyResult.stdout, '', `expected no output at all for an empty directory, got ${JSON.stringify(emptyResult.stdout)}`);
  fs.rmSync(empty, { recursive: true, force: true });
} finally {
  fs.rmSync(DIR, { recursive: true, force: true });
}

console.log('ok - oracle: list-reports.sh handles filenames with spaces');
