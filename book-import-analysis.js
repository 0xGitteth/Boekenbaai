'use strict';

const { groupBookCopiesByEdition } = require('./book-edition-core');
const { mapImportRow, readBookImportWorkbook } = require('./book-import-workbook');
const {
  JUNK_ONLY_TOKENS,
  addIssue,
  comparableText,
  normalizeRuntimeBarcode,
  analyzeIdentifier,
} = require('./book-import-analysis-values');
const {
  applySourceCollisions,
  normalizeBookFields,
  normalizeIdentifierFields,
  provenanceForBook,
} = require('./book-import-analysis-row');
const { matchEntityByName, applyContext } = require('./book-import-analysis-context');
const {
  normalizeMetadataCandidate,
  metadataCandidatesFromResult,
  strictMetadataMatch,
  selectMetadataCandidate,
  selectIsbnMetadataCandidate,
  resolveMetadata,
} = require('./book-import-analysis-metadata');

const IDENTIFIER_SOURCE_FIELDS = new Set(['isbn', 'metadataIsbn', 'ambiguousIdentifier']);

function finalizeRowStatus(row) {
  if (row.context.excludeFromSchoolCollection) {
    if (row.issues.some((issue) => issue.code === 'own_book_context_conflict')) return 'conflict';
    return 'skipped';
  }
  if (row.context.skipReason === 'junk') return 'skipped';
  if (row.issues.some((issue) => issue.severity === 'conflict')) return 'conflict';
  if (!row.book.title || JUNK_ONLY_TOKENS.has(comparableText(row.book.title))) return 'unresolved';
  if (!row.book.author) return 'unresolved';
  if (!row.book.editionIsbn) return 'unresolved';
  if (row.issues.some((issue) => issue.severity === 'warning')) return 'warning';
  return 'ready';
}

function sourceSuggestedIsbns(row) {
  const analyses = row?.identifierAnalysis
    ? [row.identifierAnalysis.explicit, row.identifierAnalysis.legacy, row.identifierAnalysis.ambiguous]
    : [];
  return Array.from(new Set(analyses.map((analysis) => analysis?.suggestion?.canonical).filter(Boolean))).sort();
}

function flagConflictingRepairSuggestions(row) {
  const suggestedIsbns = sourceSuggestedIsbns(row);
  const resolvedIsbn = row?.book?.editionIsbn || '';
  const evidenceIsbns = new Set([resolvedIsbn, ...suggestedIsbns].filter(Boolean));
  if (evidenceIsbns.size <= 1) return false;
  addIssue(row, 'conflicting_isbn_repair_suggestions', 'conflict', { suggestedIsbns, resolvedIsbn });
  return true;
}

function hasBlockingIdentifierConflict(row) {
  return row.issues.some((issue) => (
    issue.code === 'conflicting_edition_isbns'
    || (issue.code === 'conflicting_source_columns' && IDENTIFIER_SOURCE_FIELDS.has(issue.field))
  ));
}

function isClearJunkRow(mapped) {
  if (mapped.ignoredDangerousHeaders.length) return false;
  const values = [];
  for (const entries of Object.values(mapped.sources || {})) {
    for (const entry of entries || []) values.push(entry.value);
  }
  for (const entry of mapped.unknown || []) values.push(entry.value);
  const populated = values.map((value) => comparableText(value)).filter(Boolean);
  return Boolean(populated.length && populated.every((value) => JUNK_ONLY_TOKENS.has(value)));
}

function collectColumnSummary(mappedRows) {
  const recognized = new Map();
  const unknown = new Set();
  const ignoredDangerous = new Set();
  for (const mapped of mappedRows) {
    for (const [field, entries] of Object.entries(mapped.sources)) {
      for (const entry of entries) if (!recognized.has(entry.header)) recognized.set(entry.header, field);
    }
    for (const entry of mapped.unknown) unknown.add(entry.header);
    for (const header of mapped.ignoredDangerousHeaders) ignoredDangerous.add(header);
  }
  return {
    recognized: Array.from(recognized, ([header, field]) => ({ header, field })),
    unknown: Array.from(unknown),
    ignoredDangerous: Array.from(ignoredDangerous),
  };
}

function markDuplicateBarcodes(analyzedRows, stagedPhysicalRowIndexes) {
  const barcodeRows = new Map();
  for (const row of analyzedRows) {
    if (!stagedPhysicalRowIndexes.has(row.index)) continue;
    if (row.status !== 'ready' && row.status !== 'warning') continue;
    if (!row.book.barcode || row.context.excludeFromSchoolCollection || row.context.skipReason === 'junk') continue;
    if (!row.book.quantity?.valid || row.book.quantity.value !== 1) continue;
    const key = normalizeRuntimeBarcode(row.book.barcode);
    if (!key) continue;
    const indexes = barcodeRows.get(key) || [];
    indexes.push(row.index);
    barcodeRows.set(key, indexes);
  }
  for (const indexes of barcodeRows.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const row = analyzedRows[index];
      addIssue(row, 'duplicate_physical_barcode', 'conflict', { inputIndexes: [...indexes] });
      row.status = 'conflict';
    }
  }
}

function conflictSourceRowIndexes(copies, conflict) {
  const sourceRows = new Set();
  for (const copyIndex of conflict?.inputIndexes || []) {
    const sourceRowIndex = copies[copyIndex]?.__importRowIndex;
    if (Number.isInteger(sourceRowIndex)) sourceRows.add(sourceRowIndex);
  }
  return Array.from(sourceRows).sort((left, right) => left - right);
}

function applyEditionConflicts(analyzedRows, copies, conflicts) {
  for (const conflict of conflicts || []) {
    const sourceRows = conflictSourceRowIndexes(copies, conflict);
    for (const sourceRowIndex of sourceRows) {
      const row = analyzedRows[sourceRowIndex];
      if (!row) continue;
      addIssue(row, 'edition_identity_conflict', 'conflict', {
        conflictType: conflict.type || 'unknown',
        editionIsbn: conflict.editionIsbn || '',
      });
      row.status = 'conflict';
    }
  }
}

function exposeEditionConflicts(copies, conflicts) {
  return (conflicts || []).map((conflict) => ({
    ...conflict,
    inputIndexes: conflictSourceRowIndexes(copies, conflict),
  }));
}

async function analyzeBookImportRows(rows, options = {}) {
  const inputRows = Array.isArray(rows) ? rows : [];
  const maxRows = Number.isInteger(options.maxRows) && options.maxRows > 0 ? options.maxRows : 20000;
  const maxCopies = Number.isInteger(options.maxCopies) && options.maxCopies > 0 ? options.maxCopies : 50000;
  if (inputRows.length > maxRows) {
    return {
      ok: false,
      error: 'too_many_rows',
      summary: { sourceRows: inputRows.length, maxRows },
      rows: [],
      groups: [],
      conflicts: [],
    };
  }

  const mappedRows = inputRows.map(mapImportRow);
  const analyzedRows = [];
  const editionCopies = [];
  const stagedPhysicalRowIndexes = new Set();
  let totalCopies = 0;

  for (let index = 0; index < mappedRows.length; index += 1) {
    const mapped = mappedRows[index];
    const row = {
      index,
      sourceRowNumber: Number.isInteger(mapped.worksheetRowNumber) ? mapped.worksheetRowNumber + 1 : index + 2,
      status: 'unresolved',
      book: {},
      context: {},
      provenance: {},
      issues: [],
      unknownColumns: mapped.unknown.map((entry) => entry.header),
    };

    if (isClearJunkRow(mapped)) {
      row.context.skipReason = 'junk';
      row.status = 'skipped';
      analyzedRows.push(row);
      continue;
    }

    applySourceCollisions(mapped, row);
    row.book = normalizeBookFields(mapped, row);
    row.identifierAnalysis = normalizeIdentifierFields(mapped, row, row.book);
    row.provenance = provenanceForBook(mapped, row.book, row.identifierAnalysis);
    applyContext(mapped, row, options);

    if (row.context.excludeFromSchoolCollection) {
      row.status = finalizeRowStatus(row);
      analyzedRows.push(row);
      continue;
    }

    if (!row.book.title) addIssue(row, 'missing_title', 'warning');
    else if (JUNK_ONLY_TOKENS.has(comparableText(row.book.title))) addIssue(row, 'junk_title', 'warning');
    if (!row.book.author) addIssue(row, 'missing_author', 'warning');

    const hasConflictingRepairSuggestions = flagConflictingRepairSuggestions(row);
    const hasIdentifierConflict = hasBlockingIdentifierConflict(row);
    if (!hasConflictingRepairSuggestions && !hasIdentifierConflict) await resolveMetadata(row, options);

    if (!row.book.title) addIssue(row, 'missing_title_after_metadata', 'warning');
    if (!row.book.author) addIssue(row, 'missing_author_after_metadata', 'warning');
    if (row.book.barcode && row.book.quantity.valid && row.book.quantity.value > 1) {
      addIssue(row, 'barcode_with_multiple_copies', 'conflict', { requestedCopies: row.book.quantity.value });
    }

    row.status = finalizeRowStatus(row);
    const requestedCopies = row.book.quantity.value;
    if (row.book.quantity.valid && requestedCopies > 0) {
      if (totalCopies + requestedCopies > maxCopies) {
        addIssue(row, 'copy_limit_exceeded', 'conflict', { requestedCopies, maxCopies });
        row.status = 'conflict';
      } else {
        totalCopies += requestedCopies;
        stagedPhysicalRowIndexes.add(index);
        if (row.book.editionIsbn && !hasConflictingRepairSuggestions && !hasBlockingIdentifierConflict(row)) {
          for (let copyIndex = 0; copyIndex < requestedCopies; copyIndex += 1) {
            editionCopies.push({
              title: row.book.title,
              author: row.book.author,
              authors: [...row.book.authors],
              editionIsbn: row.book.editionIsbn,
              metadataIsbn: row.book.metadataIsbn,
              barcode: requestedCopies === 1 ? row.book.barcode : '',
              __importRowIndex: index,
              __copyIndex: copyIndex,
            });
          }
        }
      }
    }
    analyzedRows.push(row);
  }

  markDuplicateBarcodes(analyzedRows, stagedPhysicalRowIndexes);
  const groupableCopies = editionCopies.filter((copy) => {
    const status = analyzedRows[copy.__importRowIndex]?.status;
    return status === 'ready' || status === 'warning';
  });

  let grouped = { groups: [], conflicts: [] };
  try {
    grouped = groupBookCopiesByEdition(groupableCopies);
  } catch {
    return {
      ok: false,
      error: 'edition_grouping_failed',
      summary: { sourceRows: inputRows.length, physicalCopies: totalCopies },
      columns: collectColumnSummary(mappedRows),
      rows: analyzedRows,
      groups: [],
      conflicts: [],
    };
  }

  applyEditionConflicts(analyzedRows, groupableCopies, grouped.conflicts);
  const exposedConflicts = exposeEditionConflicts(groupableCopies, grouped.conflicts);
  for (const group of grouped.groups) {
    for (const copy of group.copies || []) {
      delete copy.__importRowIndex;
      delete copy.__copyIndex;
    }
  }

  const counts = { ready: 0, warning: 0, conflict: 0, unresolved: 0, skipped: 0 };
  for (const row of analyzedRows) counts[row.status] = (counts[row.status] || 0) + 1;
  const repairCount = analyzedRows.reduce((sum, row) => sum + row.issues.filter((issue) => issue.code === 'isbn_repaired').length, 0);
  return {
    ok: true,
    summary: {
      sourceRows: analyzedRows.length,
      physicalCopies: totalCopies,
      editionGroups: grouped.groups.length,
      editionConflicts: exposedConflicts.length,
      repairs: repairCount,
      ...counts,
    },
    columns: collectColumnSummary(mappedRows),
    rows: analyzedRows,
    groups: grouped.groups,
    conflicts: exposedConflicts,
  };
}

async function analyzeBookImportWorkbook(XLSX, input, options = {}) {
  const workbook = readBookImportWorkbook(XLSX, input, options);
  if (!workbook.ok) return { ok: false, error: workbook.error, workbook };
  const analysis = await analyzeBookImportRows(workbook.rows, options);
  if (!analysis.ok) return { ...analysis, workbook: { sheetName: workbook.sheetName, headers: workbook.headers } };
  return { ...analysis, workbook: { sheetName: workbook.sheetName, headers: workbook.headers } };
}

module.exports = {
  analyzeIdentifier,
  normalizeMetadataCandidate,
  metadataCandidatesFromResult,
  strictMetadataMatch,
  selectMetadataCandidate,
  selectIsbnMetadataCandidate,
  matchEntityByName,
  analyzeBookImportRows,
  analyzeBookImportWorkbook,
};
