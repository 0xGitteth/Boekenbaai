'use strict';

const {
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
  stringifyIdentifierValue,
  normalizeLegacyIdentifier,
  compareStableText,
  encodeIdentityTuple,
  getOwnDataValue,
} = require('./book-edition-utils');
const {
  getEditionIsbnEvidence,
  canonicalizeBookIsbn13,
  isbnValuesMatch,
} = require('./book-edition-isbn');
const {
  normalizeAuthorList,
  createAuthorDisplay,
  getComparableAuthorTuple,
} = require('./book-edition-authors');
const { normalizeBookIdentityShape } = require('./book-edition-identity');

function representativeScore(book) {
  const title = normalizeBookIdentityText(getOwnDataValue(book, 'title'));
  const authors = normalizeAuthorList(getOwnDataValue(book, 'authors'), getOwnDataValue(book, 'author'));
  const authorDisplay = createAuthorDisplay(authors);
  const rawId = stringifyIdentifierValue(getOwnDataValue(book, 'id'));
  return {
    title: title ? 1 : 0,
    authors: authors.length,
    authorChars: authorDisplay.length,
    comparableLexical: encodeIdentityTuple([
      normalizeBookIdentityComparable(title),
      getComparableAuthorTuple(authors),
      normalizeBookIdentityComparable(rawId),
    ]),
    rawLexical: encodeIdentityTuple([title, authors.map(normalizeBookIdentityText), rawId]),
  };
}

function pickRepresentativeBook(books) {
  const copies = Array.isArray(books) ? books : [];
  if (!copies.length) return {};
  return copies.slice().sort((left, right) => {
    const a = representativeScore(left); const b = representativeScore(right);
    if (a.title !== b.title) return b.title - a.title;
    if (a.authors !== b.authors) return b.authors - a.authors;
    if (a.authorChars !== b.authorChars) return b.authorChars - a.authorChars;
    const comparable = compareStableText(a.comparableLexical, b.comparableLexical);
    return comparable || compareStableText(a.rawLexical, b.rawLexical);
  })[0];
}

function createEditionGroup(key, books, options = {}) {
  const copies = books.map(normalizeBookIdentityShape);
  const representative = pickRepresentativeBook(copies);
  return {
    key,
    editionIsbn: options.forceNoEditionIsbn ? '' : (getOwnDataValue(representative, 'editionIsbn') || ''),
    title: normalizeBookIdentityText(getOwnDataValue(representative, 'title')),
    author: getOwnDataValue(representative, 'author') || '',
    authors: [...(getOwnDataValue(representative, 'authors') || [])],
    hasIdentityConflict: Boolean(options.hasIdentityConflict),
    copies,
    firstSeenIndex: Number.isInteger(options.firstSeenIndex) ? options.firstSeenIndex : Number.MAX_SAFE_INTEGER,
  };
}

function createUnresolvedGroup(book, index) {
  return createEditionGroup(`unresolved-input||${index}`, [book], {
    hasIdentityConflict: true,
    firstSeenIndex: index,
    forceNoEditionIsbn: true,
  });
}

function createConflictReference(bucket) {
  const copyIds = Array.from(new Set(bucket.map((book) => stringifyIdentifierValue(getOwnDataValue(book, 'id'))).filter(Boolean))).sort(compareStableText);
  const inputIndexes = Array.from(new Set(bucket.map((book) => getOwnDataValue(book, '__identityOrder')).filter(Number.isInteger))).sort((a, b) => a - b);
  return { copyIds, inputIndexes };
}
function minIdentityOrder(bucket) {
  return bucket.reduce((minimum, book) => Math.min(minimum, getOwnDataValue(book, '__identityOrder')), Number.MAX_SAFE_INTEGER);
}

function storedEvidenceSummary(normalized) {
  const stored = getOwnDataValue(normalized, 'editionIsbnEvidence');
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return getEditionIsbnEvidence(normalized);
  const candidates = Array.isArray(getOwnDataValue(stored, 'candidates')) ? [...getOwnDataValue(stored, 'candidates')] : [];
  const invalidOfficialFields = Array.isArray(getOwnDataValue(stored, 'invalidOfficialFields'))
    ? getOwnDataValue(stored, 'invalidOfficialFields').map((entry) => ({ ...entry })) : [];
  const candidateSources = Array.isArray(getOwnDataValue(stored, 'candidateSources'))
    ? getOwnDataValue(stored, 'candidateSources').map((entry) => ({ ...entry })) : [];
  return {
    candidates,
    candidateSources,
    invalidOfficialFields,
    hasConflictingCandidates: candidates.length > 1,
    hasInvalidOfficialFields: invalidOfficialFields.length > 0,
    canonicalIsbn: candidates.length === 1 && invalidOfficialFields.length === 0 ? candidates[0] : '',
  };
}

function legacyIdentifierValuesMatch(left, right) {
  if (isbnValuesMatch(left, right)) return true;
  const leftCanonical = canonicalizeBookIsbn13(left); const rightCanonical = canonicalizeBookIsbn13(right);
  if (leftCanonical || rightCanonical) return false;
  const a = normalizeLegacyIdentifier(left); const b = normalizeLegacyIdentifier(right);
  return Boolean(a && b && a === b);
}

module.exports = {
  pickRepresentativeBook,
  legacyIdentifierValuesMatch,
  createEditionGroup,
  createUnresolvedGroup,
  createConflictReference,
  minIdentityOrder,
  storedEvidenceSummary,
};
