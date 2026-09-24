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
  assert.strictEqual(literalMarkerTitle.rows[0].book.title, '');
  assert.strictEqual(literalMarkerTitle.rows[0].status, 'skipped');
  assert.strictEqual(literalMarkerTitle.rows[0].context.excludeFromSchoolCollection, true);
  assert.ok(issueCodes(literalMarkerTitle.rows[0]).has('own_book_excluded'));
  assert.strictEqual(literalMarkerTitle.groups.length, 0);

  const unknownColumnMarker = await analyzeBookImportRows([{
    Titel: 'Notitieboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Notitie: 'eigen boek',
  }]);
  assert.strictEqual(unknownColumnMarker.rows[0].status, 'skipped');
  assert.strictEqual(unknownColumnMarker.rows[0].context.excludeFromSchoolCollection, true);
  assert.ok(issueCodes(unknownColumnMarker.rows[0]).has('own_book_excluded'));
  assert.strictEqual(unknownColumnMarker.groups.length, 0);

  const commaUnknownMarker = await analyzeBookImportRows([{
    Titel: 'Komma notitie', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Notitie: 'school, eigen boek',
  }]);
  assert.strictEqual(commaUnknownMarker.rows[0].status, 'skipped');
  assert.strictEqual(commaUnknownMarker.rows[0].context.excludeFromSchoolCollection, true);
  assert.ok(issueCodes(commaUnknownMarker.rows[0]).has('own_book_excluded'));

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

  const equivalentCombinedBarcodeColumns = { Titel: 'Combined barcode-equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentCombinedBarcodeColumns, 'Barcode / ISBN', { value: '123-456', enumerable: true });
  Object.defineProperty(equivalentCombinedBarcodeColumns, 'Barcode / ISBN_1', { value: '123456', enumerable: true });
  const equivalentCombinedBarcodeResult = await analyzeBookImportRows([equivalentCombinedBarcodeColumns]);
  assert.strictEqual(equivalentCombinedBarcodeResult.rows[0].book.barcode, '123456');
  assert.ok(!issueCodes(equivalentCombinedBarcodeResult.rows[0]).has('conflicting_source_columns'));
  assert.ok(issueCodes(equivalentCombinedBarcodeResult.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));
  assert.strictEqual(equivalentCombinedBarcodeResult.rows[0].provenance.barcode.header, 'Barcode / ISBN');
  assert.strictEqual(equivalentCombinedBarcodeResult.groups.length, 1);

  const isbnLikeCombinedCollision = { Titel: 'ISBN-achtige combined collision', Auteur: 'A Auteur' };
  Object.defineProperty(isbnLikeCombinedCollision, 'Barcode / ISBN', { value: '9780306406158', enumerable: true });
  Object.defineProperty(isbnLikeCombinedCollision, 'Barcode / ISBN_1', { value: '978-0-306-40615-8', enumerable: true });
  const isbnLikeCombinedCollisionResult = await analyzeBookImportRows([isbnLikeCombinedCollision]);
  assert.strictEqual(isbnLikeCombinedCollisionResult.rows[0].book.barcode, '');
  assert.strictEqual(isbnLikeCombinedCollisionResult.rows[0].status, 'conflict');
  assert.ok(issueCodes(isbnLikeCombinedCollisionResult.rows[0]).has('conflicting_source_columns'));

  for (const malformedBookland of ['97803064061', '97803064061570', '97803064061X']) {
    const malformedBooklandResult = await analyzeBookImportRows([{
      Titel: 'Afgekapt Bookland', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Barcode / ISBN': malformedBookland,
    }]);
    assert.strictEqual(malformedBooklandResult.rows[0].book.barcode, '');
    assert.ok(issueCodes(malformedBooklandResult.rows[0]).has('invalid_or_unrecognized_isbn'));
    assert.ok(!issueCodes(malformedBooklandResult.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));
  }

  const nonBooklandElevenDigitBarcode = await analyzeBookImportRows([{
    Titel: 'Elf cijfers barcode', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Barcode / ISBN': '12345678901',
  }]);
  assert.strictEqual(nonBooklandElevenDigitBarcode.rows[0].book.barcode, '12345678901');
  assert.ok(issueCodes(nonBooklandElevenDigitBarcode.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));

  for (const repairableBookland of ['978030640615', '9780306406158']) {
    const repairableCombinedIsbn = await analyzeBookImportRows([{
      Titel: 'Herstelbare combined ISBN', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Barcode / ISBN': repairableBookland,
    }]);
    assert.strictEqual(repairableCombinedIsbn.rows[0].book.barcode, '');
    assert.ok(issueCodes(repairableCombinedIsbn.rows[0]).has('isbn_repair_suggested'));
    assert.ok(!issueCodes(repairableCombinedIsbn.rows[0]).has('invalid_or_unrecognized_isbn'));
    assert.ok(!issueCodes(repairableCombinedIsbn.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));
  }

  for (const labelledRepairable of ['ISBN: 978030640615', 'ISBN-13: 9780306406158']) {
    const labelledRepairableResult = await analyzeBookImportRows([{
      Titel: 'Gelabelde herstelbare ISBN', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Barcode / ISBN': labelledRepairable,
    }]);
    assert.strictEqual(labelledRepairableResult.rows[0].book.barcode, '');
    assert.ok(issueCodes(labelledRepairableResult.rows[0]).has('isbn_repair_suggested'));
    assert.ok(!issueCodes(labelledRepairableResult.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));
  }

  for (const labelledMalformed of ['ISBN: 97803064061', 'ISBN 12345678901', 'ISBN-10: nonsense']) {
    const labelledMalformedResult = await analyzeBookImportRows([{
      Titel: 'Gelabelde ongeldige ISBN', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Barcode / ISBN': labelledMalformed,
    }]);
    assert.strictEqual(labelledMalformedResult.rows[0].book.barcode, '');
    assert.ok(issueCodes(labelledMalformedResult.rows[0]).has('invalid_or_unrecognized_isbn'));
    assert.ok(!issueCodes(labelledMalformedResult.rows[0]).has('ambiguous_identifier_interpreted_as_barcode'));
  }

  for (const labelledValid of ['ISBN-13: 978-0-306-40615-7', 'ISBN–13: 978-0-306-40615-7']) {
    const labelledValidIsbn = await analyzeBookImportRows([{
      Titel: 'Gelabelde geldige ISBN', Auteur: 'A Auteur', 'Barcode / ISBN': labelledValid,
    }]);
    assert.strictEqual(labelledValidIsbn.rows[0].book.editionIsbn, ISBN);
    assert.strictEqual(labelledValidIsbn.rows[0].book.barcode, '');
    assert.ok(issueCodes(labelledValidIsbn.rows[0]).has('ambiguous_identifier_interpreted_as_isbn'));
  }

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

  const equivalentAuthorColumns = { Titel: 'Auteur equivalent', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentAuthorColumns, 'Auteur', { value: 'Alice; Bob', enumerable: true });
  Object.defineProperty(equivalentAuthorColumns, 'Auteur_1', { value: 'Bob & Alice', enumerable: true });
  const equivalentAuthorResult = await analyzeBookImportRows([equivalentAuthorColumns]);
  assert.deepStrictEqual(equivalentAuthorResult.rows[0].book.authors, ['Alice', 'Bob']);
  assert.strictEqual(equivalentAuthorResult.rows[0].book.author, 'Alice & Bob');
  assert.ok(!issueCodes(equivalentAuthorResult.rows[0]).has('conflicting_source_columns'));
  assert.strictEqual(equivalentAuthorResult.groups.length, 1);

  const duplicateAuthorListColumns = { Titel: 'Auteur dedupe equivalent', 'ISBN-nummer': ISBN };
  Object.defineProperty(duplicateAuthorListColumns, 'Auteur', { value: 'Alice; Alice; Bob', enumerable: true });
  Object.defineProperty(duplicateAuthorListColumns, 'Auteur_1', { value: 'Bob & Alice', enumerable: true });
  const duplicateAuthorListResult = await analyzeBookImportRows([duplicateAuthorListColumns]);
  assert.ok(!issueCodes(duplicateAuthorListResult.rows[0]).has('conflicting_source_columns'));
  assert.deepStrictEqual(duplicateAuthorListResult.rows[0].book.authors, ['Alice', 'Bob']);

  const nonEquivalentAuthorColumns = { Titel: 'Auteur niet equivalent', 'ISBN-nummer': ISBN };
  Object.defineProperty(nonEquivalentAuthorColumns, 'Auteur', { value: 'Doe, John', enumerable: true });
  Object.defineProperty(nonEquivalentAuthorColumns, 'Auteur_1', { value: 'John Doe', enumerable: true });
  const nonEquivalentAuthorResult = await analyzeBookImportRows([nonEquivalentAuthorColumns]);
  assert.strictEqual(nonEquivalentAuthorResult.rows[0].status, 'conflict');
  assert.ok(issueCodes(nonEquivalentAuthorResult.rows[0]).has('conflicting_source_columns'));

  const equivalentLanguageColumns = { Titel: 'Taal equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentLanguageColumns, 'Taal', { value: 'Nederlands', enumerable: true });
  Object.defineProperty(equivalentLanguageColumns, 'Taal_1', { value: 'nl', enumerable: true });
  const equivalentLanguageResult = await analyzeBookImportRows([equivalentLanguageColumns]);
  assert.strictEqual(equivalentLanguageResult.rows[0].book.language, 'nl');
  assert.ok(!issueCodes(equivalentLanguageResult.rows[0]).has('conflicting_source_columns'));

  const equivalentYearColumns = { Titel: 'Jaar equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentYearColumns, 'Jaar', { value: '2020', enumerable: true });
  Object.defineProperty(equivalentYearColumns, 'Jaar_1', { value: '2020-05-03', enumerable: true });
  const equivalentYearResult = await analyzeBookImportRows([equivalentYearColumns]);
  assert.strictEqual(equivalentYearResult.rows[0].book.publishedYear, 2020);
  assert.ok(!issueCodes(equivalentYearResult.rows[0]).has('conflicting_source_columns'));

  const equivalentPageColumns = { Titel: 'Pagina equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentPageColumns, 'Paginas', { value: '0100', enumerable: true });
  Object.defineProperty(equivalentPageColumns, 'Paginas_1', { value: 100, enumerable: true });
  const equivalentPageResult = await analyzeBookImportRows([equivalentPageColumns]);
  assert.strictEqual(equivalentPageResult.rows[0].book.pageCount, 100);
  assert.ok(!issueCodes(equivalentPageResult.rows[0]).has('conflicting_source_columns'));

  const equivalentTagColumns = { Titel: 'Tag equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentTagColumns, 'Tags', { value: 'Fantasy; Magic', enumerable: true });
  Object.defineProperty(equivalentTagColumns, 'Tags_1', { value: 'magic, fantasy', enumerable: true });
  const equivalentTagResult = await analyzeBookImportRows([equivalentTagColumns]);
  assert.deepStrictEqual(equivalentTagResult.rows[0].book.tags, ['Fantasy', 'Magic']);
  assert.ok(!issueCodes(equivalentTagResult.rows[0]).has('conflicting_source_columns'));

  const equivalentClassColumns = { Titel: 'Klassen equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentClassColumns, 'Klassen', { value: '2A; 3B', enumerable: true });
  Object.defineProperty(equivalentClassColumns, 'Klassen_1', { value: '3B; 2A', enumerable: true });
  const equivalentClassResult = await analyzeBookImportRows([equivalentClassColumns]);
  assert.ok(!issueCodes(equivalentClassResult.rows[0]).has('conflicting_source_columns'));
  assert.deepStrictEqual(equivalentClassResult.rows[0].context.classContext, ['2A', '3B']);

  const coverUrlCaseConflict = { Titel: 'Cover hoofdletterconflict', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(coverUrlCaseConflict, 'Cover', { value: 'https://cdn.example/A.jpg', enumerable: true });
  Object.defineProperty(coverUrlCaseConflict, 'Cover_1', { value: 'https://cdn.example/a.jpg', enumerable: true });
  const coverUrlCaseConflictResult = await analyzeBookImportRows([coverUrlCaseConflict]);
  assert.strictEqual(coverUrlCaseConflictResult.rows[0].status, 'conflict');
  assert.ok(issueCodes(coverUrlCaseConflictResult.rows[0]).has('conflicting_source_columns'));

  const equivalentCoverUrlWhitespace = { Titel: 'Cover whitespace equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentCoverUrlWhitespace, 'Cover', { value: ' https://cdn.example/A.jpg ', enumerable: true });
  Object.defineProperty(equivalentCoverUrlWhitespace, 'Cover_1', { value: 'https://cdn.example/A.jpg', enumerable: true });
  const equivalentCoverUrlWhitespaceResult = await analyzeBookImportRows([equivalentCoverUrlWhitespace]);
  assert.strictEqual(equivalentCoverUrlWhitespaceResult.rows[0].book.coverUrl, 'https://cdn.example/A.jpg');
  assert.ok(!issueCodes(equivalentCoverUrlWhitespaceResult.rows[0]).has('conflicting_source_columns'));

  const equivalentEasyReadingColumns = { Titel: 'Makkelijk lezen equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentEasyReadingColumns, 'Makkelijk lezen?', { value: 'Ja', enumerable: true });
  Object.defineProperty(equivalentEasyReadingColumns, 'Makkelijk lezen?_1', { value: 'misschien', enumerable: true });
  const equivalentEasyReadingResult = await analyzeBookImportRows([equivalentEasyReadingColumns]);
  assert.strictEqual(equivalentEasyReadingResult.rows[0].book.easyReading, true);
  assert.ok(!issueCodes(equivalentEasyReadingResult.rows[0]).has('conflicting_source_columns'));
  assert.ok(issueCodes(equivalentEasyReadingResult.rows[0]).has('nonstandard_easy_reading_value'));

  const equivalentExamMaterialColumns = { Titel: 'Examenmateriaal equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentExamMaterialColumns, 'Examenmateriaal', { value: 'Nee', enumerable: true });
  Object.defineProperty(equivalentExamMaterialColumns, 'Examenmateriaal_1', { value: 'onbekend', enumerable: true });
  const equivalentExamMaterialResult = await analyzeBookImportRows([equivalentExamMaterialColumns]);
  assert.strictEqual(equivalentExamMaterialResult.rows[0].book.suitableForExamList, false);
  assert.ok(!issueCodes(equivalentExamMaterialResult.rows[0]).has('conflicting_source_columns'));
  assert.ok(issueCodes(equivalentExamMaterialResult.rows[0]).has('unexpected_exam_material_value'));

  const conflictingLanguageColumns = { Titel: 'Taal conflict', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(conflictingLanguageColumns, 'Taal', { value: 'Nederlands', enumerable: true });
  Object.defineProperty(conflictingLanguageColumns, 'Taal_1', { value: 'Engels', enumerable: true });
  const conflictingLanguageResult = await analyzeBookImportRows([conflictingLanguageColumns]);
  assert.strictEqual(conflictingLanguageResult.rows[0].status, 'conflict');
  assert.ok(issueCodes(conflictingLanguageResult.rows[0]).has('conflicting_source_columns'));

  const directWithPartialSplit = await analyzeBookImportRows([{
    Titel: 'Corroborerende auteur',
    Auteur: 'Carry Slee',
    'Achternaam schrijver': 'Slee',
    'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(directWithPartialSplit.rows[0].book.author, 'Carry Slee');
  assert.ok(!issueCodes(directWithPartialSplit.rows[0]).has('author_sources_differ'));

  const splitMatchesSecondDirectAuthor = await analyzeBookImportRows([{
    Titel: 'Tweede auteur bevestigd',
    Auteur: 'Alice A; Bob Jones',
    'Voornaam schrijver': 'Bob',
    'Achternaam schrijver': 'Jones',
    'ISBN-nummer': ISBN,
  }]);
  assert.deepStrictEqual(splitMatchesSecondDirectAuthor.rows[0].book.authors, ['Alice A', 'Bob Jones']);
  assert.ok(!issueCodes(splitMatchesSecondDirectAuthor.rows[0]).has('author_sources_differ'));
  assert.strictEqual(splitMatchesSecondDirectAuthor.groups.length, 1);

  const partialSplitMatchesSecondDirectAuthor = await analyzeBookImportRows([{
    Titel: 'Tweede auteur gedeeltelijk bevestigd',
    Auteur: 'Alice A; Bob Jones',
    'Achternaam schrijver': 'Jones',
    'ISBN-nummer': ISBN,
  }]);
  assert.deepStrictEqual(partialSplitMatchesSecondDirectAuthor.rows[0].book.authors, ['Alice A', 'Bob Jones']);
  assert.ok(!issueCodes(partialSplitMatchesSecondDirectAuthor.rows[0]).has('author_sources_differ'));

  const splitContradictsEveryDirectAuthor = await analyzeBookImportRows([{
    Titel: 'Geen auteur bevestigd',
    Auteur: 'Alice A; Bob Jones',
    'Voornaam schrijver': 'Charlie',
    'Achternaam schrijver': 'Else',
    'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(splitContradictsEveryDirectAuthor.rows[0].status, 'conflict');
  assert.ok(issueCodes(splitContradictsEveryDirectAuthor.rows[0]).has('author_sources_differ'));

  const directWithContradictingPartialSplit = await analyzeBookImportRows([{
    Titel: 'Tegenstrijdige auteur',
    Auteur: 'Paul van Loon',
    'Achternaam schrijver': 'Slee',
    'ISBN-nummer': ISBN,
  }]);
  assert.ok(issueCodes(directWithContradictingPartialSplit.rows[0]).has('author_sources_differ'));
  assert.strictEqual(directWithContradictingPartialSplit.rows[0].status, 'conflict');

  const fallbackBarcodeProvenance = await analyzeBookImportRows([{
    Titel: 'Barcode fallback', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Barcode: 'ABC', 'Barcode / ISBN': '12345',
  }]);
  assert.strictEqual(fallbackBarcodeProvenance.rows[0].book.barcode, '12345');
  assert.strictEqual(fallbackBarcodeProvenance.rows[0].provenance.barcode.source, 'excel');
  assert.strictEqual(fallbackBarcodeProvenance.rows[0].provenance.barcode.header, 'Barcode / ISBN');
  assert.strictEqual(fallbackBarcodeProvenance.rows[0].provenance.barcode.raw, '12345');

  const duplicateMetadataIsbnEvidence = { Titel: 'Metadata ISBN bron', Auteur: 'A Auteur' };
  Object.defineProperty(duplicateMetadataIsbnEvidence, 'Intern ISBN', { value: '978030640615', enumerable: true });
  Object.defineProperty(duplicateMetadataIsbnEvidence, 'Intern ISBN_1', { value: ISBN, enumerable: true });
  const duplicateMetadataIsbnResult = await analyzeBookImportRows([duplicateMetadataIsbnEvidence]);
  assert.strictEqual(duplicateMetadataIsbnResult.rows[0].book.metadataIsbn, ISBN);
  assert.strictEqual(duplicateMetadataIsbnResult.rows[0].provenance.metadataIsbn.header, 'Intern ISBN_1');
  assert.strictEqual(duplicateMetadataIsbnResult.rows[0].provenance.metadataIsbn.raw, ISBN);

  const blockedBarcodeEvidence = { Titel: 'Geblokkeerde barcodebron', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Barcode / ISBN': '789' };
  Object.defineProperty(blockedBarcodeEvidence, 'Barcode', { value: '789', enumerable: true });
  Object.defineProperty(blockedBarcodeEvidence, 'Barcode_1', { value: '456', enumerable: true });
  const blockedBarcodeResult = await analyzeBookImportRows([blockedBarcodeEvidence]);
  assert.strictEqual(blockedBarcodeResult.rows[0].book.barcode, '789');
  assert.strictEqual(blockedBarcodeResult.rows[0].provenance.barcode.header, 'Barcode / ISBN');
  assert.ok(issueCodes(blockedBarcodeResult.rows[0]).has('conflicting_source_columns'));

  const quantityProvenance = await analyzeBookImportRows([{
    Titel: 'Aantal bron', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Aantal exemplaren': '01',
  }]);
  assert.strictEqual(quantityProvenance.rows[0].book.quantity.value, 1);
  assert.deepStrictEqual(quantityProvenance.rows[0].provenance.quantity, {
    source: 'excel', header: 'Aantal exemplaren', raw: '01',
  });

  const equivalentQuantityColumns = { Titel: 'Aantal equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentQuantityColumns, 'Aantal', { value: '01', enumerable: true });
  Object.defineProperty(equivalentQuantityColumns, 'Aantal_1', { value: 1, enumerable: true });
  const equivalentQuantityResult = await analyzeBookImportRows([equivalentQuantityColumns]);
  assert.strictEqual(equivalentQuantityResult.rows[0].book.quantity.value, 1);
  assert.strictEqual(equivalentQuantityResult.rows[0].book.quantity.valid, true);
  assert.ok(!issueCodes(equivalentQuantityResult.rows[0]).has('conflicting_source_columns'));
  assert.strictEqual(equivalentQuantityResult.summary.physicalCopies, 1);
  assert.strictEqual(equivalentQuantityResult.groups.length, 1);

  const equivalentZeroQuantityColumns = { Titel: 'Aantal nul equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentZeroQuantityColumns, 'Aantal', { value: 0, enumerable: true });
  Object.defineProperty(equivalentZeroQuantityColumns, 'Aantal_1', { value: '00', enumerable: true });
  const equivalentZeroQuantityResult = await analyzeBookImportRows([equivalentZeroQuantityColumns]);
  assert.strictEqual(equivalentZeroQuantityResult.rows[0].book.quantity.value, 0);
  assert.strictEqual(equivalentZeroQuantityResult.rows[0].book.quantity.valid, true);
  assert.ok(!issueCodes(equivalentZeroQuantityResult.rows[0]).has('conflicting_source_columns'));
  assert.strictEqual(equivalentZeroQuantityResult.summary.physicalCopies, 0);

  const invalidQuantityLookalike = { Titel: 'Aantal ongeldig equivalent', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(invalidQuantityLookalike, 'Aantal', { value: '0x1', enumerable: true });
  Object.defineProperty(invalidQuantityLookalike, 'Aantal_1', { value: 1, enumerable: true });
  const invalidQuantityLookalikeResult = await analyzeBookImportRows([invalidQuantityLookalike]);
  assert.strictEqual(invalidQuantityLookalikeResult.rows[0].status, 'conflict');
  assert.strictEqual(invalidQuantityLookalikeResult.rows[0].book.quantity.blockedByConflict, true);
  assert.ok(issueCodes(invalidQuantityLookalikeResult.rows[0]).has('conflicting_source_columns'));
  assert.strictEqual(invalidQuantityLookalikeResult.summary.physicalCopies, 0);

  const customSuffixedHeader = await analyzeBookImportRows([{
    Titel: 'Custom ISBN kolom', Auteur: 'A Auteur', ISBN_2024: ISBN,
  }]);
  assert.strictEqual(customSuffixedHeader.rows[0].book.editionIsbn, '');
  assert.strictEqual(customSuffixedHeader.rows[0].status, 'unresolved');
  assert.ok(customSuffixedHeader.rows[0].unknownColumns.includes('ISBN_2024'));

  const customSuffixedBesideBase = await analyzeBookImportRows([{
    Titel: 'Custom ISBN naast echte ISBN', Auteur: 'A Auteur', ISBN, ISBN_2024: ISBN_ALT,
  }]);
  assert.strictEqual(customSuffixedBesideBase.rows[0].book.editionIsbn, ISBN);
  assert.ok(customSuffixedBesideBase.rows[0].unknownColumns.includes('ISBN_2024'));
  assert.ok(!issueCodes(customSuffixedBesideBase.rows[0]).has('conflicting_source_columns'));

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
  assert.strictEqual(duplicateRepairedIsbnResult.rows[0].provenance.editionIsbn.header, 'ISBN-nummer_1');

  const repairAndSuggestionEvidence = { Titel: 'Repair plus suggestie', Auteur: 'A Auteur' };
  Object.defineProperty(repairAndSuggestionEvidence, 'ISBN-nummer', { value: '306406152', enumerable: true });
  Object.defineProperty(repairAndSuggestionEvidence, 'ISBN-nummer_1', { value: '978030640615', enumerable: true });
  const repairAndSuggestionResult = await analyzeBookImportRows([repairAndSuggestionEvidence]);
  const repairIssues = repairAndSuggestionResult.rows[0].issues.filter((issue) => issue.code === 'isbn_repaired');
  const suggestionIssues = repairAndSuggestionResult.rows[0].issues.filter((issue) => issue.code === 'isbn_repair_suggested');
  assert.strictEqual(repairIssues.length, 1, 'One repaired source cell must produce one repair issue');
  assert.strictEqual(suggestionIssues.length, 1, 'The separate suggestion source must remain visible once');
  assert.strictEqual(repairIssues[0].header, 'ISBN-nummer');
  assert.strictEqual(suggestionIssues[0].header, 'ISBN-nummer_1');
  assert.strictEqual(repairAndSuggestionResult.summary.repairs, 1);
  assert.strictEqual(repairAndSuggestionResult.rows[0].book.editionIsbn, ISBN);

  const repairedExplicitWithExactLegacy = await analyzeBookImportRows([{
    Titel: 'Sterkste ISBN bron',
    Auteur: 'A Auteur',
    'ISBN-nummer': '306406152',
    'Intern ISBN': ISBN,
  }]);
  assert.strictEqual(repairedExplicitWithExactLegacy.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(repairedExplicitWithExactLegacy.rows[0].provenance.editionIsbn.header, 'Intern ISBN');
  assert.ok(issueCodes(repairedExplicitWithExactLegacy.rows[0]).has('isbn_repaired'));

  const duplicateRepairedMetadataEvidence = { Titel: 'Metadata reparatiebron', Auteur: 'A Auteur' };
  Object.defineProperty(duplicateRepairedMetadataEvidence, 'Intern ISBN', { value: '306406152', enumerable: true });
  Object.defineProperty(duplicateRepairedMetadataEvidence, 'Intern ISBN_1', { value: ISBN, enumerable: true });
  const duplicateRepairedMetadataResult = await analyzeBookImportRows([duplicateRepairedMetadataEvidence]);
  assert.strictEqual(duplicateRepairedMetadataResult.rows[0].book.metadataIsbn, ISBN);
  assert.strictEqual(duplicateRepairedMetadataResult.rows[0].provenance.metadataIsbn.header, 'Intern ISBN_1');
  assert.ok(issueCodes(duplicateRepairedMetadataResult.rows[0]).has('isbn_repaired'));

  const blockedExplicitWithLegacyFallback = { Titel: 'Geblokkeerd ISBN bewijs', Auteur: 'A Auteur', 'Intern ISBN': ISBN };
  Object.defineProperty(blockedExplicitWithLegacyFallback, 'ISBN-nummer', { value: ISBN, enumerable: true });
  Object.defineProperty(blockedExplicitWithLegacyFallback, 'ISBN-nummer_1', { value: ISBN_ALT, enumerable: true });
  const blockedExplicitWithLegacyResult = await analyzeBookImportRows([blockedExplicitWithLegacyFallback]);
  assert.strictEqual(blockedExplicitWithLegacyResult.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(blockedExplicitWithLegacyResult.rows[0].provenance.editionIsbn.header, 'Intern ISBN');
  assert.ok(issueCodes(blockedExplicitWithLegacyResult.rows[0]).has('conflicting_source_columns'));

  const conflictedFirstNames = { Titel: 'Conflicterende voornamen', 'Achternaam schrijver': 'Slee', 'ISBN-nummer': ISBN };
  Object.defineProperty(conflictedFirstNames, 'Voornaam schrijver', { value: 'Carry', enumerable: true });
  Object.defineProperty(conflictedFirstNames, 'Voornaam schrijver_1', { value: 'Carla', enumerable: true });
  const conflictedFirstNamesResult = await analyzeBookImportRows([conflictedFirstNames], {
    lookupIsbn: async () => ({
      title: 'Conflicterende voornamen',
      author: 'Carry Slee',
      barcode: ISBN,
      found: true,
      source: 'exact-after-name-conflict',
    }),
  });
  assert.strictEqual(conflictedFirstNamesResult.rows[0].book.author, 'Carry Slee');
  assert.deepStrictEqual(conflictedFirstNamesResult.rows[0].provenance.author.supplementedFrom.headers, ['Achternaam schrijver']);
  assert.strictEqual(conflictedFirstNamesResult.rows[0].provenance.author.supplementedFrom.incomplete, true);
  assert.ok(issueCodes(conflictedFirstNamesResult.rows[0]).has('conflicting_source_columns'));

  const commaOwnBookMarker = await analyzeBookImportRows([{
    Titel: 'Tag marker', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Tags: 'fiction, eigen boek',
  }]);
  assert.strictEqual(commaOwnBookMarker.rows[0].status, 'skipped');
  assert.strictEqual(commaOwnBookMarker.rows[0].context.excludeFromSchoolCollection, true);
  assert.deepStrictEqual(commaOwnBookMarker.rows[0].book.tags, ['fiction']);

  const commaFixedMarker = await analyzeBookImportRows([{
    Titel: 'Thema marker', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, "Thema's": 'fantasy, Klassenboek',
  }]);
  assert.strictEqual(commaFixedMarker.rows[0].context.fixedLocation.status, 'needs_review');
  assert.deepStrictEqual(commaFixedMarker.rows[0].book.themes, ['fantasy']);
  assert.strictEqual(commaFixedMarker.groups.length, 1);

  const commaAuthorMarker = await analyzeBookImportRows([{
    Titel: 'Auteurinterpunctie', Auteur: 'Doe, John, Klassenboek', 'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(commaAuthorMarker.rows[0].book.author, 'Doe, John');
  assert.deepStrictEqual(commaAuthorMarker.rows[0].book.authors, ['Doe, John']);
  assert.strictEqual(commaAuthorMarker.rows[0].context.fixedLocation.status, 'needs_review');

  const commaTitleMarker = await analyzeBookImportRows([{
    Titel: 'Titel, met komma, Klassenboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(commaTitleMarker.rows[0].book.title, 'Titel, met komma');
  assert.strictEqual(commaTitleMarker.rows[0].context.fixedLocation.status, 'needs_review');

  const semicolonAuthorMarker = await analyzeBookImportRows([{
    Titel: 'Meerdere auteurs', Auteur: 'Alice; Klassenboek; Bob', 'ISBN-nummer': ISBN,
  }]);
  assert.deepStrictEqual(semicolonAuthorMarker.rows[0].book.authors, ['Alice', 'Bob']);
  assert.strictEqual(semicolonAuthorMarker.rows[0].book.author, 'Alice & Bob');

  const mixedDelimiterAuthorMarker = await analyzeBookImportRows([{
    Titel: 'Gemengde auteurscheiding', Auteur: 'Alice, Klassenboek; Bob', 'ISBN-nummer': ISBN,
  }]);
  assert.deepStrictEqual(mixedDelimiterAuthorMarker.rows[0].book.authors, ['Alice', 'Bob']);
  assert.strictEqual(mixedDelimiterAuthorMarker.rows[0].book.author, 'Alice & Bob');

  const partialSplitAuthor = await analyzeBookImportRows([{
    Titel: 'Spijt!', 'Achternaam schrijver': 'Slee', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Spijt!', author: 'Carry Slee', barcode: ISBN, found: true, source: 'exact-author',
    }),
  });
  assert.strictEqual(partialSplitAuthor.rows[0].book.author, 'Carry Slee');
  assert.deepStrictEqual(partialSplitAuthor.rows[0].book.authors, ['Carry Slee']);
  assert.strictEqual(partialSplitAuthor.rows[0].provenance.author.source, 'metadata');
  assert.strictEqual(partialSplitAuthor.rows[0].provenance.author.detail, 'exact-author');
  assert.strictEqual(partialSplitAuthor.rows[0].provenance.author.supplementedFrom.derived, 'combined_name_parts');
  assert.strictEqual(partialSplitAuthor.rows[0].provenance.author.supplementedFrom.incomplete, true);
  assert.ok(!partialSplitAuthor.rows[0].issues.some((issue) => issue.code === 'metadata_differs_from_excel' && issue.field === 'author'));

  let partialOnlyLookupCalls = 0;
  const partialOnlyMissingAuthor = await analyzeBookImportRows([{
    Titel: 'Volledige metadata behalve voornaam',
    'Achternaam schrijver': 'Slee',
    'ISBN-nummer': ISBN,
    Uitgever: 'Bestaand',
    Jaar: 2020,
    Paginas: 100,
    Taal: 'nl',
    Cover: 'https://example.test/existing.jpg',
    Beschrijving: 'Bestaand',
    Tags: 'bestaand',
    "Thema's": 'bestaand',
  }], {
    lookupIsbn: async () => {
      partialOnlyLookupCalls += 1;
      return {
        title: 'Volledige metadata behalve voornaam',
        author: 'Carry Slee',
        barcode: ISBN,
        found: true,
        source: 'exact-author-only',
      };
    },
  });
  assert.strictEqual(partialOnlyLookupCalls, 1, 'Incomplete split author must itself trigger exact metadata enrichment');
  assert.strictEqual(partialOnlyMissingAuthor.rows[0].book.author, 'Carry Slee');

  const identifierlessExactPartialAuthor = await analyzeBookImportRows([{
    Titel: 'Identifierless exact auteur',
    'Achternaam schrijver': 'Slee',
    'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Identifierless exact auteur',
      author: 'Carry Slee',
      found: true,
      source: 'exact-without-identifier',
    }),
  });
  assert.strictEqual(identifierlessExactPartialAuthor.rows[0].book.author, 'Carry Slee');
  assert.strictEqual(identifierlessExactPartialAuthor.rows[0].provenance.author.source, 'metadata');
  assert.strictEqual(identifierlessExactPartialAuthor.rows[0].provenance.author.detail, 'exact-without-identifier');

  const duplicatedFirstNameOnly = { Titel: 'Dubbele voornaam', 'ISBN-nummer': ISBN };
  Object.defineProperty(duplicatedFirstNameOnly, 'Voornaam schrijver', { value: 'Carry', enumerable: true });
  Object.defineProperty(duplicatedFirstNameOnly, 'Voornaam schrijver_1', { value: 'Carry', enumerable: true });
  const duplicatedFirstNameOnlyResult = await analyzeBookImportRows([duplicatedFirstNameOnly], {
    lookupIsbn: async () => ({
      title: 'Dubbele voornaam',
      author: 'Carry Slee',
      barcode: ISBN,
      found: true,
      source: 'exact-duplicate-first',
    }),
  });
  assert.strictEqual(duplicatedFirstNameOnlyResult.rows[0].book.author, 'Carry Slee');
  assert.strictEqual(duplicatedFirstNameOnlyResult.rows[0].provenance.author.source, 'metadata');
  assert.strictEqual(duplicatedFirstNameOnlyResult.rows[0].provenance.author.supplementedFrom.incomplete, true);

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
  assert.deepStrictEqual(metadataReconciliation.rows[0].book.tags, ['exact']);
  assert.deepStrictEqual(metadataReconciliation.rows[0].book.themes, ['exact']);
  assert.strictEqual(metadataReconciliation.rows[0].provenance.publisher.source, 'metadata');
  assert.strictEqual(metadataReconciliation.rows[0].provenance.publisher.detail, 'exact-edition');
  assert.ok(!metadataReconciliation.rows[0].issues.some((issue) => issue.code === 'metadata_differs_from_excel' && issue.field === 'publisher'));

  const derivedStripWithMetadata = await analyzeBookImportRows([{
    Titel: 'Strip metadata', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Examenmateriaal: 'Strip',
  }], {
    lookupIsbn: async () => ({
      title: 'Strip metadata', author: 'A Auteur', barcode: ISBN, tags: ['avontuur'], found: true, source: 'exact-strip',
    }),
  });
  assert.deepStrictEqual(derivedStripWithMetadata.rows[0].book.tags, ['strip', 'avontuur']);
  assert.strictEqual(derivedStripWithMetadata.rows[0].provenance.tags.source, 'metadata');
  assert.strictEqual(derivedStripWithMetadata.rows[0].provenance.tags.includesDerivedValues, true);

  const oversizedUint8 = new Uint8Array(5);
  let copiedOversizedUint8 = false;
  const originalBufferFromForUint8 = Buffer.from;
  Buffer.from = function monitoredUint8BufferFrom(value, ...rest) {
    if (value === oversizedUint8) copiedOversizedUint8 = true;
    return originalBufferFromForUint8.call(Buffer, value, ...rest);
  };
  let oversizedUint8Result;
  try {
    oversizedUint8Result = readBookImportWorkbook({
      read: () => { throw new Error('must not parse oversized Uint8Array'); },
      utils: { sheet_to_json: () => [] },
    }, oversizedUint8, { maxBytes: 4 });
  } finally {
    Buffer.from = originalBufferFromForUint8;
  }
  assert.strictEqual(oversizedUint8Result.ok, false);
  assert.strictEqual(oversizedUint8Result.error, 'file_too_large');
  assert.strictEqual(oversizedUint8Result.byteLength, 5);
  assert.strictEqual(copiedOversizedUint8, false, 'Oversized Uint8Array must be rejected before Buffer.from copies it');

  const largeBacking = new Uint8Array(32);
  const boundedView = largeBacking.subarray(10, 12);
  let boundedViewBufferLength = 0;
  const boundedViewResult = readBookImportWorkbook({
    read(input) {
      boundedViewBufferLength = input.length;
      return { SheetNames: ['B'], Sheets: { B: {} } };
    },
    utils: { sheet_to_json: () => [{ Titel: 'Binnen limiet' }] },
  }, boundedView, { maxBytes: 2 });
  assert.strictEqual(boundedViewResult.ok, true);
  assert.strictEqual(boundedViewBufferLength, 2, 'Uint8Array limits must use the view byteLength, not the backing buffer size');

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

  let excessiveWhitespaceDecoded = false;
  const originalBufferFromForWhitespace = Buffer.from;
  Buffer.from = function monitoredWhitespaceBufferFrom(value, encoding, ...rest) {
    if (typeof value === 'string' && encoding === 'base64') excessiveWhitespaceDecoded = true;
    return originalBufferFromForWhitespace.call(Buffer, value, encoding, ...rest);
  };
  let excessiveWhitespaceResult;
  try {
    excessiveWhitespaceResult = readBookImportWorkbook({
      read: () => { throw new Error('excessive encoded overhead must not reach parser'); },
      utils: { sheet_to_json: () => [] },
    }, `AAAA${' '.repeat(2048)}AAAA`, { maxBytes: 6 });
  } finally {
    Buffer.from = originalBufferFromForWhitespace;
  }
  assert.strictEqual(excessiveWhitespaceResult.ok, false);
  assert.strictEqual(excessiveWhitespaceResult.error, 'file_too_large');
  assert.strictEqual(excessiveWhitespaceResult.reason, 'encoded_input_overhead');
  assert.strictEqual(excessiveWhitespaceDecoded, false, 'Excessive base64 whitespace must be rejected before decoding');

  const whitespaceBase64 = readBookImportWorkbook({
    read: () => { throw new Error('decoded input reached parser'); },
    utils: { sheet_to_json: () => [] },
  }, 'AAAA\n \tAAAA', { maxBytes: 6 });
  assert.strictEqual(whitespaceBase64.ok, false);
  assert.strictEqual(whitespaceBase64.error, 'invalid_workbook', 'Internal base64 whitespace must not inflate the pre-decode size estimate');
};
