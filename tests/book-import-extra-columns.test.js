'use strict';

const assert = require('node:assert/strict');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { mapImportRow } = require('../book-import-workbook');

(async () => {
  // Only explicitly recognized headers are interpreted. Notes and future
  // user-added columns are inert, even if they contain known semantic markers.
  const source = [
    {
      Titel: 'P.s. ik hou van je (p.s. i love you)',
      Auteur: 'Cecelia Ahren',
      'ISBN-nummer': 9789044611038,
      Kolom1: 'a gaat van de lijst',
      'Overige registratie': 'eigen boek',
      'Nieuwe kolom': 'Klassenboek',
    },
    {
      Titel: 'Toekomstig extra veld',
      Auteur: 'A Auteur',
      'ISBN-nummer': '9780306406157',
      Kolom1: 'n',
      'Vreemde toelichting': 'vast in de klas; eigen boek',
    },
    { Kolom1: 'a', 'Vrije notitie': 'gaat van de lijst' },
  ];
  const before = JSON.stringify(source);
  const mapping = mapImportRow(source[0]);
  assert.deepEqual(mapping.unknown, []);
  assert.equal(mapping.fields.title, source[0].Titel);
  const analysis = await analyzeBookImportRows(source);
  assert.equal(analysis.ok, true);
  assert.equal(analysis.rows.length, 3);
  assert.deepEqual(analysis.columns.unknown, []);

  for (const row of analysis.rows) {
    assert.deepEqual(row.unknownColumns, []);
    assert.ok(!row.issues.some(issue => issue.code === 'unknown_columns_present'));
    assert.equal(row.context.excludeFromSchoolCollection, undefined);
    assert.equal(row.context.fixedLocation, undefined);
    assert.equal(row.context.studentLoan, undefined);
    assert.equal(row.context.classLoan, undefined);
  }
  assert.equal(analysis.rows[0].status, 'ready');
  assert.equal(analysis.rows[0].book.editionIsbn, '9789044611038');
  assert.equal(analysis.rows[1].status, 'ready');
  assert.equal(analysis.rows[2].status, 'skipped',
    'A row with only unknown columns must not add a book');
  assert.equal(JSON.stringify(source), before, 'Original data must not be mutated');

  // A semantic marker in a recognized column keeps its existing meaning.
  const recognizedMarker = await analyzeBookImportRows([{
    Titel: 'Echt eigen boek',
    Auteur: 'A Auteur',
    'ISBN-nummer': '9780306406157',
    'naam leerling': 'eigen boek',
    Kolom1: 'a',
  }]);
  assert.equal(recognizedMarker.rows[0].status, 'skipped');
  assert.equal(recognizedMarker.rows[0].context.excludeFromSchoolCollection, true);

  console.log('Unrecognized Excel columns are completely ignored');
})().catch(error => { console.error(error); process.exitCode = 1; });
