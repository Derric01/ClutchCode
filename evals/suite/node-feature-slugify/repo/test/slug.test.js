'use strict';

const assert = require('node:assert');
const { slugify } = require('../src/slug.js');

assert.strictEqual(slugify('Hello World'), 'hello-world', 'basic');
assert.strictEqual(slugify('  Trim Me!  '), 'trim-me', 'trimming and punctuation');

console.log('ok - slug');
