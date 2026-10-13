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
  assert.strictEqual(store.get(stage.id, 'admin-2'), stage, 'All administrator sessions can resume the one shared draft');
  assert.strictEqual(store.active(), stage);
  assert.strictEqual(store.create({ ownerId: 'admin-2', sourceRows: rows, analysis: review }).error, 'stage_busy');
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
  assert.strictEqual(store.active(), null, 'Completed stage releases the global import slot');

  const pending = store.reserve('admin-1');
  assert.strictEqual(pending.ok, true);
  assert.strictEqual(pending.stage.status, 'preparing');
  assert.strictEqual(store.reserve('admin-1').error, 'stage_busy', 'Second browser cannot start during preparation');
  clock += 1001;
  assert.strictEqual(store.active(), pending.stage, 'A metadata lookup must not expire a busy stage');
  store.activate(pending.stage, { sourceRows: rows, analysis: review });
  assert.strictEqual(pending.stage.status, 'open');
  assert.strictEqual(store.cancel(pending.stage, 0).error, 'stale_review');
  assert.strictEqual(store.cancel(pending.stage, 1).ok, true);
  assert.strictEqual(store.active(), null, 'An explicit cancel releases the slot');
  assert.strictEqual(store.beginApply(pending.stage, 2).error, 'stage_busy_or_closed');
  const afterwards = store.reserve('admin-2');
  assert.strictEqual(afterwards.ok, true);
  store.abandon(afterwards.stage);
  assert.strictEqual(store.active(), null);

  const slowReview = store.create({ ownerId: 'admin-1', sourceRows: rows, analysis: review }).stage;
  assert.strictEqual(store.beginReview(slowReview, 1).ok, true);
  clock += 1001;
  assert.strictEqual(store.active(), slowReview, 'TTL cleanup must not detach a reviewing stage');
  store.finishReview(slowReview, review, [], false);
  assert.strictEqual(store.get(slowReview.id), slowReview);
  assert.strictEqual(store.cancel(slowReview, 2).ok, true);

  // A visible browser's /active heartbeat must keep its review alive while
  // a genuinely abandoned draft should still expire after the idle TTL.
  const reading = store.create({ ownerId: 'admin-1', sourceRows: rows, analysis: review }).stage;
  const firstExpiry = reading.expiresAt;
  clock += 900;
  assert.strictEqual(store.active({ refresh: true }), reading);
  assert.ok(reading.expiresAt > firstExpiry);
  clock += 900;
  assert.strictEqual(store.active(), reading, 'An active viewer should not lose its import after the original TTL');
  assert.strictEqual(store.get(reading.id), reading, 'Opening the same import is user activity too');
  clock += 1001;
  assert.strictEqual(store.active(), null, 'An idle draft may still expire after all browser views stop');

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
  ]).error, 'review_not_ready',
  'Existing barcode collisions are now detected before the final apply step');
  const loanRow = await analyzeReviewedImport([{
    Titel: 'Boek bij leerling', Auteur: 'Auteur', 'ISBN-nummer': ISBN, 'naam leerling': 'Lisa Leerling',
  }], [], { students: [{ id: 'student-1', name: 'Lisa Leerling' }] });
  assert.strictEqual(loanRow.decisions.rows[0].reason, '',
    'The unique, exact existing pupil match makes this historic loan eligible');
  assert.strictEqual(loanRow.decisions.rows[0].loanBorrower.id, 'student-1');
  assert.strictEqual(buildStageApplyPlan({ ...loanRow, acceptWarnings: true }, []).error,
    'review_not_ready', 'Final apply without a fresh student directory must never guess');
  const checkedLoan = buildStageApplyPlan({ ...loanRow, acceptWarnings: true }, [], {
    students: [{ id: 'student-1', name: 'Lisa Leerling', borrowedBooks: [] }],
  });
  assert.strictEqual(checkedLoan.ok, true);
  assert.strictEqual(checkedLoan.created[0].loanBorrower.id, 'student-1');

  const mixed = await analyzeReviewedImport([
    { Titel: 'Klaar', Auteur: 'Auteur', 'ISBN-nummer': ISBN },
    { Titel: 'Onzeker', Auteur: '', 'ISBN-nummer': ISBN2 },
  ]);
  assert.strictEqual(buildStageApplyPlan({ ...mixed, acceptWarnings: true }, []).error, 'review_not_ready');
  assert.strictEqual(buildStageApplyPlan({ ...barcode, acceptWarnings: false }, []).created.length, 1);
  console.log('PR3 staged import storage and apply plan tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
