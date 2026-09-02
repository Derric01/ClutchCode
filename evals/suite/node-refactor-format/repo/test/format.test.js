'use strict';

const assert = require('node:assert');
const { titleCase, sentenceCase } = require('../src/format.js');

assert.strictEqual(titleCase('  hello   BRAVE world '), 'Hello Brave World', 'titleCase');
assert.strictEqual(sentenceCase('  hello   BRAVE world '), 'Hello brave world', 'sentenceCase');

console.log('ok - format');
