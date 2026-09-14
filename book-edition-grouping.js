'use strict';

const {
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
  compareStableText,
  encodeIdentityTuple,
  getOwnDataValue,
} = require('./book-edition-utils');
const {
  getLegacyEditionTuple,
  getLegacyEditionKey,
  getEditionKey,
  normalizeBookIdentityShape,
} = require('./book-edition-identity');
const {
  pickRepresentativeBook,
  legacyIdentifierValuesMatch,
  createEditionGroup,
  createUnresolvedGroup,
  createConflictReference,
  minIdentityOrder,
  storedEvidenceSummary,
} = require('./book-edition-representative');

function groupBookCopiesByEdition(books = []) {
  const normalizedBooks = (Array.isArray(books) ? books : [])
    .map((book, index) => ({ book, index }))
    .filter(({ book }) => book && typeof book === 'object' && !Array.isArray(book))
    .map(({ book, index }) => {
      const normalized = normalizeBookIdentityShape(book);
      return { ...normalized, __identityOrder: index, __editionIsbnEvidence: storedEvidenceSummary(normalized) };
    });
  const canonicalBuckets = new Map(); const legacyBuckets = new Map(); const unresolved = [];
  const groups = []; const conflicts = [];
  for (const book of normalizedBooks) {
    const evidence = book.__editionIsbnEvidence;
    if (evidence.hasInvalidOfficialFields) {
      unresolved.push(book);
      conflicts.push({ type: 'invalid_official_isbn', invalidFields: evidence.invalidOfficialFields.map((e) => ({ ...e })), editionIsbns: [...evidence.candidates], candidateSources: evidence.candidateSources.map((e) => ({ ...e })), hasConflictingCandidates: evidence.hasConflictingCandidates, ...createConflictReference([book]) });
      continue;
    }
    if (evidence.hasConflictingCandidates) {
      unresolved.push(book);
      conflicts.push({ type: 'conflicting_edition_isbns', editionIsbns: [...evidence.candidates], candidateSources: evidence.candidateSources.map((e) => ({ ...e })), ...createConflictReference([book]) });
      continue;
    }
    if (book.editionIsbn) {
      const bucket = canonicalBuckets.get(book.editionIsbn) || []; bucket.push(book); canonicalBuckets.set(book.editionIsbn, bucket); continue;
    }
    const key = getLegacyEditionKey(book);
    if (!key) { unresolved.push(book); conflicts.push({ type: 'missing_identity', ...createConflictReference([book]) }); continue; }
    const bucket = legacyBuckets.get(key) || []; bucket.push(book); legacyBuckets.set(key, bucket);
  }

  for (const [editionIsbn, bucket] of canonicalBuckets.entries()) {
    const titleBuckets = new Map(); const booksWithoutTitle = [];
    for (const book of bucket) {
      const titleKey = normalizeBookIdentityComparable(getOwnDataValue(book, 'title'));
      if (!titleKey) { booksWithoutTitle.push(book); continue; }
      const titleBucket = titleBuckets.get(titleKey) || []; titleBucket.push(book); titleBuckets.set(titleKey, titleBucket);
    }
    if (titleBuckets.size <= 1) {
      groups.push(createEditionGroup(`isbn13||${editionIsbn}`, bucket, { firstSeenIndex: minIdentityOrder(bucket) }));
      continue;
    }
    conflicts.push({
      type: 'same_isbn_different_title', editionIsbn,
      titles: Array.from(titleBuckets.entries()).sort(([a], [b]) => compareStableText(a, b)).map(([, b]) => normalizeBookIdentityText(getOwnDataValue(pickRepresentativeBook(b), 'title'))),
      ...createConflictReference(bucket),
    });
    for (const [titleKey, titleBucket] of titleBuckets.entries()) {
      groups.push(createEditionGroup(`conflict-isbn13||${encodeIdentityTuple([editionIsbn, titleKey])}`, titleBucket, { hasIdentityConflict: true, firstSeenIndex: minIdentityOrder(titleBucket) }));
    }
    if (booksWithoutTitle.length) {
      groups.push(createEditionGroup(`conflict-isbn13||${encodeIdentityTuple([editionIsbn, null])}`, booksWithoutTitle, { hasIdentityConflict: true, firstSeenIndex: minIdentityOrder(booksWithoutTitle) }));
    }
  }
  for (const [key, bucket] of legacyBuckets.entries()) groups.push(createEditionGroup(key, bucket, { firstSeenIndex: minIdentityOrder(bucket) }));
  for (const book of unresolved) groups.push(createUnresolvedGroup(book, book.__identityOrder));
  groups.sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
  conflicts.sort((a, b) => ((a.inputIndexes?.[0] ?? Number.MAX_SAFE_INTEGER) - (b.inputIndexes?.[0] ?? Number.MAX_SAFE_INTEGER)) || compareStableText(a.type || '', b.type || ''));
  for (const group of groups) {
    delete group.firstSeenIndex;
    for (const copy of group.copies) { delete copy.__identityOrder; delete copy.__editionIsbnEvidence; }
  }
  return { groups, conflicts };
}

module.exports = {
  getLegacyEditionTuple, getLegacyEditionKey, getEditionKey, normalizeBookIdentityShape,
  pickRepresentativeBook, groupBookCopiesByEdition, legacyIdentifierValuesMatch,
};
