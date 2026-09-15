'use strict';

const assert = require('assert');
const { analyzeBookImportRows } = require('../book-import-analysis');

const ISBN = '9780306406157';
const ISBN10 = '0306406152';
const ISBN_ALT = '9780439554930';
const codes = (row) => new Set(row.issues.map((issue) => issue.code));

module.exports = async function runCoreTests() {
  const real = await analyzeBookImportRows([{
    'Achternaam schrijver': 'Slee',
    'Voornaam schrijver': 'Carry',
    Titel: 'Spijt!',
    'ISBN-nummer': ISBN,
    Taal: 'Nederlands',
    'Makkelijk lezen?': 'x',
    Examenmateriaal: 'Ja',
    Klassen: '',
    'Geleend door klas': 'StructuurBB',
    'naam leerling': '',
  }]);
  assert.strictEqual(real.ok, true);
  const row = real.rows[0];
  assert.strictEqual(row.book.author, 'Carry Slee');
  assert.deepStrictEqual(row.book.authors, ['Carry Slee']);
  assert.strictEqual(row.book.editionIsbn, ISBN);
  assert.strictEqual(row.book.barcode, '');
  assert.strictEqual(row.book.language, 'nl');
  assert.strictEqual(row.book.easyReading, true);
  assert.strictEqual(row.book.suitableForExamList, true);
  assert.deepStrictEqual(row.context.fixedLocation, { status: 'resolved', label: 'SK BB', source: 'ml_class_loan_rule' });
  assert.strictEqual(row.provenance.editionIsbn.raw, ISBN);

  const semantics = await analyzeBookImportRows([
    { Titel: 'Schoolboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'eigen boek' },
    { Titel: 'Eigen boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT },
    { Titel: 'Vast', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'vast in de klas', Klassen: '2A' },
    { Titel: 'Klascontext', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, Klassen: 'Ond BKT', 'Geleend door klas': 'Arbeid' },
    { Titel: 'Globaal eigen', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Klassen: 'eigen boek' },
    { Titel: 'Globaal vast', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, 'Aanwezig bieb': 'Klassenboek' },
    { Titel: 'Onbekende kolom', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Notitie: 'eigen boek' },
    { Titel: 'Klassenboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT },
    { Titel: 'Vast en geleend', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Klassen: '2A; vast in de klas', 'Geleend door klas': 'Arbeid' },
  ], { classes: [{ id: 'c1', name: 'Arbeid' }] });
  assert.strictEqual(semantics.rows[0].status, 'skipped');
  assert.strictEqual(semantics.rows[0].context.excludeFromSchoolCollection, true);
  assert.strictEqual(semantics.rows[1].status, 'skipped');
  assert.strictEqual(semantics.rows[1].context.excludeFromSchoolCollection, true);
  assert.strictEqual(semantics.rows[2].context.fixedLocation.status, 'needs_review');
  assert.ok(codes(semantics.rows[2]).has('fixed_location_needs_review'));
  assert.deepStrictEqual(semantics.rows[3].context.classContext, ['Ond BKT']);
  assert.strictEqual(semantics.rows[3].context.classLoan.status, 'matched');
  assert.ok(codes(semantics.rows[3]).has('class_context_needs_review'));
  assert.strictEqual(semantics.rows[4].status, 'skipped');
  assert.strictEqual(semantics.rows[5].context.fixedLocation.status, 'needs_review');
  assert.strictEqual(semantics.rows[6].status, 'skipped');
  assert.strictEqual(semantics.rows[6].context.excludeFromSchoolCollection, true);
  assert.strictEqual(semantics.rows[7].book.title, '');
  assert.strictEqual(semantics.rows[7].context.fixedLocation.status, 'needs_review');
  assert.strictEqual(semantics.rows[7].status, 'unresolved');
  assert.deepStrictEqual(semantics.rows[8].context.classContext, ['2A']);
  assert.strictEqual(semantics.rows[8].context.fixedLocation.label, '2A');
  assert.strictEqual(semantics.rows[8].context.classLoan.status, 'matched');

  const duplicateMarker = { Titel: 'Dubbele klas', Auteur: 'A Auteur', 'ISBN-nummer': ISBN };
  Object.defineProperty(duplicateMarker, 'Klassen', { value: '2A', enumerable: true });
  Object.defineProperty(duplicateMarker, 'Klassen_1', { value: '2A; Klassenboek', enumerable: true });
  const duplicateMarkerResult = await analyzeBookImportRows([duplicateMarker]);
  assert.strictEqual(duplicateMarkerResult.rows[0].context.fixedLocation.label, '2A');
  assert.ok(!codes(duplicateMarkerResult.rows[0]).has('conflicting_source_columns'));

  const flags = await analyzeBookImportRows([
    { Titel: 'Strip', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Examenmateriaal: 'Strip' },
    { Titel: 'Engels', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, Examenmateriaal: 'Engels' },
    { Titel: 'Thema', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, "Thema's": 'Fantasy, Vriendschap', Keywords: 'magic, friendship' },
    { Titel: 'ML', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, 'Makkelijk lezen?': 'nee' },
  ]);
  assert.strictEqual(flags.rows[0].book.suitableForExamList, false);
  assert.strictEqual(flags.rows[0].book.formatHint, 'comic');
  assert.ok(flags.rows[0].book.tags.includes('strip'));
  assert.strictEqual(flags.rows[1].book.language, 'en');
  assert.strictEqual(flags.rows[1].book.suitableForExamList, false);
  assert.deepStrictEqual(flags.rows[2].book.manualThemes, ['Fantasy', 'Vriendschap']);
  assert.deepStrictEqual(flags.rows[2].book.themes, ['Fantasy', 'Vriendschap']);
  assert.deepStrictEqual(flags.rows[2].book.tags, ['magic', 'friendship']);
  assert.strictEqual(flags.rows[3].book.easyReading, true);
  assert.ok(codes(flags.rows[3]).has('nonstandard_easy_reading_value'));

  const placeholder = await analyzeBookImportRows([{
    Titel: 'Naamtest', Auteur: 'nvt', 'Voornaam schrijver': 'Carry', 'Achternaam schrijver': 'Slee', 'ISBN-nummer': ISBN,
  }]);
  assert.strictEqual(placeholder.rows[0].book.author, 'Carry Slee');
  assert.ok(!codes(placeholder.rows[0]).has('author_sources_differ'));

  const multipleAuthors = await analyzeBookImportRows([{
    Titel: 'Samen', Auteur: 'Carry Slee; Paul van Loon', 'ISBN-nummer': ISBN,
  }]);
  assert.deepStrictEqual(multipleAuthors.rows[0].book.authors, ['Carry Slee', 'Paul van Loon']);
  assert.strictEqual(multipleAuthors.rows[0].book.author, 'Carry Slee & Paul van Loon');

  const equivalent = { Titel: 'Equivalent', Auteur: 'A Auteur' };
  Object.defineProperty(equivalent, 'ISBN-nummer', { value: ISBN10, enumerable: true });
  Object.defineProperty(equivalent, 'ISBN-nummer_1', { value: ISBN, enumerable: true });
  const equivalentResult = await analyzeBookImportRows([equivalent]);
  assert.strictEqual(equivalentResult.rows[0].book.editionIsbn, ISBN);
  assert.ok(!codes(equivalentResult.rows[0]).has('conflicting_source_columns'));

  const fallback = await analyzeBookImportRows([{
    Titel: 'Fallback', Auteur: 'A Auteur', 'ISBN-nummer': 'bad', 'Intern ISBN': ISBN,
  }]);
  assert.strictEqual(fallback.rows[0].book.editionIsbn, ISBN);
  assert.ok(codes(fallback.rows[0]).has('invalid_or_unrecognized_isbn'));
  const invalidIssue = fallback.rows[0].issues.find((issue) => issue.code === 'invalid_or_unrecognized_isbn');
  assert.strictEqual(invalidIssue.field, 'isbn');
  assert.strictEqual(fallback.rows[0].provenance.editionIsbn.header, 'Intern ISBN');
  assert.strictEqual(fallback.rows[0].provenance.editionIsbn.raw, ISBN);

  const invalidLegacy = await analyzeBookImportRows([{
    Titel: 'Legacy fout', Auteur: 'A Auteur', 'Intern ISBN': 'legacy-bad',
  }]);
  assert.strictEqual(invalidLegacy.rows[0].book.editionIsbn, '');
  assert.strictEqual(invalidLegacy.rows[0].book.metadataIsbn, '');
  assert.strictEqual(invalidLegacy.rows[0].status, 'unresolved');
  assert.ok(codes(invalidLegacy.rows[0]).has('invalid_or_unrecognized_isbn'));
  assert.strictEqual(invalidLegacy.groups.length, 0, 'Unresolved new import rows must not use PR1 legacy grouping');

  const missingEdition = await analyzeBookImportRows([{ Titel: 'Geen editie', Auteur: 'A Auteur' }]);
  assert.strictEqual(missingEdition.rows[0].status, 'unresolved');
  assert.strictEqual(missingEdition.groups.length, 0);

  const conflicting = { Titel: 'Conflict', Auteur: 'A Auteur' };
  Object.defineProperty(conflicting, 'ISBN-nummer', { value: ISBN, enumerable: true });
  Object.defineProperty(conflicting, 'ISBN-nummer_1', { value: ISBN_ALT, enumerable: true });
  const conflictResult = await analyzeBookImportRows([conflicting]);
  assert.strictEqual(conflictResult.rows[0].status, 'conflict');
  assert.strictEqual(conflictResult.rows[0].book.editionIsbn, '');
  assert.ok(codes(conflictResult.rows[0]).has('conflicting_source_columns'));

  const groupedConflict = await analyzeBookImportRows([
    { Titel: 'Titel A', Auteur: 'A Auteur', 'ISBN-nummer': ISBN },
    { Titel: 'Titel B', Auteur: 'A Auteur', 'ISBN-nummer': ISBN },
  ]);
  assert.strictEqual(groupedConflict.conflicts.length, 1);
  assert.strictEqual(groupedConflict.conflicts[0].type, 'same_isbn_different_title');
  assert.strictEqual(groupedConflict.rows[0].status, 'conflict');
  assert.strictEqual(groupedConflict.rows[1].status, 'conflict');
  assert.ok(codes(groupedConflict.rows[0]).has('edition_identity_conflict'));
};
