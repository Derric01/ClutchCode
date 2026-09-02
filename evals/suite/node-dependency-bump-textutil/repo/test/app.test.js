'use strict';

const assert = require('node:assert');
const { formatRow } = require('../src/app.js');

assert.strictEqual(formatRow('x', 5), '    x', 'pads to width');
assert.strictEqual(formatRow('wide', 2), 'wide', 'never truncates');

console.log('ok - app');
