'use strict';

const {
  normalizeBookIdentityText,
  normalizeBookIdentityComparable,
  stringifyIdentifierValue,
  normalizeLegacyIdentifier,
  compareStableText,
  encodeIdentityTuple,
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

function getLegacyEditionTuple(book) {
  const source = book && typeof book === 'object' ? book : {};
  return [
    normalizeBookIdentityComparable(source.title),
    getComparableAuthorTuple(source.authors, source.author),
    normalizeLegacyIdentifier(source.metadataIsbn),
  ];
}

function hasLegacyIdentityEvidence(tuple) {
  if (!Array.isArray(tuple) || tuple.length !== 3) return false;
  const [title, authors, metadataIdentifier] = tuple;
  return Boolean(title && ((Array.isArray(authors) && authors.length) || metadataIdentifier));
}

function getLegacyEditionKey(book) {
  const tuple = getLegacyEditionTuple(book);
  if (!hasLegacyIdentityEvidence(tuple)) return null;
  return `legacy||${encodeIdentityTuple(tuple)}`;
}

function getEditionKey(book) {
  const evidence = getEditionIsbnEvidence(book);
  if (evidence.hasConflictingCandidates || evidence.hasInvalidOfficialFields) return null;
  if (evidence.canonicalIsbn) return `isbn13||${evidence.canonicalIsbn}`;
  return getLegacyEditionKey(book);
}

function normalizeBookIdentityShape(book) {
  const source = book && typeof book === 'object' ? book : {};
  const authors = normalizeAuthorList(source.authors, source.author);
  const author = createAuthorDisplay(authors, source.author);
  const evidence = getEditionIsbnEvidence(source);
  return {
    ...source,
    author,
    authors,
    editionIsbn: evidence.canonicalIsbn,
    editionIsbnEvidence: {
      candidates: [...evidence.candidates],
      candidateSources: evidence.candidateSources.map((entry) => ({ ...entry })),
      invalidOfficialFields: evidence.invalidOfficialFields.map((entry) => ({ ...entry })),
      fieldSnapshot: { ...evidence.fieldSnapshot },
    },
  };
}

function representativeScore(book) {
  const title = normalizeBookIdentityText(book?.title);
  const authors = normalizeAuthorList(book?.authors, book?.author);
  const authorDisplay = createAuthorDisplay(authors);
  const comparableAuthors = getComparableAuthorTuple(authors);
  const rawAuthors = authors.map((author) => normalizeBookIdentityText(author));
  const rawId = stringifyIdentifierValue(book?.id);
  return {
    title: title ? 1 : 0,
    authors: authors.length,
    authorChars: authorDisplay.length,
    comparableLexical: encodeIdentityTuple([
      normalizeBookIdentityComparable(title),
      comparableAuthors,
      normalizeBookIdentityComparable(rawId),
    ]),
    rawLexical: encodeIdentityTuple([title, rawAuthors, rawId]),
  };
}

function pickRepresentativeBook(books) {
  const copies = Array.isArray(books) ? books : [];
  if (!copies.length) return {};
  return copies.slice().sort((left, right) => {
    const a = representativeScore(left);
    const b = representativeScore(right);
    if (a.title !== b.title) return b.title - a.title;
    if (a.authors !== b.authors) return b.authors - a.authors;
    if (a.authorChars !== b.authorChars) return b.authorChars - a.authorChars;
    const comparable = compareStableText(a.comparableLexical, b.comparableLexical);
    if (comparable !== 0) return comparable;
    return compareStableText(a.rawLexical, b.rawLexical);
  })[0];
}

function createEditionGroup(key, books, options = {}) {
  const copies = books.map((book) => normalizeBookIdentityShape(book));
  const representative = pickRepresentativeBook(copies);
  return {
    key,
    editionIsbn: options.forceNoEditionIsbn ? '' : (representative.editionIsbn || ''),
    title: normalizeBookIdentityText(representative.title),
    author: representative.author || '',
    authors: [...(representative.authors || [])],
    hasIdentityConflict: Boolean(options.hasIdentityConflict),
    copies,
    firstSeenIndex: Number.isInteger(options.firstSeenIndex)
      ? options.firstSeenIndex
      : Number.MAX_SAFE_INTEGER,
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
  const copyIds = Array.from(new Set(bucket
    .map((book) => stringifyIdentifierValue(book.id))
    .filter(Boolean)))
    .sort(compareStableText);
  const inputIndexes = Array.from(new Set(bucket
    .map((book) => book.__identityOrder)
    .filter(Number.isInteger)))
    .sort((left, right) => left - right);
  return { copyIds, inputIndexes };
}

function minIdentityOrder(bucket) {
  return bucket.reduce(
    (minimum, book) => Math.min(minimum, book.__identityOrder),
    Number.MAX_SAFE_INTEGER,
  );
}

function groupBookCopiesByEdition(books = []) {
  const normalizedBooks = (Array.isArray(books) ? books : [])
    .map((book, index) => ({ book, index }))
    .filter(({ book }) => book && typeof book === 'object' && !Array.isArray(book))
    .map(({ book, index }) => {
      const normalized = normalizeBookIdentityShape(book);
      return {
        ...normalized,
        __identityOrder: index,
        __editionIsbnEvidence: getEditionIsbnEvidence(normalized),
      };
    });

  const canonicalBuckets = new Map();
  const legacyBuckets = new Map();
  const unresolved = [];
  const groups = [];
  const conflicts = [];

  for (const book of normalizedBooks) {
    const evidence = book.__editionIsbnEvidence;
    if (evidence.hasInvalidOfficialFields) {
      unresolved.push(book);
      conflicts.push({
        type: 'invalid_official_isbn',
        invalidFields: evidence.invalidOfficialFields.map((entry) => ({ ...entry })),
        editionIsbns: [...evidence.candidates],
        candidateSources: evidence.candidateSources.map((entry) => ({ ...entry })),
        hasConflictingCandidates: evidence.hasConflictingCandidates,
        ...createConflictReference([book]),
      });
      continue;
    }
    if (evidence.hasConflictingCandidates) {
      unresolved.push(book);
      conflicts.push({
        type: 'conflicting_edition_isbns',
        editionIsbns: [...evidence.candidates],
        candidateSources: evidence.candidateSources.map((entry) => ({ ...entry })),
        ...createConflictReference([book]),
      });
      continue;
    }
    if (book.editionIsbn) {
      const bucket = canonicalBuckets.get(book.editionIsbn) || [];
      bucket.push(book);
      canonicalBuckets.set(book.editionIsbn, bucket);
      continue;
    }

    const key = getLegacyEditionKey(book);
    if (!key) {
      unresolved.push(book);
      conflicts.push({ type: 'missing_identity', ...createConflictReference([book]) });
      continue;
    }
    const bucket = legacyBuckets.get(key) || [];
    bucket.push(book);
    legacyBuckets.set(key, bucket);
  }

  for (const [editionIsbn, bucket] of canonicalBuckets.entries()) {
    const titleBuckets = new Map();
    const booksWithoutTitle = [];
    for (const book of bucket) {
      const titleKey = normalizeBookIdentityComparable(book.title);
      if (!titleKey) {
        booksWithoutTitle.push(book);
        continue;
      }
      const titleBucket = titleBuckets.get(titleKey) || [];
      titleBucket.push(book);
      titleBuckets.set(titleKey, titleBucket);
    }

    if (titleBuckets.size <= 1) {
      groups.push(createEditionGroup(`isbn13||${editionIsbn}`, bucket, {
        firstSeenIndex: minIdentityOrder(bucket),
      }));
      continue;
    }

    conflicts.push({
      type: 'same_isbn_different_title',
      editionIsbn,
      titles: Array.from(titleBuckets.entries())
        .sort(([left], [right]) => compareStableText(left, right))
        .map(([, titleBucket]) => normalizeBookIdentityText(pickRepresentativeBook(titleBucket).title)),
      ...createConflictReference(bucket),
    });

    for (const [titleKey, titleBucket] of titleBuckets.entries()) {
      groups.push(createEditionGroup(
        `conflict-isbn13||${encodeIdentityTuple([editionIsbn, titleKey])}`,
        titleBucket,
        {
          hasIdentityConflict: true,
          firstSeenIndex: minIdentityOrder(titleBucket),
        },
      ));
    }
    if (booksWithoutTitle.length) {
      groups.push(createEditionGroup(
        `conflict-isbn13||${encodeIdentityTuple([editionIsbn, null])}`,
        booksWithoutTitle,
        {
          hasIdentityConflict: true,
          firstSeenIndex: minIdentityOrder(booksWithoutTitle),
        },
      ));
    }
  }

  for (const [key, bucket] of legacyBuckets.entries()) {
    groups.push(createEditionGroup(key, bucket, {
      firstSeenIndex: minIdentityOrder(bucket),
    }));
  }
  for (const book of unresolved) {
    groups.push(createUnresolvedGroup(book, book.__identityOrder));
  }

  groups.sort((left, right) => left.firstSeenIndex - right.firstSeenIndex);
  conflicts.sort((left, right) => {
    const leftIndex = left.inputIndexes?.[0] ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.inputIndexes?.[0] ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return compareStableText(left.type || '', right.type || '');
  });
  for (const group of groups) {
    delete group.firstSeenIndex;
    for (const copy of group.copies) {
      delete copy.__identityOrder;
      delete copy.__editionIsbnEvidence;
    }
  }
  return { groups, conflicts };
}

function legacyIdentifierValuesMatch(left, right) {
  if (isbnValuesMatch(left, right)) return true;
  const leftCanonical = canonicalizeBookIsbn13(left);
  const rightCanonical = canonicalizeBookIsbn13(right);
  if (leftCanonical || rightCanonical) return false;
  const leftNormalized = normalizeLegacyIdentifier(left);
  const rightNormalized = normalizeLegacyIdentifier(right);
  return Boolean(leftNormalized && rightNormalized && leftNormalized === rightNormalized);
}

module.exports = {
  getLegacyEditionTuple,
  getLegacyEditionKey,
  getEditionKey,
  normalizeBookIdentityShape,
  pickRepresentativeBook,
  groupBookCopiesByEdition,
  legacyIdentifierValuesMatch,
};
