'use strict';

// PR3 review boundary. Corrections are applied to a safe COPY of the original
// worksheet rows and re-run through PR2; clients cannot supply analyzed results
// or copy lists to the persistence layer.
const { analyzeBookImportRows } = require('./book-import-analysis');
const { mapImportRow, safeRowEntries, worksheetRowNumber } = require('./book-import-workbook');
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
  const worksheetIndex = worksheetRowNumber(source);
  if (worksheetIndex !== null) Object.defineProperty(row, '__rowNum__', { value: worksheetIndex, configurable: true });
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
    const mapped = mapImportRow(row);
    for (const [field, value] of Object.entries(correction.fields)) {
      for (const mappedField of CORRECTION_COLUMNS[field].fields) {
        for (const entry of mapped.sources[mappedField] || []) delete row[entry.header];
      }
      row[CORRECTION_COLUMNS[field].header] = value;
    }
    return row;
  });
}

function existingEditionMatch(row, existingBooks) {
  const isbn = row?.book?.editionIsbn;
  if (!isbn) return [];
  const title = normalizeBookIdentityComparable(row.book.title);
  const found = [];
  for (const book of existingBooks) {
    if (!book || typeof book !== 'object') continue;
    const evidence = canonicalizeBookIsbn13(book.editionIsbn)
      || canonicalizeBookIsbn13(book.metadataIsbn)
      || canonicalizeBookIsbn13(book.barcode);
    if (evidence !== isbn) continue;
    found.push({
      id: book.id || '',
      title: typeof book.title === 'string' ? book.title : '',
      sameTitle: normalizeBookIdentityComparable(book.title) === title,
      borrowed: book.status === 'borrowed',
    });
  }
  return found;
}

function buildReviewDecisions(analysis, existingBooks = [], { acceptWarnings = false } = {}) {
  const rows = analysis.rows.map((row) => {
    const matches = existingEditionMatch(row, existingBooks);
    const shouldSkip = row.status === 'skipped';
    const blocking = row.status === 'conflict' || row.status === 'unresolved';
    const requiresReview = matches.length > 0 || (row.status === 'warning' && !acceptWarnings);
    const canCreate = !shouldSkip && !blocking && !requiresReview;
    const reason = shouldSkip ? 'skipped'
      : blocking ? 'source_conflict_or_missing_identity'
        : matches.length ? 'existing_edition_requires_review'
          : (requiresReview ? 'warnings_need_confirmation' : '');
    return { index: row.index, worksheetRow: row.sourceRowNumber, status: row.status, canCreate, reason, existing: matches };
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
  const normalized = normalizeCorrections(corrections, sourceRows.length);
  if (!normalized.ok) return normalized;
  const rows = applyCorrectionsToRows(sourceRows, normalized.corrections);
  const analysis = await analyzeBookImportRows(rows, options);
  if (!analysis.ok) return analysis;
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
