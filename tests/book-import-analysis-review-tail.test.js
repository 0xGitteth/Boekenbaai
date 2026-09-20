'use strict';

const assert = require('assert');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { readBookImportWorkbook } = require('../book-import-workbook');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';
const issueCodes = (row) => new Set(row.issues.map((issue) => issue.code));

module.exports = async function runReviewTailTests() {
  const zeroCopyDuplicate = await analyzeBookImportRows([
    { Titel: 'Niet importeren', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '12345', Aantal: 0 },
    { Titel: 'Wel importeren', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: '12345', Aantal: 1 },
  ]);
  assert.strictEqual(zeroCopyDuplicate.summary.physicalCopies, 1);
  assert.ok(!issueCodes(zeroCopyDuplicate.rows[0]).has('duplicate_physical_barcode'));
  assert.ok(!issueCodes(zeroCopyDuplicate.rows[1]).has('duplicate_physical_barcode'));
  assert.strictEqual(zeroCopyDuplicate.groups.length, 1);

  const wrapperCandidates = await analyzeBookImportRows([{
    Titel: 'Wrapper candidates', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      source: 'wrapper-candidates',
      candidates: [{
        title: 'Wrapper candidates', author: 'A Auteur', barcode: ISBN, publisher: 'Wrapper uitgever', found: true,
      }],
    }),
  });
  assert.strictEqual(wrapperCandidates.rows[0].book.publisher, 'Wrapper uitgever');
  assert.strictEqual(wrapperCandidates.rows[0].provenance.publisher.source, 'metadata');
  assert.strictEqual(wrapperCandidates.rows[0].provenance.publisher.detail, 'wrapper-candidates');

  const exactWithNoise = await analyzeBookImportRows([{
    Titel: 'Exact boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      source: 'search-results',
      candidates: [
        { title: 'Exact boek', author: 'A Auteur', barcode: ISBN, publisher: 'Exact uitgever', found: true },
        { title: 'Ander boek', author: 'B Auteur', barcode: ISBN_ALT, publisher: 'Andere uitgever', found: true },
      ],
    }),
  });
  assert.strictEqual(exactWithNoise.rows[0].book.publisher, 'Exact uitgever');
  assert.ok(!issueCodes(exactWithNoise.rows[0]).has('ambiguous_isbn_lookup_results'));
  assert.ok(!issueCodes(exactWithNoise.rows[0]).has('metadata_title_conflict'));

  const literalMarkerTitle = await analyzeBookImportRows([{
    Titel: 'Eigen boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(literalMarkerTitle.rows[0].book.title, 'Eigen boek');
  assert.notStrictEqual(literalMarkerTitle.rows[0].context.excludeFromSchoolCollection, true);
  assert.ok(!issueCodes(literalMarkerTitle.rows[0]).has('own_book_excluded'));
  assert.strictEqual(literalMarkerTitle.groups.length, 1);

  const copyLimitDuplicate = await analyzeBookImportRows([
    { Titel: 'Eerste', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '55555', Aantal: 1 },
    { Titel: 'Tweede', Auteur: 'B Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: '55555', Aantal: 1 },
  ], { maxCopies: 1 });
  assert.strictEqual(copyLimitDuplicate.summary.physicalCopies, 1);
  assert.strictEqual(copyLimitDuplicate.rows[0].status, 'ready');
  assert.ok(!issueCodes(copyLimitDuplicate.rows[0]).has('duplicate_physical_barcode'));
  assert.ok(issueCodes(copyLimitDuplicate.rows[1]).has('copy_limit_exceeded'));
  assert.ok(!issueCodes(copyLimitDuplicate.rows[1]).has('duplicate_physical_barcode'));
  assert.strictEqual(copyLimitDuplicate.groups.length, 1);

  const alreadyConflictedDuplicate = { Auteur: 'B Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: '66666' };
  Object.defineProperty(alreadyConflictedDuplicate, 'Titel', { value: 'Titel A', enumerable: true });
  Object.defineProperty(alreadyConflictedDuplicate, 'Titel_1', { value: 'Titel B', enumerable: true });
  const conflictedDuplicateResult = await analyzeBookImportRows([
    { Titel: 'Geldig', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '66666' },
    alreadyConflictedDuplicate,
  ]);
  assert.strictEqual(conflictedDuplicateResult.rows[0].status, 'conflict');
  assert.ok(issueCodes(conflictedDuplicateResult.rows[0]).has('duplicate_physical_barcode'));
  assert.strictEqual(conflictedDuplicateResult.rows[1].status, 'conflict');
  assert.ok(issueCodes(conflictedDuplicateResult.rows[1]).has('duplicate_physical_barcode'));

  const duplicateBarcodeSafeGrouping = await analyzeBookImportRows([
    { Titel: 'Zelfde editie', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '77777' },
    { Titel: 'Zelfde editie', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '77777' },
  ]);
  assert.strictEqual(duplicateBarcodeSafeGrouping.rows[0].status, 'conflict');
  assert.strictEqual(duplicateBarcodeSafeGrouping.rows[1].status, 'conflict');
  assert.ok(issueCodes(duplicateBarcodeSafeGrouping.rows[0]).has('duplicate_physical_barcode'));
  assert.ok(issueCodes(duplicateBarcodeSafeGrouping.rows[1]).has('duplicate_physical_barcode'));
  assert.strictEqual(duplicateBarcodeSafeGrouping.groups.length, 1, 'Physical barcode conflicts must not erase safe edition identity');
  assert.strictEqual(duplicateBarcodeSafeGrouping.groups[0].copies.length, 2);

  const loanConflictSafeGrouping = await analyzeBookImportRows([{
    Titel: 'Leenconflict', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Geleend door klas': 'Onbekende klas',
  }]);
  assert.strictEqual(loanConflictSafeGrouping.rows[0].status, 'conflict');
  assert.ok(issueCodes(loanConflictSafeGrouping.rows[0]).has('class_loan_unmatched'));
  assert.strictEqual(loanConflictSafeGrouping.groups.length, 1, 'Loan-context conflicts must stay separate from edition identity');

  const stagedConflictDuplicate = await analyzeBookImportRows([
    { Titel: 'Conflict copy', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '88888', 'Geleend door klas': 'Onbekende klas' },
    { Titel: 'Ready copy', Auteur: 'B Auteur', 'ISBN-nummer': ISBN_ALT, Barcode: '88888' },
  ]);
  assert.ok(issueCodes(stagedConflictDuplicate.rows[0]).has('class_loan_unmatched'));
  assert.ok(issueCodes(stagedConflictDuplicate.rows[0]).has('duplicate_physical_barcode'));
  assert.ok(issueCodes(stagedConflictDuplicate.rows[1]).has('duplicate_physical_barcode'));
  assert.strictEqual(stagedConflictDuplicate.rows[1].status, 'conflict');

  const equivalentBarcodeColumns = { Titel: 'Barcode-equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentBarcodeColumns, 'Barcode', { value: '123-456', enumerable: true });
  Object.defineProperty(equivalentBarcodeColumns, 'Barcode_1', { value: '123456', enumerable: true });
  const equivalentBarcodeResult = await analyzeBookImportRows([equivalentBarcodeColumns]);
  assert.strictEqual(equivalentBarcodeResult.rows[0].book.barcode, '123456');
  assert.ok(!issueCodes(equivalentBarcodeResult.rows[0]).has('conflicting_source_columns'));
  assert.strictEqual(equivalentBarcodeResult.groups.length, 1);

  const conflictingCombinedBarcode = await analyzeBookImportRows([{
    Titel: 'Barcode-bronnen', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: '123', 'Barcode / ISBN': '456',
  }]);
  assert.strictEqual(conflictingCombinedBarcode.rows[0].book.barcode, '123');
  assert.strictEqual(conflictingCombinedBarcode.rows[0].status, 'conflict');
  assert.ok(issueCodes(conflictingCombinedBarcode.rows[0]).has('conflicting_physical_barcodes'));
  assert.strictEqual(conflictingCombinedBarcode.groups.length, 1, 'Physical barcode evidence must not erase safe edition identity');

  const placeholderAuthorProvenance = await analyzeBookImportRows([{
    Titel: 'Placeholder auteur', Auteur: 'nvt', 'Voornaam schrijver': 'Carry', 'Achternaam schrijver': 'Slee', 'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(placeholderAuthorProvenance.rows[0].book.author, 'Carry Slee');
  assert.strictEqual(placeholderAuthorProvenance.rows[0].provenance.author.source, 'excel');
  assert.strictEqual(placeholderAuthorProvenance.rows[0].provenance.author.derived, 'combined_name_parts');
  assert.deepStrictEqual(placeholderAuthorProvenance.rows[0].provenance.author.headers, ['Voornaam schrijver', 'Achternaam schrijver']);

  const quantityProvenance = await analyzeBookImportRows([{
    Titel: 'Aantal bron', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Aantal exemplaren': '01',
  }]);
  assert.strictEqual(quantityProvenance.rows[0].book.quantity.value, 1);
  assert.deepStrictEqual(quantityProvenance.rows[0].provenance.quantity, {
    source: 'excel', header: 'Aantal exemplaren', raw: '01',
  });

  const customSuffixedHeader = await analyzeBookImportRows([{
    Titel: 'Custom ISBN kolom', Auteur: 'A Auteur', ISBN_2024: ISBN,
  }]);
  assert.strictEqual(customSuffixedHeader.rows[0].book.editionIsbn, '');
  assert.strictEqual(customSuffixedHeader.rows[0].status, 'unresolved');
  assert.ok(customSuffixedHeader.rows[0].unknownColumns.includes('ISBN_2024'));

  const duplicateIsbnEvidence = { Titel: 'ISBN bewijs', Auteur: 'A Auteur' };
  Object.defineProperty(duplicateIsbnEvidence, 'ISBN-nummer', { value: '978030640615', enumerable: true });
  Object.defineProperty(duplicateIsbnEvidence, 'ISBN-nummer_1', { value: ISBN, enumerable: true });
  const duplicateIsbnResult = await analyzeBookImportRows([duplicateIsbnEvidence]);
  assert.strictEqual(duplicateIsbnResult.rows[0].book.editionIsbn, ISBN);
  assert.ok(!issueCodes(duplicateIsbnResult.rows[0]).has('conflicting_source_columns'));
  assert.ok(issueCodes(duplicateIsbnResult.rows[0]).has('isbn_repair_suggested'));
  assert.strictEqual(duplicateIsbnResult.rows[0].provenance.editionIsbn.header, 'ISBN-nummer_1');
  assert.strictEqual(duplicateIsbnResult.groups.length, 1);

  const duplicateRepairedIsbnEvidence = { Titel: 'ISBN reparatiebewijs', Auteur: 'A Auteur' };
  Object.defineProperty(duplicateRepairedIsbnEvidence, 'ISBN-nummer', { value: '306406152', enumerable: true });
  Object.defineProperty(duplicateRepairedIsbnEvidence, 'ISBN-nummer_1', { value: ISBN, enumerable: true });
  const duplicateRepairedIsbnResult = await analyzeBookImportRows([duplicateRepairedIsbnEvidence]);
  assert.strictEqual(duplicateRepairedIsbnResult.rows[0].book.editionIsbn, ISBN);
  assert.ok(!issueCodes(duplicateRepairedIsbnResult.rows[0]).has('conflicting_source_columns'));
  assert.ok(issueCodes(duplicateRepairedIsbnResult.rows[0]).has('isbn_repaired'));
  assert.strictEqual(duplicateRepairedIsbnResult.groups.length, 1);

  const metadataTitleConflict = await analyzeBookImportRows([{
    Titel: 'Bron titel', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Andere titel', author: 'A Auteur', barcode: ISBN, publisher: 'Niet toepassen', found: true, source: 'test',
    }),
  });
  assert.strictEqual(metadataTitleConflict.rows[0].status, 'conflict');
  assert.ok(issueCodes(metadataTitleConflict.rows[0]).has('metadata_title_conflict'));
  assert.strictEqual(metadataTitleConflict.groups.length, 0, 'Title-conflicted rows must not appear in safe edition groups');

  const duplicateTitleColumns = { Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(duplicateTitleColumns, 'Titel', { value: 'Titel A', enumerable: true });
  Object.defineProperty(duplicateTitleColumns, 'Titel_1', { value: 'Titel B', enumerable: true });
  const duplicateTitleResult = await analyzeBookImportRows([duplicateTitleColumns]);
  assert.strictEqual(duplicateTitleResult.rows[0].status, 'conflict');
  assert.ok(issueCodes(duplicateTitleResult.rows[0]).has('conflicting_source_columns'));
  assert.strictEqual(duplicateTitleResult.groups.length, 0, 'Rows with conflicting title columns must not enter edition groups');

  const unresolvedWithIsbn = await analyzeBookImportRows([{
    Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(unresolvedWithIsbn.rows[0].status, 'unresolved');
  assert.strictEqual(unresolvedWithIsbn.groups.length, 0, 'Rows with incomplete edition evidence must remain outside safe groups');

  const contradictoryExactCandidates = await analyzeBookImportRows([{
    Titel: 'Juiste titel', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      source: 'same-isbn-search',
      candidates: [
        { title: 'Juiste titel', author: 'A Auteur', barcode: ISBN, publisher: 'Juiste uitgever', found: true },
        { title: 'Andere titel', author: 'A Auteur', barcode: ISBN, publisher: 'Andere uitgever', found: true },
      ],
    }),
  });
  assert.strictEqual(contradictoryExactCandidates.rows[0].status, 'conflict');
  assert.ok(issueCodes(contradictoryExactCandidates.rows[0]).has('metadata_title_conflict'));
  assert.strictEqual(contradictoryExactCandidates.rows[0].book.publisher, '');
  assert.strictEqual(contradictoryExactCandidates.groups.length, 0);

  const mismatchedExactIsbn = await analyzeBookImportRows([{
    Titel: 'Verkeerde editie', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Verkeerde editie', author: 'A Auteur', barcode: ISBN_ALT, found: true, source: 'mismatch',
    }),
  });
  assert.strictEqual(mismatchedExactIsbn.rows[0].status, 'conflict');
  assert.ok(issueCodes(mismatchedExactIsbn.rows[0]).has('ambiguous_isbn_lookup_results'));
  assert.strictEqual(mismatchedExactIsbn.groups.length, 0, 'Mismatched exact-ISBN evidence must block safe edition grouping');

  const unsupportedWithFallback = await analyzeBookImportRows([{
    Titel: 'Unsupported bron', Auteur: 'A Auteur', 'ISBN-nummer': true, 'Intern ISBN': ISBN,
  }]);
  assert.strictEqual(unsupportedWithFallback.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(unsupportedWithFallback.rows[0].status, 'conflict');
  assert.ok(issueCodes(unsupportedWithFallback.rows[0]).has('unsupported_identifier_type'));
  assert.strictEqual(unsupportedWithFallback.groups.length, 0, 'Unsupported identifier evidence must block safe edition grouping');

  let exactLookupCalls = 0;
  const metadataReconciliation = await analyzeBookImportRows([{
    Titel: 'Metadata reconcile', Auteur: 'A Auteur',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Metadata reconcile', author: 'A Auteur', barcode: ISBN, publisher: 'Work-level',
      publishedYear: 2020, pageCount: 100, language: 'nl', coverUrl: 'https://example.test/work.jpg',
      description: 'work', tags: ['work'], themes: ['work'], found: true, source: 'work-level',
    }),
    lookupIsbn: async () => {
      exactLookupCalls += 1;
      return {
        title: 'Metadata reconcile', author: 'A Auteur', barcode: ISBN, publisher: 'Exact-edition',
        publishedYear: 2021, pageCount: 110, language: 'nl', coverUrl: 'https://example.test/exact.jpg',
        description: 'exact', tags: ['exact'], themes: ['exact'], found: true, source: 'exact-edition',
      };
    },
  });
  assert.strictEqual(exactLookupCalls, 1, 'A newly resolved ISBN must always receive one exact-edition reconciliation');
  assert.strictEqual(metadataReconciliation.rows[0].book.publisher, 'Exact-edition');
  assert.strictEqual(metadataReconciliation.rows[0].book.publishedYear, 2021);
  assert.strictEqual(metadataReconciliation.rows[0].book.pageCount, 110);
  assert.strictEqual(metadataReconciliation.rows[0].book.description, 'exact');
  assert.strictEqual(metadataReconciliation.rows[0].provenance.publisher.source, 'metadata');
  assert.strictEqual(metadataReconciliation.rows[0].provenance.publisher.detail, 'exact-edition');
  assert.ok(!metadataReconciliation.rows[0].issues.some((issue) => issue.code === 'metadata_differs_from_excel' && issue.field === 'publisher'));

  let decodedBase64 = false;
  const originalBufferFrom = Buffer.from;
  Buffer.from = function monitoredBufferFrom(value, encoding, ...rest) {
    if (typeof value === 'string' && encoding === 'base64') decodedBase64 = true;
    return originalBufferFrom.call(Buffer, value, encoding, ...rest);
  };
  let encodedLimitResult;
  try {
    encodedLimitResult = readBookImportWorkbook({
      read: () => { throw new Error('must not parse'); },
      utils: { sheet_to_json: () => [] },
    }, 'AAAAAAAA', { maxBytes: 4 });
  } finally {
    Buffer.from = originalBufferFrom;
  }
  assert.strictEqual(encodedLimitResult.ok, false);
  assert.strictEqual(encodedLimitResult.error, 'file_too_large');
  assert.strictEqual(decodedBase64, false, 'Oversized base64 must be rejected before allocating the decoded Buffer');

  const whitespaceBase64 = readBookImportWorkbook({
    read: () => { throw new Error('decoded input reached parser'); },
    utils: { sheet_to_json: () => [] },
  }, 'AAAA\n \tAAAA', { maxBytes: 6 });
  assert.strictEqual(whitespaceBase64.ok, false);
  assert.strictEqual(whitespaceBase64.error, 'invalid_workbook', 'Internal base64 whitespace must not inflate the pre-decode size estimate');
};
