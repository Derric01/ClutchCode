'use strict';

// Held-out check (§16.3b): written into the delivered repository AFTER the
// run finishes. A refactor is graded on two things at once — the extracted
// helper must actually exist and be exported (the point of the task), and
// the two public functions must behave exactly as they did before.

const assert = require('node:assert');
const format = require('./src/format.js');

assert.strictEqual(typeof format.normalize, 'function', 'normalize must be exported');
assert.strictEqual(format.normalize('  hello   BRAVE world '), 'hello brave world', 'normalize');
assert.strictEqual(format.normalize(''), '', 'normalize of empty text');

// Behavior preservation — identical to the pre-refactor expectations.
assert.strictEqual(format.titleCase('  hello   BRAVE world '), 'Hello Brave World', 'titleCase');
assert.strictEqual(format.titleCase(''), '', 'titleCase of empty text');
assert.strictEqual(format.sentenceCase('  hello   BRAVE world '), 'Hello brave world', 'sentenceCase');
assert.strictEqual(format.sentenceCase(''), '', 'sentenceCase of empty text');

console.log('ok - oracle: format');
