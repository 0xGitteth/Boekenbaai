'use strict';

const assert = require('assert');
const XLSX = require('xlsx');
const { deflateRawSync } = require('node:zlib');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { readBookImportWorkbook } = require('../book-import-workbook');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';
const issueCodes = (row) => new Set(row.issues.map((issue) => issue.code));

function buildDeflateZip(payload, { compressedSizeDelta = 0, declaredExpandedBytes = payload.length } = {}) {
  const fileName = Buffer.from('xl/worksheets/sheet1.xml');
  const compressed = deflateRawSync(payload);
  const declaredCompressedBytes = Math.max(0, compressed.length + compressedSizeDelta);

  const local = Buffer.alloc(30 + fileName.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(declaredCompressedBytes, 18);
  local.writeUInt32LE(declaredExpandedBytes, 22);
  local.writeUInt16LE(fileName.length, 26);
  fileName.copy(local, 30);

  const central = Buffer.alloc(46 + fileName.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(declaredCompressedBytes, 20);
  central.writeUInt32LE(declaredExpandedBytes, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  fileName.copy(central, 46);

  const centralOffset = local.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, compressed, central, eocd]);
}

function duplicateCentralDirectoryEntry(zipBuffer) {
  const eocdOffset = zipBuffer.length - 22;
  const centralSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const central = zipBuffer.subarray(centralOffset, centralOffset + centralSize);
  const eocd = Buffer.from(zipBuffer.subarray(eocdOffset));
  eocd.writeUInt16LE(2, 8);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(centralSize * 2, 12);
  return Buffer.concat([
    zipBuffer.subarray(0, centralOffset),
    central,
    central,
    eocd,
  ]);
}

module.exports = async function runFinalReviewTests() {
  let titleAuthorLookups = 0;
  const conflictingSuggestions = await analyzeBookImportRows([{
    Titel: 'Dubbele suggestie',
    Auteur: 'A Auteur',
    'ISBN-nummer': '978030640615',
    'Intern ISBN': '978043955493',
  }], {
    lookupTitleAuthor: async () => {
      titleAuthorLookups += 1;
      return { title: 'Dubbele suggestie', author: 'A Auteur', isbn13: ISBN, found: true, source: 'test' };
    },
  });
  const suggestionRow = conflictingSuggestions.rows[0];
  assert.strictEqual(suggestionRow.status, 'conflict');
  assert.strictEqual(suggestionRow.book.editionIsbn, '');
  assert.strictEqual(titleAuthorLookups, 0, 'Conflicting source repair suggestions must block automatic metadata resolution');
  const suggestionConflict = suggestionRow.issues.find((issue) => issue.code === 'conflicting_isbn_repair_suggestions');
  assert.ok(suggestionConflict);
  assert.deepStrictEqual(suggestionConflict.suggestedIsbns, [ISBN, ISBN_ALT].sort());

  const resolvedSuggestionConflict = await analyzeBookImportRows([{
    Titel: 'Bronbewijs conflict', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Intern ISBN': '978043955493',
  }]);
  const resolvedSuggestionRow = resolvedSuggestionConflict.rows[0];
  assert.strictEqual(resolvedSuggestionRow.status, 'conflict');
  assert.strictEqual(resolvedSuggestionRow.book.editionIsbn, ISBN);
  assert.strictEqual(resolvedSuggestionConflict.groups.length, 0, 'Contradictory repair evidence must block grouping even when one valid ISBN is present');
  const resolvedSuggestionIssue = resolvedSuggestionRow.issues.find((issue) => issue.code === 'conflicting_isbn_repair_suggestions');
  assert.ok(resolvedSuggestionIssue);
  assert.strictEqual(resolvedSuggestionIssue.resolvedIsbn, ISBN);
  assert.deepStrictEqual(resolvedSuggestionIssue.suggestedIsbns, [ISBN_ALT]);

  let identityConflictLookups = 0;
  const identityConflictRow = { Titel: 'Bronconflict', Auteur: 'A Auteur' };
  Object.defineProperty(identityConflictRow, 'ISBN-nummer', { value: ISBN, enumerable: true });
  Object.defineProperty(identityConflictRow, 'ISBN-nummer_1', { value: ISBN_ALT, enumerable: true });
  const identityConflict = await analyzeBookImportRows([identityConflictRow], {
    lookupTitleAuthor: async () => {
      identityConflictLookups += 1;
      return { title: 'Bronconflict', author: 'A Auteur', barcode: ISBN, found: true, source: 'test' };
    },
  });
  assert.strictEqual(identityConflict.rows[0].status, 'conflict');
  assert.strictEqual(identityConflict.rows[0].book.editionIsbn, '');
  assert.strictEqual(identityConflictLookups, 0, 'Conflicting identifier source columns must not be resolved by work-level metadata');
  assert.strictEqual(identityConflict.groups.length, 0, 'Rows with unresolved identifier-source conflicts must not enter edition groups');

  const invalidBarcode = await analyzeBookImportRows([{
    Titel: 'Barcode conflict', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: 'ABC',
  }]);
  assert.strictEqual(invalidBarcode.rows[0].status, 'conflict');
  assert.strictEqual(invalidBarcode.rows[0].book.barcode, '');
  assert.ok(issueCodes(invalidBarcode.rows[0]).has('invalid_physical_barcode'));

  const quantityConflict = { Titel: 'Aantal conflict', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(quantityConflict, 'Aantal', { value: 2, enumerable: true });
  Object.defineProperty(quantityConflict, 'Aantal_1', { value: 900, enumerable: true });
  const quantityConflictResult = await analyzeBookImportRows([quantityConflict]);
  assert.strictEqual(quantityConflictResult.rows[0].status, 'conflict');
  assert.strictEqual(quantityConflictResult.rows[0].book.quantity.valid, false);
  assert.strictEqual(quantityConflictResult.rows[0].book.quantity.blockedByConflict, true);
  assert.strictEqual(quantityConflictResult.summary.physicalCopies, 0);
  assert.strictEqual(quantityConflictResult.groups.length, 0);

  const authorConflict = { Titel: 'Auteur conflict', 'ISBN-nummer': ISBN, 'Voornaam schrijver': 'Carry', 'Achternaam schrijver': 'Slee' };
  Object.defineProperty(authorConflict, 'Auteur', { value: 'Andere Auteur', enumerable: true });
  Object.defineProperty(authorConflict, 'Auteur_1', { value: 'Nog Iemand', enumerable: true });
  const authorConflictResult = await analyzeBookImportRows([authorConflict]);
  const authorRow = authorConflictResult.rows[0];
  assert.strictEqual(authorRow.book.author, 'Carry Slee');
  assert.strictEqual(authorRow.provenance.author.source, 'excel');
  assert.strictEqual(authorRow.provenance.author.derived, 'combined_name_parts');
  assert.deepStrictEqual(authorRow.provenance.author.headers, ['Voornaam schrijver', 'Achternaam schrijver']);
  assert.ok(!authorRow.provenance.author.headers.includes('Auteur'));

  const wrapperProvenance = await analyzeBookImportRows([{
    Titel: 'Wrapper bron', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      found: true,
      source: 'wrapper-source',
      fields: {
        title: 'Wrapper bron',
        author: 'A Auteur',
        barcode: ISBN,
        publisher: 'Wrapper uitgever',
      },
    }),
  });
  assert.strictEqual(wrapperProvenance.rows[0].book.publisher, 'Wrapper uitgever');
  assert.strictEqual(wrapperProvenance.rows[0].provenance.publisher.source, 'metadata');
  assert.strictEqual(wrapperProvenance.rows[0].provenance.publisher.detail, 'wrapper-source');

  const barcodeIdentityConflict = await analyzeBookImportRows([{
    Titel: 'Juiste titel', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Andere titel', author: 'A Auteur', barcode: ISBN, found: true, source: 'builtin-isbn',
    }),
  });
  assert.strictEqual(barcodeIdentityConflict.rows[0].status, 'conflict');
  assert.ok(issueCodes(barcodeIdentityConflict.rows[0]).has('metadata_title_conflict'));

  const multiAuthorMetadata = await analyzeBookImportRows([{
    Titel: 'Samen geschreven', Auteur: 'Alice; Bob',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Samen geschreven', authors: ['Alice', 'Bob'], barcode: ISBN, found: true, source: 'title-author',
    }),
  });
  assert.strictEqual(multiAuthorMetadata.rows[0].book.editionIsbn, ISBN);
  assert.deepStrictEqual(multiAuthorMetadata.rows[0].book.authors, ['Alice', 'Bob']);
  assert.ok(issueCodes(multiAuthorMetadata.rows[0]).has('isbn_resolved_from_metadata'));

  const identifierlessTitleLookup = await analyzeBookImportRows([{
    Titel: 'Zonder editie', Auteur: 'A Auteur',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Zonder editie', author: 'A Auteur', publisher: 'Bron uitgever', found: true, source: 'metadata-only',
    }),
  });
  assert.strictEqual(identifierlessTitleLookup.rows[0].status, 'unresolved');
  assert.strictEqual(identifierlessTitleLookup.rows[0].book.editionIsbn, '');
  assert.strictEqual(identifierlessTitleLookup.rows[0].book.publisher, 'Bron uitgever');
  assert.ok(issueCodes(identifierlessTitleLookup.rows[0]).has('title_author_metadata_missing_edition_isbn'));
  assert.strictEqual(identifierlessTitleLookup.groups.length, 0);

  const publishedAt = await analyzeBookImportRows([{
    Titel: 'Datumboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Datumboek', author: 'A Auteur', barcode: ISBN, publishedAt: '2019-10-02', found: true, source: 'openlibrary',
    }),
  });
  assert.strictEqual(publishedAt.rows[0].book.publishedYear, 2019);
  assert.strictEqual(publishedAt.rows[0].provenance.publishedYear.detail, 'openlibrary');

  const metadataAliasFallback = await analyzeBookImportRows([{
    Titel: 'Aliasboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Aliasboek', author: 'A Auteur', barcode: ISBN,
      publishedYear: 'unknown', publishedAt: '2019-10-02', pageCount: 'many', pages: 321,
      found: true, source: 'alias-fallback',
    }),
  });
  assert.strictEqual(metadataAliasFallback.rows[0].book.publishedYear, 2019);
  assert.strictEqual(metadataAliasFallback.rows[0].book.pageCount, 321);
  assert.strictEqual(metadataAliasFallback.rows[0].provenance.publishedYear.detail, 'alias-fallback');
  assert.strictEqual(metadataAliasFallback.rows[0].provenance.pageCount.detail, 'alias-fallback');

  const libraryPresence = await analyzeBookImportRows([{
    Titel: 'Niet aanwezig', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Aanwezig bieb': 'Nee',
  }]);
  assert.deepStrictEqual(libraryPresence.rows[0].context.libraryPresence, { status: 'needs_review', value: 'Nee' });
  assert.ok(issueCodes(libraryPresence.rows[0]).has('library_presence_needs_review'));
  assert.strictEqual(libraryPresence.rows[0].status, 'warning');

  const stripTag = await analyzeBookImportRows([{
    Titel: 'Stripboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Examenmateriaal: 'Strip',
  }]);
  const stripRow = stripTag.rows[0];
  assert.ok(stripRow.book.tags.includes('strip'));
  assert.strictEqual(stripRow.provenance.tags.source, 'derived');
  assert.strictEqual(stripRow.provenance.tags.detail, 'exam_material_strip_tag');
  assert.strictEqual(stripRow.provenance.tags.header, 'Examenmateriaal');
  assert.strictEqual(stripRow.provenance.tags.raw, 'Strip');

  const groupedConflict = await analyzeBookImportRows([
    { Titel: 'Titel A', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Aantal: 2 },
    { Titel: 'Titel B', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Aantal: 1 },
  ]);
  assert.strictEqual(groupedConflict.summary.physicalCopies, 3);
  assert.strictEqual(groupedConflict.conflicts.length, 1);
  assert.strictEqual(groupedConflict.conflicts[0].type, 'same_isbn_different_title');
  assert.deepStrictEqual(groupedConflict.conflicts[0].inputIndexes, [0, 1]);
  assert.ok(groupedConflict.conflicts[0].inputIndexes.every((index) => index < groupedConflict.rows.length));
  assert.strictEqual(groupedConflict.rows[0].status, 'conflict');
  assert.strictEqual(groupedConflict.rows[1].status, 'conflict');

  const rows = [['Titel', 'Auteur', 'ISBN-nummer']];
  for (let index = 0; index < 100; index += 1) rows.push([`Boek ${index}`, 'A Auteur', ISBN]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Boeken');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const hiddenExpansionPayload = Buffer.alloc(4096, 65);
  const hiddenExpansionZip = buildDeflateZip(hiddenExpansionPayload, { declaredExpandedBytes: 64 });
  let hiddenExpansionReadCalled = false;
  const hiddenExpansionResult = readBookImportWorkbook({
    read() {
      hiddenExpansionReadCalled = true;
      throw new Error('Hidden expansion must be rejected before SheetJS');
    },
    utils: { sheet_to_json: () => [] },
  }, hiddenExpansionZip, { maxExpandedBytes: 128, maxCompressionRatio: 1000 });
  assert.strictEqual(hiddenExpansionResult.ok, false);
  assert.strictEqual(hiddenExpansionResult.error, 'file_too_large');
  assert.strictEqual(hiddenExpansionResult.reason, 'archive_expansion_limit');
  assert.strictEqual(hiddenExpansionReadCalled, false);

  const overlappingEntryZip = duplicateCentralDirectoryEntry(buildDeflateZip(Buffer.alloc(256, 67)));
  let overlappingReadCalled = false;
  const overlappingEntryResult = readBookImportWorkbook({
    read() {
      overlappingReadCalled = true;
      throw new Error('Overlapping ZIP entries must be rejected before SheetJS');
    },
    utils: { sheet_to_json: () => [] },
  }, overlappingEntryZip, { maxExpandedBytes: 4096 });
  assert.strictEqual(overlappingEntryResult.ok, false);
  assert.strictEqual(overlappingEntryResult.error, 'invalid_workbook');
  assert.strictEqual(overlappingEntryResult.reason, 'overlapping_zip_entries');
  assert.strictEqual(overlappingReadCalled, false);

  const truncatedDeflateZip = buildDeflateZip(Buffer.alloc(1024, 66), { compressedSizeDelta: -1 });
  let truncatedReadCalled = false;
  const truncatedDeflateResult = readBookImportWorkbook({
    read() {
      truncatedReadCalled = true;
      throw new Error('Truncated deflate declaration must be rejected before SheetJS');
    },
    utils: { sheet_to_json: () => [] },
  }, truncatedDeflateZip, { maxExpandedBytes: 4096 });
  assert.strictEqual(truncatedDeflateResult.ok, false);
  assert.strictEqual(truncatedDeflateResult.error, 'invalid_workbook');
  assert.strictEqual(truncatedDeflateResult.reason, 'invalid_zip_stream');
  assert.strictEqual(truncatedReadCalled, false);

  let archiveReadCalled = false;
  const archiveGuardXlsx = {
    read() {
      archiveReadCalled = true;
      throw new Error('Archive preflight must run before SheetJS');
    },
    utils: { ...XLSX.utils },
  };
  const expandedArchiveLimit = readBookImportWorkbook(archiveGuardXlsx, buffer, { maxExpandedBytes: 1 });
  assert.strictEqual(expandedArchiveLimit.ok, false);
  assert.strictEqual(expandedArchiveLimit.error, 'file_too_large');
  assert.strictEqual(expandedArchiveLimit.reason, 'archive_expansion_limit');
  assert.strictEqual(archiveReadCalled, false, 'ZIP expansion limits must be enforced before XLSX.read');

  archiveReadCalled = false;
  const archiveEntryLimit = readBookImportWorkbook(archiveGuardXlsx, buffer, { maxArchiveEntries: 1 });
  assert.strictEqual(archiveEntryLimit.ok, false);
  assert.strictEqual(archiveEntryLimit.error, 'file_too_large');
  assert.strictEqual(archiveEntryLimit.reason, 'archive_entry_limit');
  assert.strictEqual(archiveReadCalled, false, 'ZIP entry-count limits must be enforced before XLSX.read');

  const compressedBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
  const validCompressedWorkbook = readBookImportWorkbook(XLSX, compressedBuffer, { maxRows: 200 });
  assert.strictEqual(validCompressedWorkbook.ok, true, 'Ordinary compressed XLSX files must remain accepted under default archive limits');
  assert.strictEqual(validCompressedWorkbook.rows.length, 100);

  archiveReadCalled = false;
  const compressionRatioLimit = readBookImportWorkbook(archiveGuardXlsx, compressedBuffer, { maxCompressionRatio: 1 });
  assert.strictEqual(compressionRatioLimit.ok, false);
  assert.strictEqual(compressionRatioLimit.error, 'file_too_large');
  assert.strictEqual(compressionRatioLimit.reason, 'archive_compression_ratio');
  assert.strictEqual(archiveReadCalled, false, 'Suspicious ZIP compression ratios must be rejected before XLSX.read');

  let sheetToJsonCalled = false;
  const guardedXlsx = {
    read: (...args) => XLSX.read(...args),
    utils: {
      ...XLSX.utils,
      sheet_to_json: (...args) => {
        sheetToJsonCalled = true;
        return XLSX.utils.sheet_to_json(...args);
      },
    },
  };
  const limited = readBookImportWorkbook(guardedXlsx, buffer, { maxRows: 2 });
  assert.strictEqual(limited.ok, false);
  assert.strictEqual(limited.error, 'too_many_rows');
  assert.strictEqual(sheetToJsonCalled, false, 'Real SheetJS row limiting should reject oversized sheets before JSON materialization');

  const leadingBlankSheet = {};
  XLSX.utils.sheet_add_aoa(leadingBlankSheet, [
    ['Titel', 'Auteur', 'ISBN-nummer'],
    ['Boek A', 'A Auteur', ISBN],
    ['Boek B', 'B Auteur', ISBN_ALT],
  ], { origin: 'A3' });
  leadingBlankSheet['!ref'] = 'A3:C5';
  const leadingBlankWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(leadingBlankWorkbook, leadingBlankSheet, 'Boeken');
  const leadingBlankBuffer = XLSX.write(leadingBlankWorkbook, { type: 'buffer', bookType: 'xlsx' });
  const leadingBlankResult = readBookImportWorkbook(XLSX, leadingBlankBuffer, { maxRows: 2 });
  assert.strictEqual(leadingBlankResult.ok, true, 'Leading blank worksheet rows must not cause valid tail rows to be truncated');
  assert.strictEqual(leadingBlankResult.rows.length, 2);
  assert.deepStrictEqual(leadingBlankResult.rows.map((row) => row.Titel), ['Boek A', 'Boek B']);
};
