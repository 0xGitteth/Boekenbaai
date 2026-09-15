'use strict';

const {
  normalizeBookIdentityComparable,
  normalizeLegacyIdentifier,
  encodeIdentityTuple,
  getOwnDataValue,
  cloneJsonSafeOwnData,
} = require('./book-edition-utils');
const {
  getEditionIsbnEvidence,
  createEditionFieldSnapshot,
  createEditionSemanticSnapshot,
} = require('./book-edition-isbn');
const {
  normalizeAuthorList,
  createAuthorDisplay,
  getComparableAuthorTuple,
} = require('./book-edition-authors');

function getLegacyEditionTuple(book) {
  const source = book && typeof book === 'object' ? book : {};
  return [
    normalizeBookIdentityComparable(getOwnDataValue(source, 'title')),
    getComparableAuthorTuple(getOwnDataValue(source, 'authors'), getOwnDataValue(source, 'author')),
    normalizeLegacyIdentifier(getOwnDataValue(source, 'metadataIsbn')),
  ];
}

function hasLegacyIdentityEvidence(tuple) {
  if (!Array.isArray(tuple) || tuple.length !== 3) return false;
  const [title, authors, metadataIdentifier] = tuple;
  return Boolean(title && ((Array.isArray(authors) && authors.length) || metadataIdentifier));
}

function getLegacyEditionKey(book) {
  const tuple = getLegacyEditionTuple(book);
  return hasLegacyIdentityEvidence(tuple) ? `legacy||${encodeIdentityTuple(tuple)}` : null;
}

function getEditionKey(book) {
  const evidence = getEditionIsbnEvidence(book);
  if (evidence.hasConflictingCandidates || evidence.hasInvalidOfficialFields) return null;
  if (evidence.canonicalIsbn) return `isbn13||${evidence.canonicalIsbn}`;
  return getLegacyEditionKey(book);
}

function normalizeBookIdentityShape(book) {
  const source = book && typeof book === 'object' && !Array.isArray(book) ? book : {};
  const safe = cloneJsonSafeOwnData(source) || {};
  const authors = normalizeAuthorList(getOwnDataValue(source, 'authors'), getOwnDataValue(source, 'author'));
  const author = createAuthorDisplay(authors, getOwnDataValue(source, 'author'));
  const evidence = getEditionIsbnEvidence(source);
  const normalized = {
    ...safe,
    author,
    authors,
    editionIsbn: evidence.canonicalIsbn,
  };
  return {
    ...normalized,
    editionIsbnEvidence: {
      candidates: [...evidence.candidates],
      candidateSources: evidence.candidateSources.map((entry) => ({ ...entry })),
      invalidOfficialFields: evidence.invalidOfficialFields.map((entry) => ({ ...entry })),
      fieldSnapshot: createEditionFieldSnapshot(normalized),
      fieldSemanticSnapshot: createEditionSemanticSnapshot(normalized),
    },
  };
}

module.exports = {
  getLegacyEditionTuple,
  getLegacyEditionKey,
  getEditionKey,
  normalizeBookIdentityShape,
};
