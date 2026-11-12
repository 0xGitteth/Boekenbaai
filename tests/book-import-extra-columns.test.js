'use strict';

const assert = require('node:assert/strict');
const { analyzeBookImportRows } = require('../book-import-analysis');

(async () => {
  // The real school workbook contains Kolom1 with unexplained a/n values.
  // A future unknown column must be treated equally, without inferring
  // loans, locations, book status or book metadata from those values.
  const source = [{
    'Titel': 'P.s. ik hou van je (p.s. i love you)',
    'Auteur': 'Cecelia Ahren',
    'ISBN-nummer': 9789044611038,
    Kolom1: 'a',
    'Overige registratie': 'n',
  }];
  const original = JSON.stringify(source);
  const analysis = await analyzeBookImportRows(source);
  assert.equal(analysis.ok, true);
  assert.equal(analysis.rows.length, 1);
  const row = analysis.rows[0];
  assert.equal(row.status, 'ready',
    'Extra columns alone must not make a valid book a warning');
  assert.equal(row.book.editionIsbn, '9789044611038');
  assert.equal(row.context.studentLoan, undefined);
  assert.equal(row.context.classLoan, undefined);
  assert.equal(row.context.fixedLocation, undefined);
  const extra = row.issues.find(issue => issue.code === 'unknown_columns_present');
  assert.equal(extra.severity, 'info');
  assert.deepEqual(extra.values, [
    { header: 'Kolom1', value: 'a' },
    { header: 'Overige registratie', value: 'n' },
  ]);
  assert.deepEqual(analysis.columns.unknown,
    ['Kolom1', 'Overige registratie']);
  assert.equal(JSON.stringify(source), original,
    'The imported Excel values must never be modified');

  console.log('Extra Excel columns are preserved for review without inferred meaning or blocking warnings');
})().catch(error => { console.error(error); process.exitCode = 1; });
