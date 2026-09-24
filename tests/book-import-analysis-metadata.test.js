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
const ISBN_THIRD = '9780061120084';
const codes = (row) => new Set(row.issues.map((issue) => issue.code));

module.exports = async function runMetadataTests() {
  const repaired = analyzeIdentifier('306406152');
  assert.strictEqual(repaired.canonical, ISBN);
  assert.strictEqual(repaired.repair.kind, 'leading_zero_restored');
  const missingCheck = analyzeIdentifier('978030640615');
  assert.strictEqual(missingCheck.canonical, '');
  assert.strictEqual(missingCheck.suggestion.canonical, ISBN);
  assert.strictEqual(analyzeIdentifier(true).unsupportedType, true);

  const invalidBoundary = analyzeIdentifier('978-03-0-640615-7');
  assert.strictEqual(invalidBoundary.canonical, '');
  assert.strictEqual(invalidBoundary.repair, null, 'Invalid official component boundaries must not be erased as formatting');
  assert.strictEqual(invalidBoundary.suggestion, null);
  const invalidBoundaryAndChecksum = analyzeIdentifier('978-03-0-640615-8');
  assert.strictEqual(invalidBoundaryAndChecksum.canonical, '');
  assert.strictEqual(invalidBoundaryAndChecksum.suggestion, null, 'Formatted invalid boundaries must not become arithmetic ISBN suggestions');

  assert.strictEqual(normalizeMetadataCandidate({ found: false, fields: { title: 'LEK', isbn13: ISBN } }), null);
  const candidate = normalizeMetadataCandidate({ fields: { title: 'Goed', editionIsbn: '', isbn13: ISBN, author: 'A Auteur' } });
  assert.strictEqual(candidate.editionIsbn, ISBN);
  assert.deepStrictEqual(metadataCandidatesFromResult({ found: false, candidates: [{ title: 'LEK', isbn13: ISBN }] }), []);

  const equivalentMetadataIdentifiers = normalizeMetadataCandidate({
    title: 'Zelfde editie bewijs',
    editionIsbn: ISBN,
    isbn: '0-306-40615-2',
    barcode: ISBN,
  });
  assert.strictEqual(equivalentMetadataIdentifiers.editionIsbn, ISBN);
  assert.deepStrictEqual(equivalentMetadataIdentifiers.identifierIsbns, [ISBN]);

  const conflictingMetadataIdentifiers = normalizeMetadataCandidate({
    title: 'Twee edities in één payload',
    author: 'A Auteur',
    editionIsbn: ISBN,
    barcode: ISBN_ALT,
  });
  assert.strictEqual(conflictingMetadataIdentifiers.editionIsbn, '');
  assert.deepStrictEqual(conflictingMetadataIdentifiers.identifierIsbns, [ISBN, ISBN_ALT].sort());

  const singularCommaAuthor = normalizeMetadataCandidate({
    title: 'Bibliografische auteur', author: 'Doe, John', isbn13: ISBN,
  });
  assert.deepStrictEqual(singularCommaAuthor.authors, ['Doe, John']);
  assert.strictEqual(singularCommaAuthor.author, 'Doe, John');

  const explicitCommaAuthors = normalizeMetadataCandidate({
    title: 'Expliciete auteurs', authors: ['Doe, John', 'Smith, Jane'], isbn13: ISBN,
  });
  assert.deepStrictEqual(explicitCommaAuthors.authors, ['Doe, John', 'Smith, Jane']);

  const delimitedSingularAuthors = normalizeMetadataCandidate({
    title: 'Delimited auteurs', author: 'Alice & Bob', isbn13: ISBN,
  });
  assert.deepStrictEqual(delimitedSingularAuthors.authors, ['Alice', 'Bob']);

  const strictRow = { title: 'Strict titel', author: 'A Auteur' };
  assert.strictEqual(strictMetadataMatch(strictRow, { title: 'Strict titel', author: 'A Auteur', authors: ['A Auteur'] }), true);
  assert.strictEqual(strictMetadataMatch(strictRow, { title: 'Strict titel extra', author: 'A Auteur', authors: ['A Auteur'] }), false);
  assert.strictEqual(strictMetadataMatch(strictRow, { title: 'Strict titel', author: 'A Auteur & B Auteur', authors: ['A Auteur', 'B Auteur'] }), false);
  assert.strictEqual(strictMetadataMatch(
    { title: 'Strict titel', author: 'A Auteur & B Auteur', authors: ['A Auteur', 'B Auteur'] },
    { title: 'Strict titel', author: 'B Auteur & A Auteur', authors: ['B Auteur', 'A Auteur'] },
  ), true);
  assert.strictEqual(strictMetadataMatch(
    { title: 'Strict titel', author: 'A Auteur & B Auteur', authors: ['A Auteur', 'B Auteur'] },
    { title: 'Strict titel', author: 'A Auteur', authors: ['A Auteur'] },
  ), false);
  const ambiguous = selectMetadataCandidate(strictRow, [
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', isbn13: ISBN }),
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', isbn13: ISBN_ALT }),
  ]);
  assert.strictEqual(ambiguous.conflict.code, 'ambiguous_metadata_editions');
  assert.strictEqual(selectIsbnMetadataCandidate(ISBN, [normalizeMetadataCandidate({ title: 'X', author: 'Y', isbn13: ISBN_ALT })]).conflict.code, 'ambiguous_isbn_lookup_results');

  const strictInternalIdentifierConflict = selectMetadataCandidate(strictRow, [
    normalizeMetadataCandidate({
      title: 'Strict titel', author: 'A Auteur', editionIsbn: ISBN, barcode: ISBN_ALT,
    }),
  ]);
  assert.strictEqual(strictInternalIdentifierConflict.candidate, null);
  assert.strictEqual(strictInternalIdentifierConflict.conflict.code, 'metadata_identifier_conflict');
  assert.deepStrictEqual(strictInternalIdentifierConflict.conflict.editionIsbns, [ISBN, ISBN_ALT].sort());

  const exactInternalIdentifierConflict = selectIsbnMetadataCandidate(ISBN, [
    normalizeMetadataCandidate({
      title: 'Strict titel', author: 'A Auteur', editionIsbn: ISBN, barcode: ISBN_ALT,
    }),
  ], strictRow);
  assert.strictEqual(exactInternalIdentifierConflict.candidate, null);
  assert.strictEqual(exactInternalIdentifierConflict.conflict.code, 'metadata_identifier_conflict');

  const exactWithUnrelatedConflictedNoise = selectIsbnMetadataCandidate(ISBN, [
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', editionIsbn: ISBN }),
    normalizeMetadataCandidate({
      title: 'Noise', author: 'Andere Auteur', editionIsbn: ISBN_ALT, barcode: ISBN_THIRD,
    }),
  ], strictRow);
  assert.strictEqual(exactWithUnrelatedConflictedNoise.conflict, null);
  assert.strictEqual(exactWithUnrelatedConflictedNoise.candidate.editionIsbn, ISBN);

  const preferEdition = selectMetadataCandidate(strictRow, [
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', isbn13: ISBN }),
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', publisher: 'Rijk', publishedYear: 2020, pageCount: 100, language: 'nl', description: 'Veel metadata' }),
  ]);
  assert.strictEqual(preferEdition.candidate.editionIsbn, ISBN);
  const preferExact = selectIsbnMetadataCandidate(ISBN, [
    normalizeMetadataCandidate({ title: 'X', author: 'Y', isbn13: ISBN }),
    normalizeMetadataCandidate({ title: 'X', author: 'Y', publisher: 'Rijk', publishedYear: 2020, pageCount: 100, language: 'nl', description: 'Veel metadata' }),
  ]);
  assert.strictEqual(preferExact.candidate.editionIsbn, ISBN);
  const rejectContradictingIdentifierless = selectIsbnMetadataCandidate(ISBN, [
    normalizeMetadataCandidate({ title: 'Ander boek', author: 'Andere Auteur', publisher: 'Fout' }),
  ], { title: 'Strict titel', author: 'A Auteur' });
  assert.strictEqual(rejectContradictingIdentifierless.candidate, null);

  const contradictoryExactWithTitleless = selectIsbnMetadataCandidate(ISBN, [
    normalizeMetadataCandidate({ title: 'Andere titel', author: 'A Auteur', isbn13: ISBN }),
    normalizeMetadataCandidate({ author: 'A Auteur', isbn13: ISBN, publisher: 'Mag niet winnen' }),
  ], { title: 'Strict titel', author: 'A Auteur' });
  assert.strictEqual(contradictoryExactWithTitleless.candidate, null);
  assert.strictEqual(contradictoryExactWithTitleless.conflict.code, 'metadata_title_conflict');
  assert.deepStrictEqual(contradictoryExactWithTitleless.conflict.titles, ['Andere titel']);

  const matchingExactWithTitleless = selectIsbnMetadataCandidate(ISBN, [
    normalizeMetadataCandidate({ title: 'Strict titel', author: 'A Auteur', isbn13: ISBN }),
    normalizeMetadataCandidate({ author: 'A Auteur', isbn13: ISBN, publisher: 'Rijke exacte bron' }),
  ], { title: 'Strict titel', author: 'A Auteur' });
  assert.strictEqual(matchingExactWithTitleless.conflict, null);
  assert.strictEqual(matchingExactWithTitleless.candidate.publisher, 'Rijke exacte bron');

  const resolved = await analyzeBookImportRows([{
    Titel: 'Metadata resolve', Auteur: 'A Auteur', 'ISBN-nummer': '978030640615',
  }], {
    lookupTitleAuthor: async () => ({ title: 'Metadata resolve', author: 'A Auteur', isbn13: ISBN, publisher: 'Uitgever', found: true, source: 'test' }),
  });
  assert.strictEqual(resolved.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(resolved.rows[0].book.publisher, 'Uitgever');
  assert.ok(codes(resolved.rows[0]).has('isbn_resolved_from_metadata'));

  const titleLookupExtraAuthor = await analyzeBookImportRows([{
    Titel: 'Gedeelde titel', Auteur: 'Alice',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Gedeelde titel',
      authors: ['Alice', 'Bob'],
      isbn13: ISBN,
      found: true,
      source: 'extra-author',
    }),
  });
  assert.strictEqual(titleLookupExtraAuthor.rows[0].book.editionIsbn, '');
  assert.strictEqual(titleLookupExtraAuthor.rows[0].status, 'unresolved');
  assert.ok(codes(titleLookupExtraAuthor.rows[0]).has('metadata_not_strict_match'));
  assert.strictEqual(titleLookupExtraAuthor.groups.length, 0);

  const titleLookupSameAuthorsDifferentOrder = await analyzeBookImportRows([{
    Titel: 'Samen exact', Auteur: 'Alice; Bob',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Samen exact',
      authors: ['Bob', 'Alice'],
      isbn13: ISBN,
      found: true,
      source: 'same-authors-reordered',
    }),
  });
  assert.strictEqual(titleLookupSameAuthorsDifferentOrder.rows[0].book.editionIsbn, ISBN);
  assert.ok(codes(titleLookupSameAuthorsDifferentOrder.rows[0]).has('isbn_resolved_from_metadata'));

  const exactPayloadIdentifierConflict = await analyzeBookImportRows([{
    Titel: 'Interne metadata botsing', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Interne metadata botsing',
      author: 'A Auteur',
      editionIsbn: ISBN,
      barcode: ISBN_ALT,
      publisher: 'Mag niet lekken',
      found: true,
      source: 'conflicting-exact',
    }),
  });
  assert.strictEqual(exactPayloadIdentifierConflict.rows[0].status, 'conflict');
  assert.ok(codes(exactPayloadIdentifierConflict.rows[0]).has('metadata_identifier_conflict'));
  assert.strictEqual(exactPayloadIdentifierConflict.rows[0].book.publisher, '');
  assert.strictEqual(exactPayloadIdentifierConflict.groups.length, 0);

  const titlePayloadIdentifierConflict = await analyzeBookImportRows([{
    Titel: 'Work metadata botsing', Auteur: 'A Auteur',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Work metadata botsing',
      author: 'A Auteur',
      editionIsbn: ISBN,
      barcode: ISBN_ALT,
      found: true,
      source: 'conflicting-work',
    }),
  });
  assert.strictEqual(titlePayloadIdentifierConflict.rows[0].status, 'conflict');
  assert.strictEqual(titlePayloadIdentifierConflict.rows[0].book.editionIsbn, '');
  assert.ok(codes(titlePayloadIdentifierConflict.rows[0]).has('metadata_identifier_conflict'));
  assert.strictEqual(titlePayloadIdentifierConflict.groups.length, 0);

  const suggestionConflict = await analyzeBookImportRows([{
    Titel: 'Metadata resolve', Auteur: 'A Auteur', 'ISBN-nummer': '978030640615',
  }], {
    lookupTitleAuthor: async () => ({ title: 'Metadata resolve', author: 'A Auteur', isbn13: ISBN_ALT, found: true, source: 'test' }),
  });
  assert.strictEqual(suggestionConflict.rows[0].book.editionIsbn, '');
  assert.strictEqual(suggestionConflict.rows[0].status, 'conflict');
  assert.ok(codes(suggestionConflict.rows[0]).has('metadata_isbn_conflicts_with_repair_suggestion'));

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
  const incompleteExact = await analyzeBookImportRows([{ Titel: 'Verrijk', Auteur: 'A Auteur', 'ISBN-nummer': ISBN }], {
    lookupIsbn: async () => ({
      title: 'Verrijk', author: 'A Auteur', isbn13: ISBN, publisher: 'P', publishedYear: 2020,
      pageCount: 123, language: 'nl', coverUrl: 'https://example.invalid/c.jpg', found: true,
    }),
    lookupTitleAuthor: async () => { titleLookups += 1; return { candidates: [
      { title: 'Verrijk', author: 'A Auteur', isbn13: ISBN },
      { title: 'Verrijk', author: 'A Auteur', isbn13: ISBN_ALT },
    ] }; },
  });
  assert.strictEqual(incompleteExact.rows[0].book.pageCount, 123);
  assert.strictEqual(incompleteExact.rows[0].book.publishedYear, 2020);
  assert.strictEqual(titleLookups, 0, 'Known edition ISBN must not fall back to a work-level title/author search');
  assert.ok(!codes(incompleteExact.rows[0]).has('ambiguous_metadata_editions'));

  const identifierlessWrongBook = await analyzeBookImportRows([{ Titel: 'Juist boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN }], {
    lookupIsbn: async () => ({ title: 'Ander boek', author: 'Andere Auteur', publisher: 'Verkeerd', found: true }),
  });
  assert.strictEqual(identifierlessWrongBook.rows[0].book.publisher, '');
  assert.ok(codes(identifierlessWrongBook.rows[0]).has('metadata_not_usable'));

  let exactLookupsAfterResolve = 0;
  const resolvedThenEnriched = await analyzeBookImportRows([{ Titel: 'Tweestaps', Auteur: 'A Auteur' }], {
    lookupTitleAuthor: async () => ({ title: 'Tweestaps', author: 'A Auteur', isbn13: ISBN, found: true, source: 'title' }),
    lookupIsbn: async () => {
      exactLookupsAfterResolve += 1;
      return { title: 'Tweestaps', author: 'A Auteur', isbn13: ISBN, description: 'Exact verrijkt', found: true, source: 'isbn' };
    },
  });
  assert.strictEqual(resolvedThenEnriched.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(resolvedThenEnriched.rows[0].book.description, 'Exact verrijkt');
  assert.strictEqual(exactLookupsAfterResolve, 1);

  const commaAuthorEnrichment = await analyzeBookImportRows([{
    Titel: 'Komma-auteur uit metadata', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      title: 'Komma-auteur uit metadata', author: 'Doe, John', isbn13: ISBN,
      found: true, source: 'exact-comma-author',
    }),
  });
  assert.strictEqual(commaAuthorEnrichment.rows[0].book.author, 'Doe, John');
  assert.deepStrictEqual(commaAuthorEnrichment.rows[0].book.authors, ['Doe, John']);

  let derivedStripExactCalls = 0;
  const derivedStripAcrossReconciliation = await analyzeBookImportRows([{
    Titel: 'Tweestaps strip', Auteur: 'A Auteur', Examenmateriaal: 'Strip',
  }], {
    lookupTitleAuthor: async () => ({
      title: 'Tweestaps strip', author: 'A Auteur', isbn13: ISBN,
      tags: ['werk-tag'], found: true, source: 'work-level-strip',
    }),
    lookupIsbn: async () => {
      derivedStripExactCalls += 1;
      return {
        title: 'Tweestaps strip', author: 'A Auteur', isbn13: ISBN,
        tags: ['exact-tag'], found: true, source: 'exact-strip',
      };
    },
  });
  assert.strictEqual(derivedStripExactCalls, 1);
  assert.deepStrictEqual(derivedStripAcrossReconciliation.rows[0].book.tags, ['strip', 'exact-tag']);
  assert.strictEqual(derivedStripAcrossReconciliation.rows[0].provenance.tags.source, 'metadata');
  assert.strictEqual(derivedStripAcrossReconciliation.rows[0].provenance.tags.detail, 'exact-strip');
  assert.strictEqual(derivedStripAcrossReconciliation.rows[0].provenance.tags.includesDerivedValues, true);
  assert.deepStrictEqual(derivedStripAcrossReconciliation.rows[0].provenance.tags.derivedValues, ['strip']);

  const titleConflict = await analyzeBookImportRows([{ Titel: 'Excel titel', Auteur: 'A Auteur', 'ISBN-nummer': ISBN }], {
    lookupIsbn: async () => ({ title: 'Andere titel', author: 'A Auteur', isbn13: ISBN, publisher: 'Mag niet lekken', found: true }),
  });
  assert.strictEqual(titleConflict.rows[0].status, 'conflict');
  assert.strictEqual(titleConflict.rows[0].book.publisher, '');
  assert.ok(codes(titleConflict.rows[0]).has('metadata_title_conflict'));

  const hiddenTitleConflict = await analyzeBookImportRows([{
    Titel: 'Correct', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
  }], {
    lookupIsbn: async () => ({
      source: 'same-isbn-mixed',
      candidates: [
        { title: 'Different', author: 'A Auteur', isbn13: ISBN, found: true },
        { author: 'A Auteur', isbn13: ISBN, publisher: 'Chosen', found: true },
      ],
    }),
  });
  assert.strictEqual(hiddenTitleConflict.rows[0].status, 'conflict');
  assert.strictEqual(hiddenTitleConflict.rows[0].book.publisher, '');
  assert.ok(codes(hiddenTitleConflict.rows[0]).has('metadata_title_conflict'));
  assert.strictEqual(hiddenTitleConflict.groups.length, 0);

  let collectionLookups = 0;
  const collectionEnrichment = await analyzeBookImportRows([{
    Titel: 'Collecties',
    Auteur: 'A Auteur',
    'ISBN-nummer': ISBN,
    Uitgever: 'P',
    Jaar: 2020,
    Paginas: 123,
    Taal: 'nl',
    'Cover URL': 'https://example.invalid/c.jpg',
    Beschrijving: 'D',
  }], {
    lookupIsbn: async () => {
      collectionLookups += 1;
      return {
        title: 'Collecties', author: 'A Auteur', isbn13: ISBN,
        tags: ['avontuur'], themes: ['vriendschap'], found: true, source: 'test',
      };
    },
  });
  assert.strictEqual(collectionLookups, 1, 'Missing enrichable collections should trigger exact ISBN metadata');
  assert.deepStrictEqual(collectionEnrichment.rows[0].book.tags, ['avontuur']);
  assert.deepStrictEqual(collectionEnrichment.rows[0].book.themes, ['vriendschap']);
  assert.strictEqual(collectionEnrichment.rows[0].provenance.tags.source, 'metadata');
  assert.strictEqual(collectionEnrichment.rows[0].provenance.themes.source, 'metadata');

  const invalidSupplied = await analyzeBookImportRows([{
    Titel: 'Bronwaarden',
    Auteur: 'A Auteur',
    'ISBN-nummer': ISBN,
    Uitgever: 'P',
    Jaar: 'twenty',
    Paginas: 'many',
    Taal: 'nl',
    'Cover URL': 'https://example.invalid/c.jpg',
    Beschrijving: 'D',
    Tags: 'bron-tag',
    "Thema's": 'bron-thema',
  }], {
    lookupIsbn: async () => ({
      title: 'Bronwaarden', author: 'A Auteur', isbn13: ISBN,
      publishedYear: 2020, pageCount: 123, found: true, source: 'test',
    }),
  });
  const invalidRow = invalidSupplied.rows[0];
  assert.strictEqual(invalidRow.book.publishedYear, null);
  assert.strictEqual(invalidRow.book.pageCount, null);
  assert.strictEqual(invalidRow.provenance.publishedYear.source, 'excel');
  assert.strictEqual(invalidRow.provenance.publishedYear.raw, 'twenty');
  assert.strictEqual(invalidRow.provenance.pageCount.source, 'excel');
  assert.strictEqual(invalidRow.provenance.pageCount.raw, 'many');
  assert.ok(codes(invalidRow).has('invalid_published_year'));
  assert.ok(codes(invalidRow).has('invalid_page_count'));
  const yearDifference = invalidRow.issues.find((issue) => issue.code === 'metadata_differs_from_excel' && issue.field === 'publishedYear');
  const pageDifference = invalidRow.issues.find((issue) => issue.code === 'metadata_differs_from_excel' && issue.field === 'pageCount');
  assert.strictEqual(yearDifference.excelValue, 'twenty');
  assert.strictEqual(yearDifference.metadataValue, 2020);
  assert.strictEqual(yearDifference.sourceInvalid, true);
  assert.strictEqual(pageDifference.excelValue, 'many');
  assert.strictEqual(pageDifference.metadataValue, 123);
  assert.strictEqual(pageDifference.sourceInvalid, true);

  const preserveExcel = await analyzeBookImportRows([{
    Titel: 'Excel titel', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Uitgever: 'Excel P', Tags: 'excel-tag',
  }], {
    lookupIsbn: async () => ({
      title: 'Excel titel', author: 'A Auteur', isbn13: ISBN, publisher: 'Metadata P', tags: ['metadata-tag'], found: true,
    }),
  });
  assert.strictEqual(preserveExcel.rows[0].book.title, 'Excel titel');
  assert.strictEqual(preserveExcel.rows[0].book.publisher, 'Excel P');
  assert.deepStrictEqual(preserveExcel.rows[0].book.tags, ['excel-tag']);
  assert.ok(codes(preserveExcel.rows[0]).has('metadata_differs_from_excel'));
};
