'use strict';

/** Title-Case a phrase. */
function titleCase(text) {
  const cleaned = String(text).toLowerCase().trim().replace(/\s+/g, ' ');
  return cleaned
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Sentence-case a phrase. */
function sentenceCase(text) {
  const cleaned = String(text).toLowerCase().trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned;
}

module.exports = { titleCase, sentenceCase };
