'use strict';

const {
  normalizeBookIdentityText,
  normalizeAuthorList,
  createAuthorDisplay,
} = require('./book-edition-core');
const { isBlankCellValue } = require('./book-import-workbook');
const {
  addIssue,
  comparableText,
  splitTagValue,
  parseQuantity,
  normalizeYear,
  normalizePageCount,
  normalizeLanguage,
  parseEasyReading,
  parseExamMaterial,
  looksLikeIsbnCandidate,
  analyzeIdentifier,
  valueText,
} = require('./book-import-analysis-values');
const {
  getDataFields,
  stripSemanticMarkers,
} = require('./book-import-analysis-context');

function fieldSource(mapped, field, fallback = 'unknown') {
  const candidates = mapped.sources[field] || [];
  const first = candidates.find((entry) => !isBlankCellValue(stripSemanticMarkers(entry.value)));
  if (!first) return { source: fallback };
  return { source: 'excel', header: first.header, raw: first.value };
}

function collisionDataCandidates(collision) {
  if (!collision || !Array.isArray(collision.candidates)) return [];
  const result = [];
  const seen = new Set();
  for (const entry of collision.candidates) {
    const value = stripSemanticMarkers(entry.value);
    if (isBlankCellValue(value)) continue;
    const key = comparableText(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, value });
  }
  return result;
}

function collisionIsSemanticallyEquivalent(collision) {
  const candidates = collisionDataCandidates(collision);
  if (candidates.length < 2) return true;
  if (!['isbn', 'metadataIsbn', 'ambiguousIdentifier'].includes(collision.field)) return false;
  const canonical = candidates.map((entry) => analyzeIdentifier(entry.value).canonical).filter(Boolean);
  return canonical.length === candidates.length && new Set(canonical).size === 1;
}

function blockingCollisionFields(mapped) {
  const fields = new Set();
  for (const collision of mapped.collisions) {
    const candidates = collisionDataCandidates(collision);
    if (candidates.length < 2 || collisionIsSemanticallyEquivalent({ ...collision, candidates })) continue;
    fields.add(collision.field);
  }
  return fields;
}

function normalizeDirectAuthors(value) {
  if (Array.isArray(value)) return normalizeAuthorList(value);
  const text = normalizeBookIdentityText(value);
  if (!text) return [];
  const candidates = text.split(/[;\n\r]+|\s+&\s+/).map((entry) => normalizeBookIdentityText(entry)).filter(Boolean);
  return normalizeAuthorList(candidates, text);
}

function normalizeBookFields(mapped, row) {
  const f = getDataFields(mapped);
  const blocked = blockingCollisionFields(mapped);
  const directAuthor = blocked.has('author') ? [] : normalizeDirectAuthors(f.author);
  const first = blocked.has('authorFirst') ? '' : normalizeBookIdentityText(f.authorFirst);
  const last = blocked.has('authorLast') ? '' : normalizeBookIdentityText(f.authorLast);
  const combined = normalizeAuthorList(undefined, [first, last].filter(Boolean).join(' '));
  let authors = directAuthor;
  if (!authors.length && combined.length) authors = combined;
  if (authors.length && combined.length && comparableText(authors[0]) !== comparableText(combined[0])) {
    addIssue(row, 'author_sources_differ', 'conflict', { directAuthor: authors[0], combinedAuthor: combined[0] });
  }

  const title = blocked.has('title') ? '' : normalizeBookIdentityText(f.title);
  const author = createAuthorDisplay(authors);
  const quantityBlocked = blocked.has('quantity');
  const quantity = quantityBlocked
    ? { value: 1, valid: false, supplied: true, blockedByConflict: true }
    : parseQuantity(f.quantity);
  if (!quantity.valid && !quantityBlocked) addIssue(row, 'invalid_quantity', 'conflict', { raw: fieldSource(mapped, 'quantity').raw ?? null });

  const exam = parseExamMaterial(f.examMaterial);
  if (exam.warning) addIssue(row, exam.warning, 'warning', { raw: fieldSource(mapped, 'examMaterial').raw ?? null });
  const easy = parseEasyReading(f.easyReading);
  if (easy.nonstandard) addIssue(row, 'nonstandard_easy_reading_value', 'warning', { raw: fieldSource(mapped, 'easyReading').raw ?? null });

  const rawLanguage = normalizeLanguage(f.language);
  const language = rawLanguage || exam.languageHint;
  if (rawLanguage && exam.languageHint && rawLanguage !== exam.languageHint) {
    addIssue(row, 'language_hint_conflict', 'warning', { excelLanguage: rawLanguage, examLanguageHint: exam.languageHint });
  }

  const publishedYear = normalizeYear(f.publishedYear);
  if (!isBlankCellValue(f.publishedYear) && publishedYear === null) addIssue(row, 'invalid_published_year', 'warning');
  const pageCount = normalizePageCount(f.pageCount);
  if (!isBlankCellValue(f.pageCount) && pageCount === null) addIssue(row, 'invalid_page_count', 'warning');

  const manualThemes = splitTagValue(f.themes);
  const tags = splitTagValue(f.tags);
  if (exam.formatHint === 'comic' && !tags.some((tag) => comparableText(tag) === 'strip')) tags.push('strip');
  return {
    title,
    author,
    authors,
    quantity,
    description: normalizeBookIdentityText(f.description),
    publisher: normalizeBookIdentityText(f.publisher),
    publishedYear,
    pageCount,
    language,
    coverUrl: normalizeBookIdentityText(f.coverUrl),
    manualThemes,
    themes: [...manualThemes],
    tags,
    suitableForExamList: exam.suitableForExamList,
    easyReading: easy.value,
    formatHint: exam.formatHint,
  };
}

function normalizeIdentifierFields(mapped, row, book) {
  const f = getDataFields(mapped);
  const blocked = blockingCollisionFields(mapped);
  const explicit = analyzeIdentifier(f.isbn);
  const legacy = analyzeIdentifier(f.metadataIsbn);
  const ambiguous = analyzeIdentifier(f.ambiguousIdentifier);

  for (const [field, analysis] of [['isbn', explicit], ['metadataIsbn', legacy], ['ambiguousIdentifier', ambiguous]]) {
    if (analysis.unsupportedType) addIssue(row, 'unsupported_identifier_type', 'conflict', { field });
    if (analysis.repair) addIssue(row, 'isbn_repaired', 'warning', { field, repair: analysis.repair });
    if (analysis.suggestion) addIssue(row, 'isbn_repair_suggested', 'warning', { field, suggestion: analysis.suggestion });
  }

  for (const [field, sourceValue, analysis] of [
    ['isbn', f.isbn, explicit],
    ['metadataIsbn', f.metadataIsbn, legacy],
  ]) {
    if (isBlankCellValue(sourceValue) || analysis.canonical || analysis.repair || analysis.suggestion || analysis.unsupportedType) continue;
    addIssue(row, 'invalid_or_unrecognized_isbn', 'warning', { field, raw: valueText(sourceValue) });
  }

  let barcode = blocked.has('barcode') ? '' : valueText(f.barcode);
  let ambiguousAsBarcode = false;
  const ambiguousLikelyIsbn = looksLikeIsbnCandidate(f.ambiguousIdentifier);
  if (!barcode && !isBlankCellValue(f.ambiguousIdentifier) && !ambiguous.canonical && !blocked.has('ambiguousIdentifier')
    && !ambiguousLikelyIsbn && !ambiguous.suggestion && !ambiguous.unsupportedType) {
    barcode = valueText(f.ambiguousIdentifier);
    ambiguousAsBarcode = true;
    addIssue(row, 'ambiguous_identifier_interpreted_as_barcode', 'warning');
  } else if (ambiguous.canonical && !blocked.has('ambiguousIdentifier')) {
    addIssue(row, 'ambiguous_identifier_interpreted_as_isbn', 'warning');
  }

  const candidatePairs = [
    ['isbn', blocked.has('isbn') ? '' : explicit.canonical],
    ['metadataIsbn', blocked.has('metadataIsbn') ? '' : legacy.canonical],
    ['ambiguousIdentifier', blocked.has('ambiguousIdentifier') ? '' : ambiguous.canonical],
  ].filter(([, canonical]) => canonical);
  const distinct = Array.from(new Set(candidatePairs.map(([, canonical]) => canonical)));
  const editionIsbn = distinct.length === 1 ? distinct[0] : '';
  if (distinct.length > 1) {
    addIssue(row, 'conflicting_edition_isbns', 'conflict', {
      candidates: candidatePairs.map(([field, canonical]) => ({ field, canonical })),
    });
  }

  if (!editionIsbn && !distinct.length && !ambiguousAsBarcode && !isBlankCellValue(f.ambiguousIdentifier)
    && !ambiguous.suggestion && !ambiguous.unsupportedType) {
    addIssue(row, 'invalid_or_unrecognized_isbn', 'warning', { field: 'ambiguousIdentifier', raw: valueText(f.ambiguousIdentifier) });
  }

  book.editionIsbn = editionIsbn;
  book.metadataIsbn = blocked.has('metadataIsbn') ? '' : legacy.canonical;
  book.barcode = barcode;
  return { explicit, legacy, ambiguous };
}

function applySourceCollisions(mapped, row) {
  for (const collision of mapped.collisions) {
    const candidates = collisionDataCandidates(collision);
    if (candidates.length < 2 || collisionIsSemanticallyEquivalent({ ...collision, candidates })) continue;
    addIssue(row, 'conflicting_source_columns', 'conflict', { field: collision.field, candidates });
  }
  if (mapped.ignoredDangerousHeaders.length) addIssue(row, 'dangerous_headers_ignored', 'warning', { headers: [...mapped.ignoredDangerousHeaders] });
  const nonblankUnknown = mapped.unknown.filter((entry) => !isBlankCellValue(entry.value));
  if (nonblankUnknown.length) addIssue(row, 'unknown_columns_present', 'warning', { headers: nonblankUnknown.map((entry) => entry.header) });
}

function provenanceForBook(mapped, book, identifierAnalysis) {
  const blocked = blockingCollisionFields(mapped);
  const editionSource = [
    ['isbn', identifierAnalysis.explicit],
    ['metadataIsbn', identifierAnalysis.legacy],
    ['ambiguousIdentifier', identifierAnalysis.ambiguous],
  ].find(([, analysis]) => analysis.canonical && analysis.canonical === book.editionIsbn);
  const provenance = {
    title: fieldSource(mapped, 'title'),
    author: blocked.has('author') ? { source: 'unknown' } : fieldSource(mapped, 'author'),
    editionIsbn: editionSource ? fieldSource(mapped, editionSource[0]) : { source: 'unknown' },
    barcode: fieldSource(mapped, 'barcode'),
    metadataIsbn: fieldSource(mapped, 'metadataIsbn'),
    description: fieldSource(mapped, 'description'),
    publisher: fieldSource(mapped, 'publisher'),
    publishedYear: fieldSource(mapped, 'publishedYear'),
    pageCount: fieldSource(mapped, 'pageCount'),
    language: fieldSource(mapped, 'language'),
    coverUrl: fieldSource(mapped, 'coverUrl'),
    manualThemes: fieldSource(mapped, 'themes'),
    themes: book.manualThemes.length ? { source: 'derived', detail: 'manualThemes' } : { source: 'unknown' },
    tags: fieldSource(mapped, 'tags'),
    suitableForExamList: fieldSource(mapped, 'examMaterial'),
    easyReading: fieldSource(mapped, 'easyReading'),
  };
  if (provenance.author.source === 'unknown' && book.author) {
    const sourceHeaders = [...(mapped.sources.authorFirst || []), ...(mapped.sources.authorLast || [])]
      .filter((entry) => !isBlankCellValue(stripSemanticMarkers(entry.value))).map((entry) => entry.header);
    if (sourceHeaders.length) provenance.author = { source: 'excel', headers: sourceHeaders, derived: 'combined_name_parts' };
  }
  if (provenance.language.source === 'unknown' && book.language && fieldSource(mapped, 'examMaterial').source === 'excel') {
    provenance.language = { ...fieldSource(mapped, 'examMaterial'), derived: 'exam_material_language_hint' };
  }
  provenance.formatHint = book.formatHint
    ? { ...fieldSource(mapped, 'examMaterial'), derived: 'exam_material_format_hint' }
    : { source: 'unknown' };
  if (book.barcode && provenance.barcode.source === 'unknown' && !identifierAnalysis.ambiguous.canonical) provenance.barcode = fieldSource(mapped, 'ambiguousIdentifier');
  return provenance;
}

module.exports = {
  fieldSource,
  collisionIsSemanticallyEquivalent,
  normalizeBookFields,
  normalizeIdentifierFields,
  applySourceCollisions,
  provenanceForBook,
};
