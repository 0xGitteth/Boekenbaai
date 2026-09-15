'use strict';

const assert = require('assert');
const XLSX = require('xlsx');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { readBookImportWorkbook } = require('../book-import-workbook');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';
const issueCodes = (row) => new Set(row.issues.map((issue) => issue.code));

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
      title: 'Samen geschreven', author: 'Alice, Bob', barcode: ISBN, found: true, source: 'title-author',
    }),
  });
  assert.strictEqual(multiAuthorMetadata.rows[0].book.editionIsbn, ISBN);
  assert.deepStrictEqual(multiAuthorMetadata.rows[0].book.authors, ['Alice', 'Bob']);
  assert.ok(issueCodes(multiAuthorMetadata.rows[0]).has('isbn_resolved_from_metadata'));

  const publishedAt = await analyzeBookImportRows([{
    Titel: 'Datumboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Datumboek', author: 'A Auteur', barcode: ISBN, publishedAt: '2019-10-02', found: true, source: 'openlibrary',
    }),
  });
  assert.strictEqual(publishedAt.rows[0].book.publishedYear, 2019);
  assert.strictEqual(publishedAt.rows[0].provenance.publishedYear.detail, 'openlibrary');

  const rows = [['Titel', 'Auteur', 'ISBN-nummer']];
  for (let index = 0; index < 100; index += 1) rows.push([`Boek ${index}`, 'A Auteur', ISBN]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Boeken');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

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
};
