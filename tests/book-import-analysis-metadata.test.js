'use strict';

const assert = require('assert');
const {
  analyzeIdentifier,
  normalizeMetadataCandidate,
  metadataCandidatesFromResult,
  strictMetadataMatch,
  selectMetadataCandidate,
  selectIsbnMetadataCandidate,
  analyzeBookImportRows,
} = require('../book-import-analysis');

const ISBN = '9780306406157';
const ISBN_ALT = '9780439554930';
const codes = (row) => new Set(row.issues.map((issue) => issue.code));

module.exports = async function runMetadataTests() {
  const repaired = analyzeIdentifier('306406152');
  assert.strictEqual(repaired.canonical, ISBN);
  assert.strictEqual(repaired.repair.kind, 'leading_zero_restored');
  const missingCheck = analyzeIdentifier('978030640615');
  assert.strictEqual(missingCheck.canonical, '');
  assert.strictEqual(missingCheck.suggestion.canonical, ISBN);
  assert.strictEqual(analyzeIdentifier(true).unsupportedType, true);

  assert.strictEqual(normalizeMetadataCandidate({ found: false, fields: { title: 'LEK', isbn13: ISBN } }), null);
  const candidate = normalizeMetadataCandidate({ fields: { title: 'Goed', editionIsbn: '', isbn13: ISBN, author: 'A Auteur' } });
  assert.strictEqual(candidate.editionIsbn, ISBN);
  assert.deepStrictEqual(metadataCandidatesFromResult({ found: false, candidates: [{ title: 'LEK', isbn13: ISBN }] }), []);

  const strictRow = { title: 'Strict titel', author: 'A Auteur' };
  assert.strictEqual(strictMetadataMatch(strictRow, { title: 'Strict titel', author: 'A Auteur', authors: ['A Auteur'] }), true);
  assert.strictEqual(strictMetadataMatch(strictRow, { title: 'Strict titel extra', author: 'A Auteur', authors: ['A Auteur'] }), false);
  const ambiguous = selectMetadataCandidate(strictRow, [
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', isbn13: ISBN }),
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', isbn13: ISBN_ALT }),
  ]);
  assert.strictEqual(ambiguous.conflict.code, 'ambiguous_metadata_editions');
  assert.strictEqual(selectIsbnMetadataCandidate(ISBN, [normalizeMetadataCandidate({ title: 'X', author: 'Y', isbn13: ISBN_ALT })]).conflict.code, 'ambiguous_isbn_lookup_results');

  const resolved = await analyzeBookImportRows([{
    Titel: 'Metadata resolve', Auteur: 'A Auteur', 'ISBN-nummer': '978030640615',
  }], {
    lookupTitleAuthor: async () => ({ title: 'Metadata resolve', author: 'A Auteur', isbn13: ISBN, publisher: 'Uitgever', found: true, source: 'test' }),
  });
  assert.strictEqual(resolved.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(resolved.rows[0].book.publisher, 'Uitgever');
  assert.ok(codes(resolved.rows[0]).has('isbn_resolved_from_metadata'));

  const wrongAuthor = await analyzeBookImportRows([{ Titel: 'Strict titel', Auteur: 'Juiste Auteur' }], {
    lookupTitleAuthor: async () => ({ title: 'Strict titel', author: 'Andere Auteur', isbn13: ISBN, found: true }),
  });
  assert.strictEqual(wrongAuthor.rows[0].book.editionIsbn, '');
  assert.ok(codes(wrongAuthor.rows[0]).has('metadata_not_strict_match'));

  const multi = await analyzeBookImportRows([{ Titel: 'Ambigue metadata', Auteur: 'A Auteur' }], {
    lookupTitleAuthor: async () => ({ candidates: [
      { title: 'Ambigue metadata', author: 'A Auteur', isbn13: ISBN, found: true },
      { title: 'Ambigue metadata', author: 'A Auteur', isbn13: ISBN_ALT, found: true },
    ] }),
  });
  assert.strictEqual(multi.rows[0].status, 'conflict');
  assert.ok(codes(multi.rows[0]).has('ambiguous_metadata_editions'));

  let titleLookups = 0;
  const complete = await analyzeBookImportRows([{ Titel: 'Verrijk', Auteur: 'A Auteur', 'ISBN-nummer': ISBN }], {
    lookupIsbn: async () => ({
      title: 'Verrijk', author: 'A Auteur', isbn13: ISBN, publisher: 'P', publishedYear: 2020,
      pageCount: 123, language: 'nl', coverUrl: 'https://example.invalid/c.jpg', description: 'D', found: true,
    }),
    lookupTitleAuthor: async () => { titleLookups += 1; return null; },
  });
  assert.strictEqual(complete.rows[0].book.pageCount, 123);
  assert.strictEqual(complete.rows[0].book.publishedYear, 2020);
  assert.strictEqual(titleLookups, 0, 'Exact ISBN metadata should prevent redundant title/author lookup when complete');

  const preserveExcel = await analyzeBookImportRows([{ Titel: 'Excel titel', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Uitgever: 'Excel P' }], {
    lookupIsbn: async () => ({ title: 'Andere titel', author: 'A Auteur', isbn13: ISBN, publisher: 'Metadata P', found: true }),
  });
  assert.strictEqual(preserveExcel.rows[0].book.title, 'Excel titel');
  assert.strictEqual(preserveExcel.rows[0].book.publisher, 'Excel P');
  assert.ok(codes(preserveExcel.rows[0]).has('metadata_differs_from_excel'));
};
