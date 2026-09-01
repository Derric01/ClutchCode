'use strict';

// Held-out check (§16.3b): written into the delivered repository AFTER the
// run finishes. This task's own gate is green before the agent touches
// anything, so an agent that changes nothing at all still gets a green
// gate — only this file can tell that apart from a real implementation.

const assert = require('node:assert');
const { slugify } = require('./src/slug.js');

// Existing behavior must be preserved exactly.
assert.strictEqual(slugify('Hello World'), 'hello-world', 'basic');
assert.strictEqual(slugify('  Trim Me!  '), 'trim-me', 'trimming and punctuation');
assert.strictEqual(slugify('Hello World', {}), 'hello-world', 'empty options');

// The new option.
assert.strictEqual(slugify('Hello Wonderful World', { maxLength: 12 }), 'hello-wonder', 'truncates');
assert.strictEqual(slugify('Hello Wonderful World', { maxLength: 6 }), 'hello', 'strips the trailing dash');
assert.strictEqual(slugify('Hello World', { maxLength: 100 }), 'hello-world', 'maxLength above the length is a no-op');

console.log('ok - oracle: slug');
