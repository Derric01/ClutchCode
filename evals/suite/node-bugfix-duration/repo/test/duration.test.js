'use strict';

const assert = require('node:assert');
const { parseDuration } = require('../src/duration.js');

assert.strictEqual(parseDuration('45s'), 45000, 'seconds');
assert.strictEqual(parseDuration('90m'), 5400000, 'minutes');
assert.strictEqual(parseDuration('2h'), 7200000, 'hours');

console.log('ok - duration');
