'use strict';

/** Lowercase, trim, and collapse runs of whitespace to a single space. */
function normalize(text) {
  return String(text).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Title-Case a phrase. */
function titleCase(text) {
  const cleaned = normalize(text);
  return cleaned
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Sentence-case a phrase. */
function sentenceCase(text) {
  const cleaned = normalize(text);
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned;
}

module.exports = { normalize, titleCase, sentenceCase };
