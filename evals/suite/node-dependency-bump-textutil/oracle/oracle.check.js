'use strict';

// Held-out check (§16.3b): written into the delivered repository AFTER the
// run finishes. A dependency bump is graded on *which* dependency is
// actually in use, not only on behavior — so this checks the pin, the
// require, and the migrated behavior together.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const deps = JSON.parse(fs.readFileSync(path.join(__dirname, 'deps.json'), 'utf8'));
assert.strictEqual(deps.vendored['text-util'], '2.0.0', 'deps.json must pin text-util 2.0.0');

const appSource = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
assert.ok(!/text-util\/v1/.test(appSource), 'src/app.js must not require v1 any more');
assert.ok(/text-util\/v2/.test(appSource), 'src/app.js must require v2');

const { formatRow } = require('./src/app.js');
assert.strictEqual(formatRow('x', 5), '    x', 'two-argument behavior is unchanged');
assert.strictEqual(formatRow('wide', 2), 'wide', 'never truncates');
assert.strictEqual(formatRow('x', 5, '.'), '....x', 'the fill character reaches pad()');
assert.strictEqual(formatRow('42', 4, '0'), '0042', 'zero fill');

console.log('ok - oracle: dependency bump');
