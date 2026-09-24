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
  const rawAuthors = getOwnDataValue(payload, 'authors');
  const rawAuthor = normalizeBookIdentityText(getOwnDataValue(payload, 'author'));
  if (Array.isArray(rawAuthors) && rawAuthors.length) return normalizeAuthorList(rawAuthors, rawAuthor);
  if (!rawAuthor) return [];
  const displayParts = rawAuthor
    .split(/[;\n\r]+|\s+&\s+/)
    .map((entry) => normalizeBookIdentityText(entry))
    .filter(Boolean);
  if (displayParts.length > 1) return normalizeAuthorList(displayParts, rawAuthor);
  return normalizeAuthorList(undefined, rawAuthor);
}

function metadataEditionEvidence(payload) {
  const evidence = [];
  for (const field of ['editionIsbn', 'isbn13', 'isbn', 'metadataIsbn', 'barcode']) {
    const canonical = canonicalizeBookIsbn13(getOwnDataValue(payload, field));
    if (canonical) evidence.push({ field, canonical });
  }
  const editionIsbns = Array.from(new Set(evidence.map((entry) => entry.canonical))).sort();
  return {
    editionIsbn: editionIsbns.length === 1 ? editionIsbns[0] : '',
    editionIsbns,
    evidence,
  };
}

function firstNormalized(payload, keys, normalizer) {
  for (const key of keys) {
    const value = getOwnDataValue(payload, key);
    if (value === null || value === undefined || value === '') continue;
    const normalized = normalizer(value);
    if (normalized !== null && normalized !== undefined && normalized !== '') return normalized;
  }
  return null;
}

function normalizeMetadataCandidate(result) {
  const wrapper = ownObject(result);
  const wrapperSource = normalizeBookIdentityText(getOwnDataValue(wrapper, 'source'));
  const payload = metadataPayloadFromResult(result);
  if (!payload) return null;
  const authors = metadataAuthors(payload);
  const title = normalizeBookIdentityText(getOwnDataValue(payload, 'title'));
  const publisher = normalizeBookIdentityText(getOwnDataValue(payload, 'publisher'));
  const publishedYear = firstNormalized(payload, ['publishedYear', 'year', 'publishedAt'], normalizeYear);
  const pageCount = firstNormalized(payload, ['pageCount', 'pages'], normalizePageCount);
  const language = normalizeLanguage(getOwnDataValue(payload, 'language'));
  const coverUrl = normalizeBookIdentityText(getOwnDataValue(payload, 'coverUrl'));
  const description = normalizeBookIdentityText(getOwnDataValue(payload, 'description'));
  const rawTags = getOwnDataValue(payload, 'tags');
  const rawThemes = getOwnDataValue(payload, 'themes');
  const tags = splitTagValue(Array.isArray(rawTags) ? rawTags.join(';') : rawTags);
  const themes = splitTagValue(Array.isArray(rawThemes) ? rawThemes.join(';') : rawThemes);
  const source = normalizeBookIdentityText(getOwnDataValue(payload, 'source')) || wrapperSource;
  const identifierEvidence = metadataEditionEvidence(payload);
  if (!title && !authors.length && !publisher && !publishedYear && !pageCount && !language && !coverUrl
    && !description && !tags.length && !themes.length && !identifierEvidence.editionIsbns.length) return null;
  return {
    title,
    author: createAuthorDisplay(authors),
    authors,
    editionIsbn: identifierEvidence.editionIsbn,
    identifierIsbns: identifierEvidence.editionIsbns,
    identifierEvidence: identifierEvidence.evidence,
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
  if (Array.isArray(candidates)) {
    const wrapperSource = normalizeBookIdentityText(getOwnDataValue(object, 'source'));
    return candidates.map(normalizeMetadataCandidate).filter(Boolean).map((candidate) => (
      candidate.source || !wrapperSource ? candidate : { ...candidate, source: wrapperSource }
    ));
  }
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
  if (!candidateAuthors.length || rowAuthors.length !== candidateAuthors.length) return false;
  return rowAuthors.every((author) => candidateAuthors.includes(author));
}

function metadataDoesNotContradict(rowBook, candidate, rowProvenance = null) {
  const rowTitle = comparableText(rowBook.title);
  const candidateTitle = comparableText(candidate.title);
  if (rowTitle && candidateTitle && rowTitle !== candidateTitle) return false;
  const rowAuthors = normalizeAuthorList(rowBook.authors, rowBook.author).map(comparableText).filter(Boolean);
  const candidateAuthors = normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).filter(Boolean);
  if (rowAuthors.length && candidateAuthors.length && !rowAuthors.every((author) => candidateAuthors.includes(author))) {
    const incompleteSplitAuthor = rowProvenance?.author?.source === 'excel'
      && rowProvenance.author.derived === 'combined_name_parts'
      && rowProvenance.author.incomplete === true;
    const rowTokens = comparableText(rowBook.author).split(/\s+/).filter(Boolean);
    const candidateTokens = new Set(comparableText(candidate.author).split(/\s+/).filter(Boolean));
    if (!incompleteSplitAuthor || !rowTokens.length || !rowTokens.every((token) => candidateTokens.has(token))) return false;
  }
  return true;
}

function titleDoesNotContradict(rowBook, candidate) {
  const rowTitle = comparableText(rowBook?.title);
  const candidateTitle = comparableText(candidate?.title);
  return !(rowTitle && candidateTitle && rowTitle !== candidateTitle);
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

function candidateSemanticSignature(candidate) {
  return JSON.stringify([
    comparableText(candidate.title),
    normalizeAuthorList(candidate.authors, candidate.author).map(comparableText).sort(),
    comparableText(candidate.publisher),
    candidate.publishedYear,
    candidate.pageCount,
    comparableText(candidate.language),
  ]);
}

function candidateIdentifierConflict(candidate) {
  const editionIsbns = Array.isArray(candidate?.identifierIsbns) ? candidate.identifierIsbns : [];
  if (editionIsbns.length < 2) return null;
  return {
    code: 'metadata_identifier_conflict',
    editionIsbns: [...editionIsbns],
    evidence: Array.isArray(candidate.identifierEvidence)
      ? candidate.identifierEvidence.map((entry) => ({ field: entry.field, canonical: entry.canonical }))
      : [],
  };
}

function combinedIdentifierConflict(candidates) {
  const conflicts = candidates.map(candidateIdentifierConflict).filter(Boolean);
  if (!conflicts.length) return null;
  return {
    code: 'metadata_identifier_conflict',
    editionIsbns: Array.from(new Set(conflicts.flatMap((conflict) => conflict.editionIsbns))).sort(),
    evidence: conflicts.flatMap((conflict) => conflict.evidence),
  };
}

function selectMetadataCandidate(rowBook, candidates) {
  const strict = candidates.filter((candidate) => strictMetadataMatch(rowBook, candidate));
  if (!strict.length) return { candidate: null, conflict: null };
  const identifierConflict = combinedIdentifierConflict(strict);
  if (identifierConflict) return { candidate: null, conflict: identifierConflict };
  const editionIsbns = Array.from(new Set(strict.map((candidate) => candidate.editionIsbn).filter(Boolean))).sort();
  if (editionIsbns.length > 1) return { candidate: null, conflict: { code: 'ambiguous_metadata_editions', editionIsbns } };
  if (strict.length > 1 && !editionIsbns.length) {
    const signatures = new Set(strict.map(candidateSemanticSignature));
    if (signatures.size > 1) return { candidate: null, conflict: { code: 'ambiguous_metadata_results' } };
  }
  const rankedPool = editionIsbns.length === 1
    ? strict.filter((candidate) => candidate.editionIsbn === editionIsbns[0])
    : strict;
  const ranked = rankedPool.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  return { candidate: ranked[0], conflict: null };
}

function distinctCandidateTitles(candidates) {
  const titles = new Map();
  for (const candidate of candidates) {
    const key = comparableText(candidate.title);
    if (key && !titles.has(key)) titles.set(key, candidate.title);
  }
  return Array.from(titles.values());
}

function selectIsbnMetadataCandidate(requestedIsbn, candidates, rowBook = null, rowProvenance = null) {
  const requested = canonicalizeBookIsbn13(requestedIsbn);
  if (!requested) return { candidate: null, conflict: null };
  const exact = [];
  const identifierless = [];
  const mismatched = [];
  const mismatchedIdentifierIsbns = new Set();
  const requestedIdentifierConflicts = [];
  for (const candidate of candidates) {
    const internalConflict = candidateIdentifierConflict(candidate);
    if (internalConflict) {
      if (internalConflict.editionIsbns.includes(requested)) requestedIdentifierConflicts.push(candidate);
      else for (const isbn of internalConflict.editionIsbns) mismatchedIdentifierIsbns.add(isbn);
      continue;
    }
    if (candidate.editionIsbn === requested) exact.push(candidate);
    else if (!candidate.editionIsbn) {
      if (!rowBook || metadataDoesNotContradict(rowBook, candidate, rowProvenance)) identifierless.push(candidate);
    } else mismatched.push(candidate);
  }
  if (requestedIdentifierConflicts.length) {
    return { candidate: null, conflict: combinedIdentifierConflict(requestedIdentifierConflicts) };
  }
  const exactTitles = distinctCandidateTitles(exact);
  const contradictoryExactTitles = rowBook
    ? distinctCandidateTitles(exact.filter((candidate) => !titleDoesNotContradict(rowBook, candidate)))
    : [];
  if (exactTitles.length > 1 || contradictoryExactTitles.length) {
    return {
      candidate: null,
      conflict: {
        code: 'metadata_title_conflict',
        editionIsbn: requested,
        titles: exactTitles,
      },
    };
  }
  const compatibleExact = rowBook ? exact.filter((candidate) => titleDoesNotContradict(rowBook, candidate)) : exact;
  const rankedExact = compatibleExact.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  if (rankedExact.length) return { candidate: rankedExact[0], conflict: null };
  if (mismatched.length || mismatchedIdentifierIsbns.size) {
    return {
      candidate: null,
      conflict: {
        code: 'ambiguous_isbn_lookup_results',
        requestedIsbn: requested,
        returnedIsbns: Array.from(new Set([
          ...mismatched.map((candidate) => candidate.editionIsbn),
          ...mismatchedIdentifierIsbns,
        ])).filter(Boolean).sort(),
      },
    };
  }
  if (identifierless.length > 1) {
    const signatures = new Set(identifierless.map(candidateSemanticSignature));
    if (signatures.size > 1) {
      return { candidate: null, conflict: { code: 'ambiguous_isbn_lookup_results', requestedIsbn: requested, returnedIsbns: [] } };
    }
  }
  const rankedIdentifierless = identifierless.slice().sort((left, right) => candidateScore(right) - candidateScore(left));
  return { candidate: rankedIdentifierless[0] || null, conflict: null };
}

function sourceSuggestedIsbns(row) {
  const analyses = row?.identifierAnalysis
    ? [row.identifierAnalysis.explicit, row.identifierAnalysis.legacy, row.identifierAnalysis.ambiguous]
    : [];
  return Array.from(new Set(analyses.map((analysis) => analysis?.suggestion?.canonical).filter(Boolean))).sort();
}

function invalidSuppliedScalar(row, field) {
  if (!['publishedYear', 'pageCount'].includes(field)) return null;
  if (row?.book?.[field] !== null) return null;
  const provenance = row?.provenance?.[field];
  if (!provenance || provenance.source !== 'excel') return null;
  return provenance;
}

function setMetadataField(row, field, value, candidate) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
  const current = row.book[field];
  const currentProvenance = row.provenance?.[field];
  const invalidSource = invalidSuppliedScalar(row, field);
  if (invalidSource) {
    addIssue(row, 'metadata_differs_from_excel', 'warning', {
      field,
      excelValue: Object.prototype.hasOwnProperty.call(invalidSource, 'raw') ? invalidSource.raw : null,
      metadataValue: value,
      sourceInvalid: true,
    });
    return;
  }
  const currentEmpty = current === null || current === undefined || current === '' || (Array.isArray(current) && !current.length);
  if (field === 'tags' && Array.isArray(value) && currentProvenance?.source !== 'excel') {
    const derivedValues = currentProvenance?.source === 'derived'
      ? (Array.isArray(current) ? [...current] : [])
      : (currentProvenance?.includesDerivedValues && Array.isArray(currentProvenance.derivedValues)
        ? [...currentProvenance.derivedValues]
        : []);
    const merged = currentProvenance?.source === 'metadata'
      ? [...derivedValues]
      : (Array.isArray(current) ? [...current] : []);
    for (const tag of value) {
      if (!merged.some((existing) => comparableText(existing) === comparableText(tag))) merged.push(tag);
    }
    row.book.tags = merged;
    row.provenance.tags = {
      source: 'metadata',
      detail: candidate.source || null,
      ...(derivedValues.length ? { includesDerivedValues: true, derivedValues } : {}),
    };
    return;
  }
  if (currentEmpty || currentProvenance?.source === 'metadata') {
    row.book[field] = Array.isArray(value) ? [...value] : value;
    row.provenance[field] = { source: 'metadata', detail: candidate.source || null };
    return;
  }
  const same = JSON.stringify(current) === JSON.stringify(value)
    || (typeof current === 'string' && typeof value === 'string' && comparableText(current) === comparableText(value));
  if (!same) addIssue(row, 'metadata_differs_from_excel', 'warning', { field, excelValue: current, metadataValue: value });
}

function metadataAuthorExtendsIncompleteExcelAuthor(row, candidate) {
  if (!candidate?.author) return false;
  const provenance = row?.provenance?.author;
  if (!provenance || provenance.source !== 'excel' || provenance.derived !== 'combined_name_parts' || provenance.incomplete !== true) return false;
  const currentTokens = comparableText(row?.book?.author).split(/\s+/).filter(Boolean);
  const candidateTokens = new Set(comparableText(candidate.author).split(/\s+/).filter(Boolean));
  return Boolean(currentTokens.length && currentTokens.every((token) => candidateTokens.has(token)));
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
    if (row.provenance.author?.source === 'metadata') {
      row.book.author = candidate.author;
      row.book.authors = [...candidate.authors];
      row.provenance.author = { source: 'metadata', detail: candidate.source || null };
    } else if (metadataAuthorExtendsIncompleteExcelAuthor(row, candidate)) {
      const supplementedFrom = row.provenance.author;
      row.book.author = candidate.author;
      row.book.authors = [...candidate.authors];
      row.provenance.author = {
        source: 'metadata',
        detail: candidate.source || null,
        supplementedFrom,
      };
    } else {
      addIssue(row, 'metadata_differs_from_excel', 'warning', { field: 'author', excelValue: row.book.author, metadataValue: candidate.author });
    }
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
  const hasMissingMetadata = () => !row.book.title || !row.book.author || row.provenance?.author?.incomplete === true
    || !row.book.publisher || row.book.publishedYear == null
    || row.book.pageCount == null || !row.book.language || !row.book.coverUrl || !row.book.description
    || !Array.isArray(row.book.tags) || !row.book.tags.length
    || !Array.isArray(row.book.themes) || !row.book.themes.length;

  const enrichExactIsbn = async ({ force = false } = {}) => {
    if (!lookupIsbn || !row.book.editionIsbn || (!force && !hasMissingMetadata())) return;
    try {
      const result = await lookupIsbn(row.book.editionIsbn, { title: row.book.title, author: row.book.author });
      const candidates = metadataCandidatesFromResult(result);
      const selection = selectIsbnMetadataCandidate(row.book.editionIsbn, candidates, row.book, row.provenance);
      if (selection.conflict) addIssue(row, selection.conflict.code, 'conflict', selection.conflict);
      else if (selection.candidate) applyMetadataCandidate(row, selection.candidate);
      else if (candidates.length) addIssue(row, 'metadata_not_usable', 'warning');
    } catch {
      addIssue(row, 'metadata_lookup_failed', 'warning', { lookup: 'isbn' });
    }
  };

  if (row.book.editionIsbn) {
    await enrichExactIsbn();
    return;
  }

  if (!lookupTitleAuthor || !row.book.title || !row.book.author) return;
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
    const suggestedIsbns = sourceSuggestedIsbns(row);
    if (selection.candidate.editionIsbn && suggestedIsbns.length && !suggestedIsbns.includes(selection.candidate.editionIsbn)) {
      addIssue(row, 'metadata_isbn_conflicts_with_repair_suggestion', 'conflict', {
        suggestedIsbns,
        metadataIsbn: selection.candidate.editionIsbn,
      });
      return;
    }
    if (!selection.candidate.editionIsbn) {
      addIssue(row, 'title_author_metadata_missing_edition_isbn', 'warning', { source: selection.candidate.source || null });
    }
    applyMetadataCandidate(row, selection.candidate, { allowIsbnResolution: true });
    if (row.book.editionIsbn) await enrichExactIsbn({ force: true });
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
