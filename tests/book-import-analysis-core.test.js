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

  // Unified stock snapshots must group by worksheet row rather than
  // allocating one normalized object for every existing physical copy.
  const compactUnified = await analyzeBookImportRows([{
    Titel:'Voorraadgroep',Auteur:'A Auteur','ISBN-nummer':ISBN,Aantal:1000,
  }],{mode:'unified_sync',maxCopies:1500000});
  assert.equal(compactUnified.ok,true);
  assert.equal(compactUnified.summary.physicalCopies,1000);
  assert.equal(compactUnified.groups[0].copies.length,1,
    'One grouping representative prevents needless allocation of 1000 objects');

  // Actual school workbook row 111 uses a checksum-valid ISBN with
  // an incidental space. This is a safe formatting repair, not a manual
  // edition decision or an invitation to guess a missing check digit.
  const spaced=await analyzeBookImportRows([{
    Titel:'Verdwenen woorden',Auteur:'Monique de Heide',
    'ISBN-nummer':'978 9044834758',
  }]);
  assert.equal(spaced.ok,true);
  assert.equal(spaced.rows[0].book.editionIsbn,'9789044834758');
  assert.ok(codes(spaced.rows[0]).has('isbn_repaired'));
  assert.equal(spaced.summary.repairs,1);
  assert.equal(spaced.groups.length,1);
  assert.ok(!codes(spaced.rows[0]).has('invalid_or_unrecognized_isbn'));
  const wrongDigit=await analyzeBookImportRows([{
    Titel:'Verdwenen woorden',Auteur:'Monique de Heide',
    'ISBN-nummer':'978 9044834759',
  }]);
  assert.equal(wrongDigit.rows[0].book.editionIsbn,'');
  assert.ok(codes(wrongDigit.rows[0]).has('invalid_or_unrecognized_isbn'),
    'Formatting must never silently correct a wrong check digit');
  const notAnIsbn=await analyzeBookImportRows([{
    Titel:'Het achterhuis',Auteur:'Anne Frank',
    'ISBN-nummer':'871 0114001467',
  }]);
  assert.equal(notAnIsbn.rows[0].book.editionIsbn,'',
    'An EAN with valid checksum cannot be misidentified as an ISBN');

  // The same ISBN with punctuation/accent title variants is one
  // physical edition, not two conflicting books.
  const orthographicGroup=await analyzeBookImportRows([
    {Titel:'P.S. Ik hou van je',Auteur:'A Auteur','ISBN-nummer':ISBN,Aantal:1},
    {Titel:'PS Ik hou van je',Auteur:'A Auteur','ISBN-nummer':ISBN,Aantal:1},
  ],{mode:'unified_sync'});
  assert.equal(orthographicGroup.summary.editionConflicts,0);
  assert.equal(orthographicGroup.summary.editionGroups,1);
  assert.equal(orthographicGroup.rows[0].book.title,'P.S. Ik hou van je');
  assert.equal(orthographicGroup.rows[1].book.title,'PS Ik hou van je',
    'Grouping may not silently rewrite the teacher Excel value');
  const genuinelyDifferent=await analyzeBookImportRows([
    {Titel:'P.S. Ik hou van je',Auteur:'A Auteur','ISBN-nummer':ISBN},
    {Titel:'Een heel ander boek',Auteur:'A Auteur','ISBN-nummer':ISBN},
  ],{mode:'unified_sync'});
  assert.ok(genuinelyDifferent.summary.editionConflicts>0,
    'An unrelated title with the same ISBN must still be blocked');

  // Explicit Tags must survive independently of the derived strip label
  // introduced by Examenmateriaal: Strip.
  const mixedTags=await analyzeBookImportRows([{
    Titel:'Oorlogswinter',Auteur:'Jan Terlouw',
    'ISBN-nummer':ISBN,Tags:'avontuur',Examenmateriaal:'Strip',
  }],{mode:'unified_sync'});
  assert.equal(mixedTags.ok,true);
  assert.ok(mixedTags.rows[0].book.tags.includes('strip'));
  assert.deepStrictEqual(mixedTags.rows[0].provenance.tags.explicitValues,['avontuur']);
  assert.equal(mixedTags.rows[0].provenance.tags.includesDerivedValues,true);

  // Duplicate author columns can use a surname-first bibliographic
  // format or accents without implying another person. A substantive
  // mismatch stays a blocking conflict.
  const sameAuthor=await analyzeBookImportRows([{
    Titel:'Spijt!',Auteur:'Slee, Carry',
    'Voornaam schrijver':'Carry','Achternaam schrijver':'Slee',
    'ISBN-nummer':ISBN,
  }]);
  assert.ok(!codes(sameAuthor.rows[0]).has('author_sources_differ'));
  const accentAuthor=await analyzeBookImportRows([{
    Titel:'Spijt!',Auteur:'Carrý Slee',
    'Voornaam schrijver':'Carry','Achternaam schrijver':'Slee',
    'ISBN-nummer':ISBN,
  }]);
  assert.ok(!codes(accentAuthor.rows[0]).has('author_sources_differ'));
  const tinyAuthorTypo=await analyzeBookImportRows([{
    Titel:'Spijt!',Auteur:'Carrie Slee',
    'Voornaam schrijver':'Carry','Achternaam schrijver':'Slee',
    'ISBN-nummer':ISBN,
  }]);
  assert.ok(!codes(tinyAuthorTypo.rows[0]).has('author_sources_differ'),
    'One-letter author typos between two Excel columns do not justify manual review');
  const anotherAuthor=await analyzeBookImportRows([{
    Titel:'Spijt!',Auteur:'Ander Persoon',
    'Voornaam schrijver':'Carry','Achternaam schrijver':'Slee',
    'ISBN-nummer':ISBN,
  }]);
  assert.ok(codes(anotherAuthor.rows[0]).has('author_sources_differ'));

  // Student placeholders must not defeat the special Makkelijk Lezen
  // fixed-location rule, while genuine student names must still conflict.
  for (const placeholder of ['nvt', 'N.V.T.', 'niet van toepassing']) {
    const withPlaceholder = await analyzeBookImportRows([{
      Titel: 'Klasboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
      'Makkelijk lezen?': 'ja', 'Geleend door klas': 'StructuurBB',
      'naam leerling': placeholder,
    }]);
    const locationRow = withPlaceholder.rows[0];
    assert.deepStrictEqual(locationRow.context.fixedLocation, {
      status: 'resolved', label: 'SK BB', source: 'ml_class_loan_rule',
    });
    assert.ok(!codes(locationRow).has('multiple_loan_contexts'));
    assert.ok(!codes(locationRow).has('student_loan_unmatched'));
    assert.ok(!codes(locationRow).has('class_loan_unmatched'));
  }
  const realStudentWithClassLoan = await analyzeBookImportRows([{
    Titel: 'Geleend aan leerling', Auteur: 'A Auteur', 'ISBN-nummer': ISBN,
    'Makkelijk lezen?': 'ja', 'Geleend door klas': 'StructuurBB',
    'naam leerling': 'Lisa Leerling',
  }], { students: [{ id: 's1', name: 'Lisa Leerling' }] });
  assert.ok(!codes(realStudentWithClassLoan.rows[0]).has('multiple_loan_contexts'));
  assert.equal(realStudentWithClassLoan.rows[0].context.studentClassHint.label,'StructuurBB');
  assert.equal(realStudentWithClassLoan.rows[0].context.studentLoan.status,'unmatched',
    'No current class directory means the pupil loan cannot be guessed');
  assert.strictEqual(realStudentWithClassLoan.rows[0].context.fixedLocation, undefined);


  const semantics = await analyzeBookImportRows([
    { Titel: 'Schoolboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'eigen boek' },
    { Titel: 'Eigen boek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT },
    { Titel: 'Vast', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'vast in de klas', Klassen: '2A' },
    { Titel: 'Klascontext', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, Klassen: 'Ond BKT', 'Geleend door klas': 'Arbeid' },
    { Titel: 'Globaal eigen', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Klassen: 'eigen boek' },
    { Titel: 'Globaal vast', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT, 'Aanwezig bieb': 'Klassenboek' },
    { Titel: 'Onbekende kolom', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Notitie: 'eigen boek' },
    { Titel: 'Vast en geleend', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Klassen: '2A; vast in de klas', 'Geleend door klas': 'Arbeid' },
  ], { classes: [{ id: 'c1', name: 'Arbeid' }] });
  assert.strictEqual(semantics.rows[0].status, 'skipped');
  assert.strictEqual(semantics.rows[0].context.excludeFromSchoolCollection, true);
  assert.strictEqual(semantics.rows[1].book.title, '');
  assert.strictEqual(semantics.rows[1].status, 'skipped');
  assert.strictEqual(semantics.rows[1].context.excludeFromSchoolCollection, true);
  assert.ok(codes(semantics.rows[1]).has('own_book_excluded'));
  assert.strictEqual(semantics.rows[2].context.fixedLocation.status, 'needs_review');
  assert.ok(codes(semantics.rows[2]).has('fixed_location_needs_review'));
  assert.deepStrictEqual(semantics.rows[3].context.classContext, ['Ond BKT']);
  assert.strictEqual(semantics.rows[3].context.classLoan.status, 'matched');
  assert.ok(codes(semantics.rows[3]).has('class_context_needs_review'));
  assert.strictEqual(semantics.rows[4].status, 'skipped');
  assert.strictEqual(semantics.rows[5].context.fixedLocation.status, 'needs_review');
  assert.notStrictEqual(semantics.rows[6].status, 'skipped');
  assert.strictEqual(semantics.rows[6].context.excludeFromSchoolCollection, undefined);
  assert.ok(!codes(semantics.rows[6]).has('own_book_excluded'),
    'An unknown Notitie column may not mark a book as privately owned');
  assert.deepStrictEqual(semantics.rows[7].context.classContext, ['2A']);
  assert.strictEqual(semantics.rows[7].context.fixedLocation.label, '2A');
  assert.strictEqual(semantics.rows[7].context.classLoan.status, 'matched');

  const markerTitle = await analyzeBookImportRows([{
    Titel: 'Klassenboek', Auteur: 'A Auteur', 'ISBN-nummer': ISBN_ALT,
  }]);
  assert.strictEqual(markerTitle.rows[0].book.title, '');
  assert.strictEqual(markerTitle.rows[0].context.fixedLocation.status, 'needs_review');
  assert.ok(codes(markerTitle.rows[0]).has('fixed_location_needs_review'));
  assert.strictEqual(markerTitle.groups.length, 0);

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
