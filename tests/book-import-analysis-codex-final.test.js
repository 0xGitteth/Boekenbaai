'use strict';

const assert = require('assert');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { readBookImportWorkbook } = require('../book-import-workbook');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';
const issueCodes = (row) => new Set(row.issues.map((issue) => issue.code));

module.exports = async function runCodexFinalTests() {
  let workbookReads = 0;
  const whitespaceBase64 = readBookImportWorkbook({
    read: (buffer) => {
      workbookReads += 1;
      assert.strictEqual(buffer.toString('utf8'), 'ABCD');
      return { SheetNames: ['Sheet1'], Sheets: { Sheet1: { '!ref': 'A1:A2' } } };
    },
    utils: {
      sheet_to_json: () => [{ Titel: 'Test' }],
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }),
    },
  }, 'Q U J D R A = =', { maxBytes: 4, maxRows: 2 });
  assert.strictEqual(whitespaceBase64.ok, true);
  assert.strictEqual(workbookReads, 1);

  const equivalentBarcodeColumns = { Titel: 'Barcode', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(equivalentBarcodeColumns, 'Barcode', { value: '123-456', enumerable: true });
  Object.defineProperty(equivalentBarcodeColumns, 'Barcode_1', { value: '123456', enumerable: true });
  const barcodeResult = await analyzeBookImportRows([equivalentBarcodeColumns]);
  assert.strictEqual(barcodeResult.rows[0].book.barcode, '123456');
  assert.ok(!issueCodes(barcodeResult.rows[0]).has('conflicting_source_columns'));
  assert.notStrictEqual(barcodeResult.rows[0].status, 'conflict');

  const authorResult = await analyzeBookImportRows([{
    Titel: 'Auteurbron',
    Auteur: 'nvt',
    'Voornaam schrijver': 'Alice',
    'Achternaam schrijver': 'Auteur',
    'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(authorResult.rows[0].book.author, 'Alice Auteur');
  assert.strictEqual(authorResult.rows[0].provenance.author.source, 'excel');
  assert.strictEqual(authorResult.rows[0].provenance.author.derived, 'combined_name_parts');
  assert.deepStrictEqual(authorResult.rows[0].provenance.author.headers, ['Voornaam schrijver', 'Achternaam schrijver']);
  assert.ok(!Object.prototype.hasOwnProperty.call(authorResult.rows[0].provenance.author, 'raw'));

  const mismatchedLookup = await analyzeBookImportRows([{
    Titel: 'Identiteit', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      source: 'mismatch',
      candidates: [{ title: 'Identiteit', author: 'A Auteur', barcode: ISBN_ALT, publisher: 'Andere editie' }],
    }),
  });
  assert.strictEqual(mismatchedLookup.rows[0].status, 'conflict');
  assert.ok(issueCodes(mismatchedLookup.rows[0]).has('ambiguous_isbn_lookup_results'));
  assert.strictEqual(mismatchedLookup.groups.length, 0);

  const unsupportedIdentifier = await analyzeBookImportRows([{
    Titel: 'Fallback', Auteur: 'A Auteur', 'ISBN-nummer': true, 'Intern ISBN': ISBN,
  }]);
  assert.strictEqual(unsupportedIdentifier.rows[0].status, 'conflict');
  assert.ok(issueCodes(unsupportedIdentifier.rows[0]).has('unsupported_identifier_type'));
  assert.strictEqual(unsupportedIdentifier.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(unsupportedIdentifier.groups.length, 0);

  let exactCalls = 0;
  const reconciledMetadata = await analyzeBookImportRows([{
    Titel: 'Werk', Auteur: 'A Auteur',
  }], {
    lookupTitleAuthor: async () => ({
      source: 'work-level',
      candidates: [{
        title: 'Werk',
        author: 'A Auteur',
        isbn: ISBN,
        publisher: 'Work-level',
        publishedYear: 2020,
        pageCount: 100,
        language: 'nl',
        coverUrl: 'https://example.test/work.jpg',
        description: 'work',
        tags: ['work'],
        themes: ['work'],
      }],
    }),
    lookupIsbn: async () => {
      exactCalls += 1;
      return {
        source: 'exact-edition',
        candidates: [{
          title: 'Werk',
          author: 'A Auteur',
          barcode: ISBN,
          publisher: 'Exact-edition',
          publishedYear: 2021,
          pageCount: 110,
          language: 'nl',
          coverUrl: 'https://example.test/exact.jpg',
          description: 'exact',
          tags: ['exact'],
          themes: ['exact'],
        }],
      };
    },
  });
  assert.strictEqual(exactCalls, 1, 'A newly resolved ISBN must trigger exact lookup even after complete work-level metadata');
  assert.strictEqual(reconciledMetadata.rows[0].book.publisher, 'Exact-edition');
  assert.strictEqual(reconciledMetadata.rows[0].provenance.publisher.source, 'metadata');
  assert.strictEqual(reconciledMetadata.rows[0].provenance.publisher.detail, 'exact-edition');
  assert.strictEqual(reconciledMetadata.rows[0].book.publishedYear, 2021);
  assert.strictEqual(reconciledMetadata.rows[0].book.pageCount, 110);
  assert.strictEqual(reconciledMetadata.rows[0].book.description, 'exact');
  assert.deepStrictEqual(reconciledMetadata.rows[0].book.themes, ['exact']);
  assert.deepStrictEqual(reconciledMetadata.rows[0].book.tags, ['work', 'exact']);
  assert.ok(!reconciledMetadata.rows[0].issues.some((issue) => issue.code === 'metadata_differs_from_excel' && issue.field === 'publisher'));
};
