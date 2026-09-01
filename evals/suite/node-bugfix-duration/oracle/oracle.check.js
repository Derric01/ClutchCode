'use strict';

// Held-out check (§16.3b). Written into the delivered repository AFTER the
// run finishes, so the agent can neither read nor edit it — the eval
// equivalent of SWE-bench applying its golden test patch post-hoc.

const assert = require('node:assert');
const { parseDuration } = require('./src/duration.js');

assert.strictEqual(parseDuration('45s'), 45000, 'seconds');
assert.strictEqual(parseDuration('90m'), 5400000, 'minutes');
assert.strictEqual(parseDuration('2h'), 7200000, 'hours');
assert.strictEqual(parseDuration('1h30m'), 3600000 + 1800000, 'hours + minutes');
assert.strictEqual(parseDuration('1h1m1s'), 3600000 + 60000 + 1000, 'all three units');
assert.strictEqual(parseDuration(''), 0, 'empty string');

console.log('ok - oracle: duration');
