'use strict';
const assert = require('assert');
const { analyzeReviewedImport, normalizeCorrections, applyCorrectionsToRows } = require('../book-import-review');

const ISBN = '9780306406157';
const OTHER_ISBN = '9780439554930';

(async () => {
  const original = [
    { Titel: 'Spijt!', Auteur: 'Carry Slee', 'ISBN-nummer': ISBN, Aantal: 2 },
    { Titel: 'Tweede titel', Auteur: 'Ander', 'ISBN-nummer': OTHER_ISBN },
  ];
  const baseline = await analyzeReviewedImport(original);
  assert.strictEqual(baseline.ok, true);
  assert.strictEqual(baseline.summary.physicalCopies, 3);
  assert.strictEqual(baseline.decisions.summary.readyToApply, true);
  assert.strictEqual(baseline.decisions.summary.safeRows, 2);
  assert.strictEqual(baseline.decisions.summary.blockedRows, 0);

  const corrected = await analyzeReviewedImport(original, [
    { index: 0, fields: { title: 'Spijt! (herzien)', author: 'C. Slee', quantity: '3' } },
    { index: 1, skip: true },
  ]);
  assert.strictEqual(corrected.ok, true);
  assert.strictEqual(corrected.rows[0].book.title, 'Spijt! (herzien)');
  assert.strictEqual(corrected.rows[0].book.author, 'C. Slee');
  assert.strictEqual(corrected.summary.physicalCopies, 3);
  assert.strictEqual(corrected.rows[1].status, 'skipped');
  assert.strictEqual(corrected.decisions.summary.safeRows, 1);
  assert.strictEqual(corrected.decisions.summary.skippedRows, 1);
  assert.strictEqual(original[0].Titel, 'Spijt!', 'Original Excel data must remain unchanged');
  assert.strictEqual(original[0].Aantal, 2);

  const conflicting = {
    Titel: 'Een titel', Auteur: 'Auteur', 'ISBN-nummer': ISBN, 'Intern ISBN': OTHER_ISBN,
  };
  const beforeFix = await analyzeReviewedImport([conflicting]);
  assert.strictEqual(beforeFix.rows[0].status, 'conflict');
  assert.strictEqual(beforeFix.decisions.summary.readyToApply, false);
  const afterFix = await analyzeReviewedImport([conflicting], [{ index: 0, fields: { editionIsbn: ISBN } }]);
  assert.strictEqual(afterFix.ok, true);
  assert.strictEqual(afterFix.rows[0].book.editionIsbn, ISBN);
  assert.notStrictEqual(afterFix.rows[0].status, 'conflict');
  assert.strictEqual(afterFix.decisions.summary.safeRows, 1);
  assert.strictEqual(conflicting['Intern ISBN'], OTHER_ISBN);

  const duplicateCollision = {
    Titel: 'Dubbel', Auteur: 'A', 'ISBN-nummer': ISBN, 'ISBN-nummer_1': OTHER_ISBN,
  };
  const correctedDuplicate = await analyzeReviewedImport([duplicateCollision],
    [{ index: 0, fields: { editionIsbn: ISBN } }]);
  assert.strictEqual(correctedDuplicate.rows[0].book.editionIsbn, ISBN);
  assert.ok(!correctedDuplicate.rows[0].issues.some((issue) => issue.code === 'conflicting_source_columns'));
  assert.strictEqual(correctedDuplicate.correctedRows[0]['ISBN-nummer_1'], undefined);

  const existing = await analyzeReviewedImport(original, [], {
    existingBooks: [{ id: 'old-1', title: 'Spijt!', metadataIsbn: ISBN, status: 'borrowed' }],
  });
  assert.strictEqual(existing.decisions.rows[0].reason, 'existing_edition_requires_review');
  assert.strictEqual(existing.decisions.rows[0].existing[0].borrowed, true);
  assert.strictEqual(existing.decisions.summary.readyToApply, false);
  assert.strictEqual(existing.decisions.rows[1].canCreate, true);

  // Existing copies can contain different ISBN identifiers from old/manual
  // imports; ANY matching valid ISBN must block a new edition.
  const multipleOldIdentifiers = await analyzeReviewedImport(original, [], {
    existingBooks: [{ id: 'legacy-mixed', title: 'Ander boek',
      editionIsbn: OTHER_ISBN, metadataIsbn: ISBN, barcode: '5501' }],
  });
  assert.strictEqual(multipleOldIdentifiers.decisions.rows[0].reason, 'existing_edition_requires_review');

  // Do not silently import a workbook's class and library presence fields as
  // plain available shelf stock, even when a user accepts generic warnings.
  for (const source of [
    { Titel: 'Klascontext', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Klassen: 'SK BB' },
    { Titel: 'Niet aanwezig', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, 'Aanwezig bieb': 'nee' },
  ]) {
    const contextReview = await analyzeReviewedImport([source], [], { acceptWarnings: true });
    assert.strictEqual(contextReview.ok, true);
    assert.strictEqual(contextReview.decisions.rows[0].reason, 'location_context_requires_followup');
    assert.strictEqual(contextReview.decisions.summary.readyToApply, false);
  }

  // A combined Barcode / ISBN column can carry an actual printed barcode.
  // Editing ONLY the damaged ISBN must not replace that physical label by
  // the automatic ISBN barcode fallback.
  const combinedBarcode = [{
    Titel: 'Gedrukt label', Auteur: 'A', 'ISBN-nummer': 'niet geldig',
    'Barcode / ISBN': '432198',
  }];
  const barcodeAfterIsbnFix = await analyzeReviewedImport(combinedBarcode,
    [{ index: 0, fields: { editionIsbn: ISBN } }], { acceptWarnings: true });
  assert.strictEqual(barcodeAfterIsbnFix.ok, true);
  assert.strictEqual(barcodeAfterIsbnFix.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(barcodeAfterIsbnFix.rows[0].book.barcode, '432198');
  assert.strictEqual(barcodeAfterIsbnFix.decisions.summary.readyToApply, true);
  assert.strictEqual(barcodeAfterIsbnFix.correctedRows[0]['Barcode / ISBN'], '432198');

  // And in the opposite direction: correcting the physical barcode must
  // preserve an edition ISBN that came from the same combined source.
  const combinedIsbn = [{
    Titel: 'ISBN in samenvoegkolom', Auteur: 'A', Barcode: 'niet geldig',
    'Barcode / ISBN': ISBN,
  }];
  const isbnAfterBarcodeFix = await analyzeReviewedImport(combinedIsbn,
    [{ index: 0, fields: { barcode: '998877' } }], { acceptWarnings: true });
  assert.strictEqual(isbnAfterBarcodeFix.ok, true);
  assert.strictEqual(isbnAfterBarcodeFix.rows[0].book.editionIsbn, ISBN);
  assert.strictEqual(isbnAfterBarcodeFix.rows[0].book.barcode, '998877');
  assert.strictEqual(isbnAfterBarcodeFix.decisions.summary.readyToApply, true);
  assert.strictEqual(isbnAfterBarcodeFix.correctedRows[0]['Barcode / ISBN'], ISBN);

  const existingBarcodeRow = [{
    Titel: 'Nieuwe editie', Auteur: 'A', 'ISBN-nummer': ISBN, Barcode: '7654321',
  }];
  const existingBarcode = [{ id: 'existing-other', title: 'Ander boek',
    metadataIsbn: OTHER_ISBN, barcode: '7654321' }];
  const barcodeConflict = await analyzeReviewedImport(existingBarcodeRow, [],
    { existingBooks: existingBarcode, acceptWarnings: true });
  assert.strictEqual(barcodeConflict.ok, true);
  assert.strictEqual(barcodeConflict.decisions.rows[0].reason, 'existing_physical_barcode_requires_correction');
  assert.strictEqual(barcodeConflict.decisions.summary.readyToApply, false);
  const noBarcodeConflict = await analyzeReviewedImport(existingBarcodeRow,
    [{ index: 0, fields: { barcode: '4567890' } }],
    { existingBooks: existingBarcode, acceptWarnings: true });
  assert.strictEqual(noBarcodeConflict.decisions.summary.readyToApply, true);

  const warningRow = [{ Titel: 'Waarschuwing', Auteur: 'Auteur', 'ISBN-nummer': ISBN, 'Onbekende kolom': 'tekst' }];
  const unapproved = await analyzeReviewedImport(warningRow);
  assert.strictEqual(unapproved.rows[0].status, 'warning');
  assert.strictEqual(unapproved.decisions.rows[0].reason, 'warnings_need_confirmation');
  const approved = await analyzeReviewedImport(warningRow, [], { acceptWarnings: true });
  assert.strictEqual(approved.decisions.rows[0].canCreate, true);

  const invalid = [
    [{ index: -1, fields: { title: 'X' } }],
    [{ index: 0, fields: { passwordHash: 'x' } }],
    [{ index: 0, fields: { editionIsbn: 'invalid' } }],
    [{ index: 0, fields: { quantity: '0' } }],
    [{ index: 0, fields: { title: 'x' } }, { index: 0, skip: true }],
    [{ index: 0, skip: true, fields: { title: 'x' } }],
    [{ index: 0, skip: false }],
  ];
  for (const corrections of invalid) {
    assert.strictEqual(normalizeCorrections(corrections, original.length).ok, false);
  }

  const skipped = applyCorrectionsToRows(original, new Map([[0, { skip: true, fields: {} }]]));
  assert.strictEqual(Object.keys(skipped[0]).length, 0);
  assert.strictEqual(original[0].Titel, 'Spijt!');

  console.log('PR3 book import review correction tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
