'use strict';

const { leftPad } = require('../vendor/text-util/v1.js');

/** Render one right-aligned table cell. */
function formatRow(label, width) {
  return leftPad(label, width);
}

module.exports = { formatRow };
