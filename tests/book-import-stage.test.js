'use strict';
const assert = require('assert');
const { createImportStageStore, buildStageApplyPlan } = require('../book-import-stage');
const { analyzeReviewedImport } = require('../book-import-review');

const ISBN = '9780306406157';
const ISBN2 = '9780439554930';

(async () => {
  let clock = 100000;
  let counter = 0;
  const store = createImportStageStore({ now: () => clock, createId: () => 'stage-' + (++counter), ttlMs: 1000 });
  const rows = [{ Titel: 'Nieuw', Auteur: 'Auteur', 'ISBN-nummer': ISBN, Barcode: '12345' }];
  const review = await analyzeReviewedImport(rows);
  const created = store.create({ ownerId: 'admin-1', sourceRows: rows, analysis: review, workbook: { sheetName: 'Boeken' } });
  assert.strictEqual(created.ok, true);
  const stage = created.stage;
  assert.strictEqual(store.get(stage.id, 'admin-2'), null, 'other admins must not see owner-only draft stages');
  assert.strictEqual(store.get(stage.id, 'admin-1'), stage);
  assert.strictEqual(store.beginReview(stage, 0).error, 'stale_review');
  assert.strictEqual(store.beginReview(stage, 1).ok, true);
  assert.strictEqual(store.beginReview(stage, 1).error, 'stage_busy_or_closed');
  assert.strictEqual(store.beginApply(stage, 1).error, 'stage_busy_or_closed');
  store.abortReview(stage);
  assert.strictEqual(store.beginReview(stage, 1).ok, true);
  store.finishReview(stage, review, [], false);
  assert.strictEqual(stage.revision, 2);
  assert.strictEqual(store.beginApply(stage, 1).error, 'stale_review');
  assert.strictEqual(store.beginApply(stage, 2).ok, true);
  assert.strictEqual(store.beginApply(stage, 2).error, 'stage_busy_or_closed');
  store.finishApply(stage, { created: 1 });
  assert.strictEqual(stage.sourceRows, null);
  assert.strictEqual(store.beginApply(stage, 2).error, 'stage_busy_or_closed');
  clock += 1001;
  assert.strictEqual(store.get(stage.id, 'admin-1'), null, 'expired drafts must be purged');

  const empty = await analyzeReviewedImport([{ Titel: 'Nieuw', Auteur: 'Auteur', 'ISBN-nummer': ISBN }]);
  assert.strictEqual(buildStageApplyPlan({ ...empty, acceptWarnings: false }, []).totalCopies, 1);
  assert.strictEqual(buildStageApplyPlan({ ...empty, acceptWarnings: false }, [
    { id: 'existing', title: 'Nieuw', metadataIsbn: ISBN },
  ]).error, 'review_not_ready');
  assert.strictEqual(buildStageApplyPlan({ ...empty, acceptWarnings: false }, [
    { id: 'existing-barcode', title: 'Andere titel', barcode: '9780306406157' },
  ]).error, 'review_not_ready');

  // Copies without a physical barcode must still be discoverable by the
  // existing scanner through their edition ISBN. Duplicate copies of the
  // same edition share that generated group barcode deliberately.
  assert.strictEqual(buildStageApplyPlan({ ...empty, acceptWarnings: false }, []).created[0].barcode, ISBN);
  const multipleUnlabelled = await analyzeReviewedImport([
    { Titel: 'Dezelfde editie', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Aantal: 2 },
    { Titel: 'Dezelfde editie', Auteur: 'A Auteur', 'ISBN-nummer': ISBN, Aantal: 1 },
  ]);
  const multiplePlan = buildStageApplyPlan({ ...multipleUnlabelled, acceptWarnings: false }, []);
  assert.strictEqual(multiplePlan.ok, true);
  assert.strictEqual(multiplePlan.totalCopies, 3);
  assert.ok(multiplePlan.created.every((entry) => entry.barcode === ISBN));
  assert.strictEqual(buildStageApplyPlan({ ...empty, acceptWarnings: false }, [
    { title: 'Andere editie', barcode: ISBN, metadataIsbn: ISBN2 },
  ]).error, 'review_not_ready', 'Existing ISBN barcode must be reserved');

  const barcode = await analyzeReviewedImport(rows);
  assert.strictEqual(buildStageApplyPlan({ ...barcode, acceptWarnings: false }, [
    { title: 'Andere editie', metadataIsbn: ISBN2, barcode: '12345' },
  ]).error, 'duplicate_physical_barcode');
  const loanRow = await analyzeReviewedImport([{
    Titel: 'Boek bij leerling', Auteur: 'Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'Lisa Leerling',
  }], [], { students: [{ id: 'student-1', name: 'Lisa Leerling' }] });
  assert.strictEqual(loanRow.decisions.rows[0].reason, 'loan_context_requires_followup');
  assert.strictEqual(buildStageApplyPlan({ ...loanRow, acceptWarnings: true }, []).error, 'review_not_ready');

  const mixed = await analyzeReviewedImport([
    { Titel: 'Klaar', Auteur: 'Auteur', 'ISBN-nummer': ISBN },
    { Titel: 'Onzeker', Auteur: '', 'ISBN-nummer': ISBN2 },
  ]);
  assert.strictEqual(buildStageApplyPlan({ ...mixed, acceptWarnings: true }, []).error, 'review_not_ready');
  assert.strictEqual(buildStageApplyPlan({ ...barcode, acceptWarnings: false }, []).created.length, 1);
  console.log('PR3 staged import storage and apply plan tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
