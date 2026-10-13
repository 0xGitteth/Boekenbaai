'use strict';

// PR3 review boundary. Corrections are applied to a safe COPY of the original
// worksheet rows and re-run through PR2; clients cannot supply analyzed results
// or copy lists to the persistence layer.
const { analyzeBookImportRows } = require('./book-import-analysis');
const { mapImportRow, safeRowEntries, isBlankCellValue } = require('./book-import-workbook');
const { analyzeIdentifier, looksLikeIsbnCandidate, normalizeRuntimeBarcode } = require('./book-import-analysis-values');
const { canonicalizeBookIsbn13, normalizeBookIdentityComparable } = require('./book-edition-core');

const CORRECTION_COLUMNS = Object.freeze({
  title: { header: 'Titel', fields: ['title'], type: 'text' },
  author: { header: 'Auteur', fields: ['author', 'authorFirst', 'authorLast'], type: 'text' },
  editionIsbn: { header: 'ISBN-nummer', fields: ['isbn', 'metadataIsbn', 'ambiguousIdentifier'], type: 'isbn' },
  barcode: { header: 'Barcode', fields: ['barcode', 'ambiguousIdentifier'], type: 'text' },
  quantity: { header: 'Aantal', fields: ['quantity'], type: 'quantity' },
  publisher: { header: 'Uitgever', fields: ['publisher'], type: 'text' },
  publishedYear: { header: 'Jaar', fields: ['publishedYear'], type: 'year' },
  pageCount: { header: 'Paginas', fields: ['pageCount'], type: 'pages' },
  language: { header: 'Taal', fields: ['language'], type: 'text' },
  description: { header: 'Beschrijving', fields: ['description'], type: 'text' },
  coverUrl: { header: 'Cover URL', fields: ['coverUrl'], type: 'text' },
  tags: { header: 'Tags', fields: ['tags'], type: 'text' },
  themes: { header: "Thema's", fields: ['themes'], type: 'text' },
  easyReading: { header: 'Makkelijk lezen?', fields: ['easyReading'], type: 'text' },
  examMaterial: { header: 'Examenmateriaal', fields: ['examMaterial'], type: 'text' },
  studentLoan: { header: 'naam leerling', fields: ['studentLoan'], type: 'text' },
  classLoan: { header: 'Geleend door klas', fields: ['classLoan'], type: 'text' },
  classes: { header: 'Klassen', fields: ['classes'], type: 'text' },
  libraryPresence: { header: 'Aanwezig bieb', fields: ['libraryPresence'], type: 'text' },
});
const MAX_CORRECTIONS = 20000;
const MAX_CORRECTION_TEXT = 4000;

function ownData(source, key) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  let d;
  try { d = Object.getOwnPropertyDescriptor(source, key); } catch { return undefined; }
  return d && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined;
}

function correctionValue(field, value) {
  const format = CORRECTION_COLUMNS[field];
  if (!format || typeof value !== 'string' || value.length > MAX_CORRECTION_TEXT) return null;
  const trimmed = value.trim();
  if (format.type === 'text') return trimmed;
  if (format.type === 'isbn') {
    const isbn = canonicalizeBookIsbn13(trimmed);
    return isbn || null;
  }
  if (format.type === 'quantity') {
    return /^(?:[1-9][0-9]{0,2}|1000)$/.test(trimmed) ? String(Number(trimmed)) : null;
  }
  if (format.type === 'year') {
    if (!trimmed) return '';
    return /^(?:1[0-9]{3}|2[0-9]{3}|3000)$/.test(trimmed) ? trimmed : null;
  }
  if (format.type === 'pages') {
    if (!trimmed) return '';
    return /^(?:[1-9][0-9]{0,4}|100000)$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

function normalizeCorrections(corrections, sourceRowCount) {
  if (!Array.isArray(corrections) || corrections.length > MAX_CORRECTIONS) {
    return { ok: false, error: 'invalid_corrections' };
  }
  const result = new Map();
  for (const correction of corrections) {
    const index = ownData(correction, 'index');
    if (!Number.isSafeInteger(index) || index < 0 || index >= sourceRowCount || result.has(index)) {
      return { ok: false, error: 'invalid_correction_index' };
    }
    const skip = ownData(correction, 'skip');
    if (skip !== undefined && typeof skip !== 'boolean') return { ok: false, error: 'invalid_skip' };
    const fields = ownData(correction, 'fields');
    if (fields !== undefined && (!fields || typeof fields !== 'object' || Array.isArray(fields))) {
      return { ok: false, error: 'invalid_correction_fields' };
    }
    let keys;
    try { keys = fields ? Reflect.ownKeys(fields) : []; } catch { return { ok: false, error: 'invalid_correction_fields' }; }
    if (keys.length > Object.keys(CORRECTION_COLUMNS).length) return { ok: false, error: 'invalid_correction_fields' };
    const updates = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(CORRECTION_COLUMNS, key)) {
        return { ok: false, error: 'unsupported_correction_field' };
      }
      const value = correctionValue(key, ownData(fields, key));
      if (value === null) return { ok: false, error: 'invalid_correction_value', field: key, index };
      updates[key] = value;
    }
    if (skip === true && keys.length) return { ok: false, error: 'skipped_row_cannot_be_edited', index };
    if (skip !== true && !keys.length) return { ok: false, error: 'empty_correction', index };
    result.set(index, { skip: skip === true, fields: updates });
  }
  return { ok: true, corrections: result };
}

function cloneOriginalRow(source) {
  const row = Object.create(null);
  for (const [header, value] of safeRowEntries(source)) {
    if (typeof header !== 'string' || header === '__proto__' || header === 'constructor' || header === 'prototype') continue;
    row[header] = value;
  }
  const worksheetIndex = ownData(source, '__rowNum__');
  if (Number.isInteger(worksheetIndex) && worksheetIndex >= 0) {
    Object.defineProperty(row, '__rowNum__', { value: worksheetIndex, configurable: true });
  }
  return row;
}

function applyCorrectionsToRows(sourceRows, normalized) {
  return sourceRows.map((source, index) => {
    const row = cloneOriginalRow(source);
    const correction = normalized.get(index);
    if (!correction) return row;
    if (correction.skip) {
      // An intentionally skipped row becomes blank to preserve original row
      // numbers while preventing it from contributing any edition/copy.
      for (const key of Object.keys(row)) delete row[key];
      return row;
    }
    for (const [field, value] of Object.entries(correction.fields)) {
      const mapped = mapImportRow(row);
      for (const mappedField of CORRECTION_COLUMNS[field].fields) {
        for (const entry of mapped.sources[mappedField] || []) {
          if (mappedField === 'ambiguousIdentifier' && !isBlankCellValue(entry.value)) {
            const analysis = analyzeIdentifier(entry.value);
            const representsIsbn = Boolean(analysis.canonical || analysis.repair
              || analysis.suggestion || looksLikeIsbnCandidate(entry.value));
            // Combined Barcode / ISBN columns can contain either a real
            // physical barcode or an edition ISBN. Changing one must not
            // erase the other, especially when a book already has a printed
            // label that students need to scan.
            if ((field === 'editionIsbn' && !representsIsbn)
              || (field === 'barcode' && representsIsbn)) continue;
          }
          delete row[entry.header];
        }
      }
      row[CORRECTION_COLUMNS[field].header] = value;
    }
    return row;
  });
}

const MAX_EXISTING_EDITION_SAMPLES = 3;

function buildExistingEditionIndex(existingBooks) {
  // Index physical copies once. Never create N x M repeated match objects
  // for N workbook rows sharing an ISBN and M existing physical copies.
  const editions = new Map();
  for (const book of Array.isArray(existingBooks) ? existingBooks : []) {
    if (!book || typeof book !== 'object') continue;
    const knownIsbns = new Set([
      canonicalizeBookIsbn13(book.editionIsbn),
      canonicalizeBookIsbn13(book.metadataIsbn),
      canonicalizeBookIsbn13(book.isbn13),
      canonicalizeBookIsbn13(book.barcode),
    ].filter(Boolean));
    for (const isbn of knownIsbns) {
      const entry = editions.get(isbn) || { count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < MAX_EXISTING_EDITION_SAMPLES) {
        entry.samples.push({
          id: book.id || '',
          title: typeof book.title === 'string' ? book.title : '',
          borrowed: book.status === 'borrowed',
        });
      }
      editions.set(isbn, entry);
    }
  }
  return editions;
}

function existingEditionMatch(row, editionIndex) {
  const isbn = row?.book?.editionIsbn;
  if (!isbn) return { count: 0, matches: [] };
  const found = editionIndex.get(isbn);
  if (!found) return { count: 0, matches: [] };
  const title = normalizeBookIdentityComparable(row.book.title);
  return {
    count: found.count,
    matches: found.samples.map((book) => ({
      ...book, sameTitle: normalizeBookIdentityComparable(book.title) === title,
    })),
  };
}

function detectWorkbookBarcodeCollisions(rows) {
  const byBarcode = new Map();
  for (const row of rows) {
    if (row.status === 'skipped') continue;
    const printedBarcode = normalizeRuntimeBarcode(row.book?.barcode);
    const barcode = printedBarcode || row.book?.editionIsbn;
    if (!barcode) continue;
    if (!byBarcode.has(barcode)) byBarcode.set(barcode, []);
    byBarcode.get(barcode).push({
      index: row.index,
      editionIsbn: row.book?.editionIsbn || '',
      autogenerated: !printedBarcode,
    });
  }
  const conflicted = new Set();
  for (const candidates of byBarcode.values()) {
    if (candidates.length < 2) continue;
    // It is valid for multiple physical copies of ONE edition to share the
    // generated ISBN barcode. A printed barcode is individual and may not
    // collide with any other row, including an ISBN-based fallback.
    const first = candidates[0];
    if (candidates.every((item) => item.autogenerated && item.editionIsbn === first.editionIsbn)) continue;
    for (const item of candidates) conflicted.add(item.index);
  }
  return conflicted;
}

function buildReviewDecisions(analysis, existingBooks = [], { acceptWarnings = false } = {}) {
  const workbookBarcodeConflicts = detectWorkbookBarcodeCollisions(analysis.rows);
  const editionIndex = buildExistingEditionIndex(existingBooks);
  const usedBarcodes = new Map();
  for (const book of Array.isArray(existingBooks) ? existingBooks : []) {
    const barcode = normalizeRuntimeBarcode(book?.barcode);
    if (barcode && !usedBarcodes.has(barcode)) {
      usedBarcodes.set(barcode, { id: book.id || '', title: typeof book.title === 'string' ? book.title : '' });
    }
  }
  const rows = analysis.rows.map((row) => {
    const match = existingEditionMatch(row, editionIndex);
    const matches = match.matches;
    const candidateBarcode = normalizeRuntimeBarcode(row.book?.barcode) || row.book?.editionIsbn || '';
    const existingBarcode = candidateBarcode ? usedBarcodes.get(candidateBarcode) : null;
    const workbookBarcodeConflict = workbookBarcodeConflicts.has(row.index);
    const printedBarcodeNeedsSingleCopy = Boolean(row.book?.barcode && row.book?.quantity?.value > 1);
    const shouldSkip = row.status === 'skipped';
    // PR5 creates real student/class checkouts. Never make an active loan
    // appear available merely because the import was confirmed in PR3.
    const hasActiveLoan = Boolean(row.context?.studentLoan || row.context?.classLoan);
    // Acknowledging a warning is not consent to silently discard a school's
    // physical location, class assignment or "not in library" information.
    // PR4/5 owns the eventual mapping into the real inventory/loan models.
    const hasUnrepresentedContext = Boolean(
      (Array.isArray(row.context?.classContext) && row.context.classContext.length)
      || row.context?.libraryPresence
      || (row.context?.fixedLocation && row.context.fixedLocation.status !== 'resolved')
    );
    const blocking = row.status === 'conflict' || row.status === 'unresolved'
      || hasActiveLoan || hasUnrepresentedContext;
    const requiresReview = match.count > 0 || Boolean(existingBarcode)
      || workbookBarcodeConflict || printedBarcodeNeedsSingleCopy
      || (row.status === 'warning' && !acceptWarnings);
    const canCreate = !shouldSkip && !blocking && !requiresReview;
    const reason = shouldSkip ? 'skipped'
      : hasActiveLoan ? 'loan_context_requires_followup'
        : hasUnrepresentedContext ? 'location_context_requires_followup'
          : (row.status === 'conflict' || row.status === 'unresolved') ? 'source_conflict_or_missing_identity'
          : match.count ? 'existing_edition_requires_review'
          : existingBarcode ? 'existing_physical_barcode_requires_correction'
            : workbookBarcodeConflict ? 'workbook_physical_barcode_conflict'
              : printedBarcodeNeedsSingleCopy ? 'printed_barcode_requires_one_copy'
                : (requiresReview ? 'warnings_need_confirmation' : '');
    return {
      index: row.index, worksheetRow: row.sourceRowNumber, status: row.status, canCreate,
      reason, existing: matches, existingCount: match.count,
      existingBarcode: existingBarcode || null,
    };
  });
  const blocked = rows.filter((row) => row.reason && row.reason !== 'skipped');
  return {
    rows,
    summary: {
      safeRows: rows.filter((row) => row.canCreate).length,
      skippedRows: rows.filter((row) => row.reason === 'skipped').length,
      blockedRows: blocked.length,
      readyToApply: blocked.length === 0 && rows.some((row) => row.canCreate),
    },
  };
}

async function analyzeReviewedImport(sourceRows, corrections = [], options = {}) {
  if (!Array.isArray(sourceRows)) return { ok: false, error: 'invalid_source_rows' };
  const maxRows = Number.isInteger(options.maxRows) && options.maxRows > 0 ? options.maxRows : 20000;
  if (sourceRows.length > maxRows) return { ok: false, error: 'too_many_rows' };
  const normalized = normalizeCorrections(corrections, sourceRows.length);
  if (!normalized.ok) return normalized;
  const rows = applyCorrectionsToRows(sourceRows, normalized.corrections);
  // An explicit edit is authoritative, including the empty string. A blank
  // correction must not be mistaken for missing metadata during reanalysis.
  const metadataFields = new Set([
    'title', 'author', 'publisher', 'publishedYear', 'pageCount',
    'language', 'description', 'coverUrl', 'tags', 'themes',
  ]);
  const correctedMetadataFieldsByRow = new Map([...normalized.corrections.entries()]
    .filter(([, entry]) => !entry.skip)
    .map(([index, entry]) => [index, new Set(Object.keys(entry.fields)
      .filter((field) => metadataFields.has(field)))]));
  const analysis = await analyzeBookImportRows(rows, {
    ...options, correctedMetadataFieldsByRow,
  });
  if (!analysis.ok) return analysis;
  // Working rows contain synthetic Excel columns for editor changes. Correct
  // their provenance AFTER analyzing the rows so the persisted report never
  // mistakes an administrator decision for original workbook data.
  for (const [index, entry] of normalized.corrections) {
    if (entry.skip || !analysis.rows[index]?.provenance) continue;
    const reviewed = analysis.rows[index];
    for (const field of Object.keys(entry.fields)) {
      const name = field === 'examMaterial' ? 'suitableForExamList' : field;
      if (Object.prototype.hasOwnProperty.call(reviewed.provenance, name)) {
        reviewed.provenance[name] = { source: 'manual', detail: 'review_correction' };
      }
    }
    if (Object.prototype.hasOwnProperty.call(entry.fields, 'themes')) {
      reviewed.provenance.manualThemes = { source: 'manual', detail: 'review_correction' };
    }
    if (Object.prototype.hasOwnProperty.call(entry.fields, 'examMaterial')) {
      // Exam material can also supply a language hint, format hint and comic
      // tag. These are derived from an administrator's edit, not the workbook.
      for (const field of ['language', 'formatHint']) {
        const origin = reviewed.provenance[field];
        if (origin?.derived?.startsWith('exam_material_')) {
          reviewed.provenance[field] = {
            source: 'manual', detail: 'review_correction_exam_material',
            derived: origin.derived,
          };
        }
      }
      const tagsOrigin = reviewed.provenance.tags;
      if (tagsOrigin?.derived === 'exam_material_strip_tag'
        || tagsOrigin?.detail === 'exam_material_strip_tag') {
        reviewed.provenance.tags = tagsOrigin.source === 'excel' && tagsOrigin.includesDerivedValues
          ? { ...tagsOrigin, includesManualDerivedValues: true }
          : { source: 'manual', detail: 'review_correction_exam_material',
            derived: 'exam_material_strip_tag' };
      }
    }
  }
  const decisions = buildReviewDecisions(analysis, Array.isArray(options.existingBooks) ? options.existingBooks : [],
    { acceptWarnings: options.acceptWarnings === true });
  return { ...analysis, decisions, correctedRows: rows, appliedCorrectionCount: normalized.corrections.size };
}

module.exports = {
  CORRECTION_COLUMNS,
  normalizeCorrections,
  applyCorrectionsToRows,
  buildReviewDecisions,
  analyzeReviewedImport,
};
