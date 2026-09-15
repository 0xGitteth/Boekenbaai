'use strict';

const assert = require('assert');
const { analyzeBookImportRows } = require('../book-import-analysis');

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
};
