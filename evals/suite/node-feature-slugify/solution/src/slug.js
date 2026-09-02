'use strict';

/**
 * Turn arbitrary text into a URL slug.
 * `options.maxLength` truncates the slug and drops any trailing "-".
 */
function slugify(text, options) {
  let slug = String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const maxLength = options && options.maxLength;
  if (typeof maxLength === 'number' && maxLength > 0) {
    slug = slug.slice(0, maxLength).replace(/-+$/g, '');
  }

  return slug;
}

module.exports = { slugify };
