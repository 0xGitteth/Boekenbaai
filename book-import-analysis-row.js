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
  analyzeIdentifier,
  valueText,
} = require('./book-import-analysis-values');

function fieldSource(mapped, field, fallback = 'unknown') {
  const candidates = mapped.sources[field] || [];
  const first = candidates.find((entry) => !isBlankCellValue(entry.value));
  if (!first) return { source: fallback };
  return { source: 'excel', header: first.header, raw: first.value };
}

function collisionIsSemanticallyEquivalent(collision) {
  if (!collision || !['isbn', 'metadataIsbn', 'ambiguousIdentifier'].includes(collision.field)) return false;
  const canonical = collision.candidates.map((entry) => analyzeIdentifier(entry.value).canonical).filter(Boolean);
  return canonical.length === collision.candidates.length && new Set(canonical).size === 1;
}

function blockingCollisionFields(mapped) {
  const fields = new Set();
  for (const collision of mapped.collisions) {
    if (!collisionIsSemanticallyEquivalent(collision)) fields.add(collision.field);
  }
  return fields;
}

function normalizeBookFields(mapped, row) {
  const f = mapped.fields;
  const blocked = blockingCollisionFields(mapped);
  const directAuthor = blocked.has('author') ? [] : normalizeAuthorList(undefined, f.author);
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
  const quantity = parseQuantity(f.quantity);
  if (!quantity.valid) addIssue(row, 'invalid_quantity', 'conflict', { raw: fieldSource(mapped, 'quantity').raw ?? null });

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
  const f = mapped.fields;
  const blocked = blockingCollisionFields(mapped);
  const explicit = analyzeIdentifier(f.isbn);
  const legacy = analyzeIdentifier(f.metadataIsbn);
  const ambiguous = analyzeIdentifier(f.ambiguousIdentifier);

  for (const [field, analysis] of [['isbn', explicit], ['metadataIsbn', legacy], ['ambiguousIdentifier', ambiguous]]) {
    if (analysis.unsupportedType) addIssue(row, 'unsupported_identifier_type', 'conflict', { field });
    if (analysis.repair) addIssue(row, 'isbn_repaired', 'warning', { field, repair: analysis.repair });
    if (analysis.suggestion) addIssue(row, 'isbn_repair_suggested', 'warning', { field, suggestion: analysis.suggestion });
  }

  let barcode = blocked.has('barcode') ? '' : valueText(f.barcode);
  let ambiguousAsBarcode = false;
  if (!barcode && !isBlankCellValue(f.ambiguousIdentifier) && !ambiguous.canonical && !blocked.has('ambiguousIdentifier')) {
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

  if (!editionIsbn && !distinct.length) {
    const hadIdentifier = !isBlankCellValue(f.isbn) || !isBlankCellValue(f.metadataIsbn)
      || (!isBlankCellValue(f.ambiguousIdentifier) && !ambiguousAsBarcode);
    const hasSuggestion = explicit.suggestion || legacy.suggestion || ambiguous.suggestion;
    const unsupported = explicit.unsupportedType || legacy.unsupportedType || ambiguous.unsupportedType;
    if (hadIdentifier && !hasSuggestion && !unsupported) addIssue(row, 'invalid_or_unrecognized_isbn', 'warning');
  }

  book.editionIsbn = editionIsbn;
  book.metadataIsbn = blocked.has('metadataIsbn') ? '' : (legacy.canonical || valueText(f.metadataIsbn));
  book.barcode = barcode;
  return { explicit, legacy, ambiguous };
}

function applySourceCollisions(mapped, row) {
  for (const collision of mapped.collisions) {
    if (collisionIsSemanticallyEquivalent(collision)) continue;
    addIssue(row, 'conflicting_source_columns', 'conflict', { field: collision.field, candidates: collision.candidates });
  }
  if (mapped.ignoredDangerousHeaders.length) addIssue(row, 'dangerous_headers_ignored', 'warning', { headers: [...mapped.ignoredDangerousHeaders] });
  const nonblankUnknown = mapped.unknown.filter((entry) => !isBlankCellValue(entry.value));
  if (nonblankUnknown.length) addIssue(row, 'unknown_columns_present', 'warning', { headers: nonblankUnknown.map((entry) => entry.header) });
}

function provenanceForBook(mapped, book, identifierAnalysis) {
  const provenance = {
    title: fieldSource(mapped, 'title'),
    author: fieldSource(mapped, 'author'),
    editionIsbn: fieldSource(mapped, 'isbn'),
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
      .filter((entry) => !isBlankCellValue(entry.value)).map((entry) => entry.header);
    if (sourceHeaders.length) provenance.author = { source: 'excel', headers: sourceHeaders, derived: 'combined_name_parts' };
  }
  if (provenance.editionIsbn.source === 'unknown' && identifierAnalysis.ambiguous.canonical) provenance.editionIsbn = fieldSource(mapped, 'ambiguousIdentifier');
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
