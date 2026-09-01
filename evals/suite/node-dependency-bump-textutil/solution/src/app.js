'use strict';

const { pad } = require('../vendor/text-util/v2.js');

/** Render one right-aligned table cell. */
function formatRow(label, width, fill) {
  return pad(label, width, fill);
}

module.exports = { formatRow };
