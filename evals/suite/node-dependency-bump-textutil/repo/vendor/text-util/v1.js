'use strict';

// text-util 1.0.0 — pads with spaces only.
function leftPad(text, width) {
  const value = String(text);
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

module.exports = { leftPad };
