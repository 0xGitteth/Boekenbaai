'use strict';

const {
  canonicalizeBookIsbn13,
  normalizeBookIdentityText,
  normalizeAuthorList,
  createAuthorDisplay,
  getOwnDataValue,
} = require('./book-edition-core');
const {
  addIssue,
  comparableText,
  splitTagValue,
  normalizeYear,
  normalizePageCount,
  normalizeLanguage,
} = require('./book-import-analysis-values');

function ownObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function metadataPayloadFromResult(result) {
  const object = ownObject(result);
  if (!object || getOwnDataValue(object, 'found') === false) return null;
  const metadata = ownObject(getOwnDataValue(object, 'metadata'));
  if (metadata && getOwnDataValue(metadata, 'found') !== false) return metadata;
  const fields = ownObject(getOwnDataValue(object, 'fields'));
  if (fields && getOwnDataValue(fields, 'found') !== false) return fields;
  return object;
}

function metadataAuthors(payload) {
  return normalizeAuthorList(getOwnDataValue(payload, 'authors'), getOwnDataValue(payload, 'author'));
}

function metadataEditionIsbn(payload) {
  for (const candidate of [
    getOwnDataValue(payload, 'editionIsbn'),
    getOwnDataValue(payload, 'isbn13'),
    getOwnDataValue(payload, 'isbn'),
    getOwnDataValue(payload, 'metadataIsbn'),
  ]) {
    const canonical = canonicalizeBookIsbn13(candidate);
    if (canonical) return canonical;
  }
  return '';
}

function firstPresent(payload, keys) {
  for (const key of keys) {
    const value = getOwnDataValue(payload, key);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
}

function normalizeMetadataCandidate(result) {
  const payload = metadataPayloadFromResult(result);
  if (!payload) return null;
  const authors = metadataAuthors(payload);
  const title = normalizeBookIdentityText(getOwnDataValue(payload, 'title'));
  const publisher = normalizeBookIdentityText(getOwnDataValue(payload, 'publisher'));
  const publishedYear = normalizeYear(firstPresent(payload, ['publishedYear', 'year']));
  const pageCount = normalizePageCount(firstPresent(payload, ['pageCount', 'pages']));
  const language = normalizeLanguage(getOwnDataValue(payload, 'language'));
  const coverUrl = normalizeBookIdentityText(getOwnDataValue(payload, 'coverUrl'));
  const description = normalizeBookIdentityText(getOwnDataValue(payload, 'description'));
  const rawTags = getOwnDataValue(payload, 'tags');
  const rawThemes = getOwnDataValue(payload, 'themes');
  const tags = splitTagValue(Array.isArray(rawTags) ? rawTags.join(';') : rawTags);
  const themes = splitTagValue(Array.isArray(rawThemes) ? rawThemes.join(';') : rawThemes);
  const source = normalizeBookIdentityText(getOwnDataValue(payload, 'source'));
  const editionIsbn = metadataEditionIsbn(payload);
  if (!title && !authors.length && !publisher && !publishedYear && !pageCount && !language && !coverUrl
    && !description && !tags.length && !themes.length && !editionIsbn) return null;
  return {
    title,
    author: createAuthorDisplay(authors),
    authors,
    editionIsbn,
    publisher,
    publishedYear,
    pageCount,
    language,
    coverUrl,
    description,
    tags,
    themes,
    source,
  };
}

function metadataCandidatesFromResult(result) {
  if (Array.isArray(result)) return result.map(normalizeMetadataCandidate).filter(Boolean);
  const object = ownObject(result);
  if (!object || getOwnDataValue(object, 'found') === false) return [];
  const candidates = getOwnDataValue(object, 'candidates');
  if (Array.isArray(candidates)) return candidates.map(normalizeMetadataCandidate).filter(Boolean);
  const normalized = normalizeMetadataCandidate(object);
  return normalized ? [normalized] : [];
}

function strictMetadataMatch(rowBook, candidate) {
  const rowTitle = comparableText(rowBook.title);
  const candidateTitle = comparableText(candidate.title);
  if (!rowTitle || !candidateTitle || rowTitle !== candidateTitle) return false;
  const rowAuthors = normalizeAuthorList(rowBook.authors, rowBook.author).map(comparableText).filter(Boolean);
  const candidateAuthors = normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).filter(Boolean);
  if (!rowAuthors.length) return true;
  if (!candidateAuthors.length) return false;
  return rowAuthors.every((author) => candidateAuthors.includes(author));
}

function candidateScore(candidate) {
  return [
    candidate.editionIsbn ? 1 : 0,
    candidate.coverUrl ? 1 : 0,
    candidate.publisher ? 1 : 0,
    candidate.description ? 1 : 0,
    candidate.publishedYear ? 1 : 0,
    candidate.pageCount ? 1 : 0,
    candidate.language ? 1 : 0,
    candidate.tags.length,
    candidate.themes.length,
  ].reduce((sum, value) => sum + value, 0);
}

function selectMetadataCandidate(rowBook, candidates) {
  const strict = candidates.filter((candidate) => strictMetadataMatch(rowBook, candidate));
  if (!strict.length) return { candidate: null, conflict: null };
  const editionIsbns = Array.from(new Set(strict.map((candidate) => candidate.editionIsbn).filter(Boolean))).sort();
  if (editionIsbns.length > 1) return { candidate: null, conflict: { code: 'ambiguous_metadata_editions', editionIsbns } };
  if (strict.length > 1 && !editionIsbns.length) {
    const signatures = new Set(strict.map((candidate) => JSON.stringify([
      comparableText(candidate.title),
      normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).sort(),
      comparableText(candidate.publisher),
      candidate.publishedYear,
      candidate.pageCount,
      comparableText(candidate.language),
    ])));
    if (signatures.size > 1) return { candidate: null, conflict: { code: 'ambiguous_metadata_results' } };
  }
  const ranked = strict.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  return { candidate: ranked[0], conflict: null };
}

function selectIsbnMetadataCandidate(requestedIsbn, candidates) {
  const requested = canonicalizeBookIsbn13(requestedIsbn);
  if (!requested) return { candidate: null, conflict: null };
  const matching = [];
  const mismatched = [];
  for (const candidate of candidates) {
    if (!candidate.editionIsbn || candidate.editionIsbn === requested) matching.push(candidate);
    else mismatched.push(candidate);
  }
  if (mismatched.length) {
    return {
      candidate: null,
      conflict: {
        code: 'ambiguous_isbn_lookup_results',
        requestedIsbn: requested,
        returnedIsbns: Array.from(new Set(mismatched.map((candidate) => candidate.editionIsbn))).sort(),
      },
    };
  }
  if (!matching.length) return { candidate: null, conflict: null };
  const ranked = matching.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  return { candidate: ranked[0], conflict: null };
}

function setMetadataField(row, field, value, candidate) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
  const current = row.book[field];
  const currentEmpty = current === null || current === undefined || current === '' || (Array.isArray(current) && !current.length);
  if (field === 'tags' && Array.isArray(value) && row.provenance.tags?.source !== 'excel') {
    const merged = Array.isArray(current) ? [...current] : [];
    for (const tag of value) {
      if (!merged.some((existing) => comparableText(existing) === comparableText(tag))) merged.push(tag);
    }
    row.book.tags = merged;
    row.provenance.tags = { source: 'metadata', detail: candidate.source || null, includesDerivedValues: Boolean(current?.length) };
    return;
  }
  if (currentEmpty) {
    row.book[field] = Array.isArray(value) ? [...value] : value;
    row.provenance[field] = { source: 'metadata', detail: candidate.source || null };
    return;
  }
  const same = JSON.stringify(current) === JSON.stringify(value)
    || (typeof current === 'string' && typeof value === 'string' && comparableText(current) === comparableText(value));
  if (!same) addIssue(row, 'metadata_differs_from_excel', 'warning', { field, excelValue: current, metadataValue: value });
}

function applyMetadataCandidate(row, candidate, { allowIsbnResolution = false } = {}) {
  if (!candidate) return;
  if (allowIsbnResolution && !row.book.editionIsbn && candidate.editionIsbn) {
    row.book.editionIsbn = candidate.editionIsbn;
    row.provenance.editionIsbn = { source: 'metadata', detail: candidate.source || null };
    addIssue(row, 'isbn_resolved_from_metadata', 'warning', { editionIsbn: candidate.editionIsbn });
  } else if (row.book.editionIsbn && candidate.editionIsbn && row.book.editionIsbn !== candidate.editionIsbn) {
    addIssue(row, 'metadata_isbn_differs', 'conflict', { excelIsbn: row.book.editionIsbn, metadataIsbn: candidate.editionIsbn });
  }
  setMetadataField(row, 'title', candidate.title, candidate);
  if (!row.book.author && candidate.author) {
    row.book.author = candidate.author;
    row.book.authors = [...candidate.authors];
    row.provenance.author = { source: 'metadata', detail: candidate.source || null };
  } else if (candidate.author && comparableText(row.book.author) !== comparableText(candidate.author)) {
    addIssue(row, 'metadata_differs_from_excel', 'warning', { field: 'author', excelValue: row.book.author, metadataValue: candidate.author });
  }
  setMetadataField(row, 'publisher', candidate.publisher, candidate);
  setMetadataField(row, 'publishedYear', candidate.publishedYear, candidate);
  setMetadataField(row, 'pageCount', candidate.pageCount, candidate);
  setMetadataField(row, 'language', candidate.language, candidate);
  setMetadataField(row, 'coverUrl', candidate.coverUrl, candidate);
  setMetadataField(row, 'description', candidate.description, candidate);
  setMetadataField(row, 'tags', candidate.tags, candidate);
  setMetadataField(row, 'themes', candidate.themes, candidate);
}

async function resolveMetadata(row, options) {
  const lookupIsbn = typeof options.lookupIsbn === 'function' ? options.lookupIsbn : null;
  const lookupTitleAuthor = typeof options.lookupTitleAuthor === 'function' ? options.lookupTitleAuthor : null;
  const hasMissingMetadata = () => !row.book.title || !row.book.author || !row.book.publisher || row.book.publishedYear == null
    || row.book.pageCount == null || !row.book.language || !row.book.coverUrl || !row.book.description;
  if (row.book.editionIsbn && lookupIsbn && hasMissingMetadata()) {
    try {
      const result = await lookupIsbn(row.book.editionIsbn, { title: row.book.title, author: row.book.author });
      const candidates = metadataCandidatesFromResult(result);
      const selection = selectIsbnMetadataCandidate(row.book.editionIsbn, candidates);
      if (selection.conflict) addIssue(row, selection.conflict.code, 'conflict', selection.conflict);
      else if (selection.candidate) applyMetadataCandidate(row, selection.candidate);
      else if (candidates.length) addIssue(row, 'metadata_not_usable', 'warning');
    } catch {
      addIssue(row, 'metadata_lookup_failed', 'warning', { lookup: 'isbn' });
    }
  }

  const hasPotentialIdentifierProblem = !row.book.editionIsbn && row.identifierAnalysis
    && [row.identifierAnalysis.explicit, row.identifierAnalysis.legacy, row.identifierAnalysis.ambiguous]
      .some((analysis) => analysis.raw && !analysis.canonical);
  const shouldLookupByTitle = lookupTitleAuthor && row.book.title && row.book.author
    && (!row.book.editionIsbn || hasMissingMetadata() || hasPotentialIdentifierProblem);
  if (!shouldLookupByTitle) return;
  try {
    const result = await lookupTitleAuthor({ title: row.book.title, author: row.book.author, language: row.book.language });
    const candidates = metadataCandidatesFromResult(result);
    const selection = selectMetadataCandidate(row.book, candidates);
    if (selection.conflict) {
      addIssue(row, selection.conflict.code, 'conflict', selection.conflict);
      return;
    }
    if (!selection.candidate) {
      if (candidates.length) addIssue(row, 'metadata_not_strict_match', 'warning');
      return;
    }
    applyMetadataCandidate(row, selection.candidate, { allowIsbnResolution: true });
  } catch {
    addIssue(row, 'metadata_lookup_failed', 'warning', { lookup: 'title_author' });
  }
}

module.exports = {
  normalizeMetadataCandidate,
  metadataCandidatesFromResult,
  strictMetadataMatch,
  selectMetadataCandidate,
  selectIsbnMetadataCandidate,
  resolveMetadata,
};
