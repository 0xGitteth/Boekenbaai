'use strict';

const {
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
} = require('./book-edition-utils');

function isPlaceholderAuthor(value) {
  const comparable = normalizeBookIdentityComparable(value);
  if (!comparable) return false;
  const compact = comparable.replace(/[.\s/_-]+/g, '');
  return compact === 'nvt' || compact === 'nietvantoepassing';
}

function normalizeAuthorCandidate(candidate) {
  if (typeof candidate === 'string') {
    const value = normalizeBookIdentityText(candidate);
    return isPlaceholderAuthor(value) ? '' : value;
  }
  if (!candidate || typeof candidate !== 'object') return '';
  const displayName = typeof candidate.displayName === 'string'
    ? normalizeBookIdentityText(candidate.displayName)
    : '';
  if (displayName && !isPlaceholderAuthor(displayName)) return displayName;
  const name = typeof candidate.name === 'string'
    ? normalizeBookIdentityText(candidate.name)
    : '';
  if (name && !isPlaceholderAuthor(name)) return name;
  return '';
}

function normalizeAuthorList(authors, fallbackAuthor = '') {
  const candidates = Array.isArray(authors) && authors.length ? authors : [fallbackAuthor];
  const normalized = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const displayName = normalizeAuthorCandidate(candidate);
    if (!displayName) continue;
    const key = normalizeBookIdentityComparable(displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(displayName);
  }

  if (!normalized.length) {
    const fallback = normalizeAuthorCandidate(fallbackAuthor);
    if (fallback) normalized.push(fallback);
  }
  return normalized;
}

function createAuthorDisplay(authors, fallbackAuthor = '') {
  const normalized = normalizeAuthorList(authors, fallbackAuthor);
  if (!normalized.length) return '';
  if (normalized.length === 1) return normalized[0];
  if (normalized.length === 2) return `${normalized[0]} & ${normalized[1]}`;
  return `${normalized.slice(0, -1).join(', ')} & ${normalized[normalized.length - 1]}`;
}

function getComparableAuthorTuple(authors, fallbackAuthor = '') {
  return normalizeAuthorList(authors, fallbackAuthor)
    .map((author) => normalizeBookIdentityComparable(author))
    .sort();
}

module.exports = {
  isPlaceholderAuthor,
  normalizeAuthorCandidate,
  normalizeAuthorList,
  createAuthorDisplay,
  getComparableAuthorTuple,
};
