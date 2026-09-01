'use strict';

// text-util 2.0.0 — `leftPad` is gone; `pad` takes the fill character.
function pad(text, width, fill) {
  const value = String(text);
  const filler = fill === undefined ? ' ' : String(fill);
  if (value.length >= width || filler.length === 0) return value;
  return filler.repeat(width - value.length).slice(0, width - value.length) + value;
}

module.exports = { pad };
