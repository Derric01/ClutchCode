'use strict';

/**
 * Parse a duration string ("1h30m", "90m", "45s") into milliseconds.
 * Unrecognized text is ignored; an empty string is 0.
 */
function parseDuration(text) {
  const pattern = /(\d+)(h|m|s)/g;
  let total = 0;
  let match;
  while ((match = pattern.exec(String(text))) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === 'h') {
      total += value * 60 * 60 * 1000;
    } else if (unit === 'm') {
      total += value * 60 * 1000;
    } else {
      total += value * 1000;
    }
  }
  return total;
}

module.exports = { parseDuration };
