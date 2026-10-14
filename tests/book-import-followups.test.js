'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const XLSX = require('xlsx');
const { circulationRevision, noteLoanActivity,
  followupContext, eligibleForDeferredContext, makeTask, taskStage,
  listTasks, settingsFor, validateSettings, performDecision, assignTask,
  libraryOnlyTask, cancelTasksForDeletedBooks, cancelMissingBookTask,
  escalateTasksForDeletedClass, reportIsFullyReviewed } = require('../book-import-followups');
const { excelLoanReceiptKey } = require('../book-import-loan-migration');
const { buildInventorySyncPreview } = require('../book-import-inventory-sync');

const classes = [
  { id: 'class-a', name: 'Groep A', teacherIds: ['teacher-a', 'teacher-a2'], studentIds: ['stu-a'] },
  { id: 'class-b', name: 'Groep B', teacherIds: ['teacher-b'], studentIds: ['stu-b'] },
];
const users = [
  { id: 'teacher-a', name: 'Docent A', username: 'docent-a', role: 'teacher', passwordHash: '' },
  { id: 'teacher-a2', name: 'Collega A', username: 'collega-a', role: 'teacher', passwordHash: '' },
  { id: 'teacher-b', name: 'Docent B', username: 'docent-b', role: 'teacher', passwordHash: '' },
  { id: 'admin', name: 'Beheerder', username: 'beheerder', role: 'admin', passwordHash: '' },
];
const students = [
  { id: 'stu-a', name: 'Leerling A', classIds: ['class-a'], borrowedBooks: [] },
  { id: 'stu-b', name: 'Leerling B', classIds: ['class-b'], borrowedBooks: [] },
];
const now = new Date('2026-10-14T09:00:00Z').toISOString();
const contextRow = (index, extraContext = {}) => ({
  index, sourceRowNumber: index + 2, status: 'warning', issues: [
    { code: 'class_context_needs_review', severity: 'warning' },
  ], context: { classContext: ['Groep A'], ...extraContext },
});
const task = (id, bookId, classId, createdAt = now) => ({
  ...makeTask({ id, reportId: 'a1111111-1111-4111-a111-111111111111', row: contextRow(0),
    book: { id: bookId, title: 'Het boek', metadataIsbn: '9780306406157' },
    context: { ...followupContext(contextRow(0), classes), classId }, createdAt }),
});
const db = {
  books: [
    { id: 'one', title: 'Het boek', metadataIsbn: '9780306406157',
      barcode: '55440001', status: 'available' },
    { id: 'two', title: 'Het boek', metadataIsbn: '9780306406157',
      barcode: '55440002', status: 'available' },
    { id: 'three', title: 'Het boek', metadataIsbn: '9780306406157',
      barcode: '55440003', status: 'available' },
    { id: 'four', title: 'Het boek', metadataIsbn: '9780306406157',
      barcode: '55440004', status: 'available' },
    { id: 'five', title: 'Het boek', metadataIsbn: '9780306406157',
      barcode: '55440005', status: 'available' },
  ],
  classes, users, students, history: [], folders: [], importJobs: [],
  bookImportReports: [{ id: 'a1111111-1111-4111-a111-111111111111', fullyReviewed: false }],
  bookImportFollowups: [
    task('task-one', 'one', 'class-a'),
    task('task-two', 'two', 'class-a'),
    task('task-three', 'three', 'class-b'),
    task('task-four', 'four', 'class-a', '2026-09-01T09:00:00.000Z'),
    task('task-five', 'five', null),
  ],
};

assert.deepStrictEqual(settingsFor({}), { reminderDays: 7, escalationDays: 14 });
assert.strictEqual(validateSettings({ reminderDays: 7, escalationDays: 7 }), null);
assert.strictEqual(validateSettings({ reminderDays: '7', escalationDays: 14 }), null);
assert.deepStrictEqual(validateSettings({ reminderDays: 3, escalationDays: 10 }),
  { reminderDays: 3, escalationDays: 10 });
assert.strictEqual(followupContext(contextRow(0), classes).classId, 'class-a');
assert.strictEqual(followupContext(contextRow(0, { classContext: ['Geen bestaande klas'] }), classes).classId, null);
assert.strictEqual(followupContext(contextRow(0, { classContext: ['Groep A', 'Groep B'] }), classes).classId, null);
assert.strictEqual(followupContext({ context: {} }, classes), null);
assert.strictEqual(eligibleForDeferredContext(contextRow(0), classes), true);
assert.strictEqual(eligibleForDeferredContext({ ...contextRow(0),
  issues: [{ code: 'fatal', severity: 'conflict' }] }, classes), false);
assert.strictEqual(eligibleForDeferredContext({ ...contextRow(0), context: {
  classContext: ['Groep A'], studentLoan: { id: 'stu-a' } } }, classes), false);
assert.strictEqual(taskStage(db.bookImportFollowups[0], settingsFor(db), Date.parse(now)), 'open');
assert.strictEqual(taskStage(task('reminder', 'one', 'class-a', '2026-10-06T09:00:00Z'),
  settingsFor(db), Date.parse(now)), 'reminder');
assert.strictEqual(taskStage(task('escalated', 'one', 'class-a', '2026-09-29T09:00:00Z'),
  settingsFor(db), Date.parse(now)), 'admin_review');
assert.strictEqual(followupContext({
  context: { libraryPresence: { value: 'Aanwezig in klas?' } },
}, classes).classId, null, 'Unknown class information must return to administration');
assert.strictEqual(taskStage(db.bookImportFollowups[3], settingsFor(db), Date.parse(now)), 'admin_review');
assert.strictEqual(taskStage(db.bookImportFollowups[4], settingsFor(db), Date.parse(now)), 'admin_review');
assert.deepStrictEqual(listTasks(db, users[0], Date.parse(now)).tasks.map((t) => t.id), ['task-one', 'task-two']);
assert.deepStrictEqual(listTasks(db, users[2], Date.parse(now)).tasks.map((t) => t.id), ['task-three']);
assert.strictEqual(listTasks(db, users[3], Date.parse(now)).summary.escalated, 2);
assert.strictEqual(reportIsFullyReviewed(db, 'a1111111-1111-4111-a111-111111111111'), false);
const local = structuredClone(db);
assert.deepStrictEqual(performDecision(local, local.bookImportFollowups[0], users[0],
  { choice: 'student_loan', studentId: 'stu-b', revision: 1 }, now).error, 'student_not_in_class');
assert.strictEqual(local.books[0].status, 'available');
assert.strictEqual(performDecision(local, local.bookImportFollowups[0], users[0],
  { choice: 'student_loan', studentId: 'stu-a', revision: 1 }, now).ok, true);
assert.strictEqual(local.books[0].borrowedBy, 'stu-a');
assert.strictEqual(local.books[0].borrowedAt, null);
assert.strictEqual(local.students[0].borrowedBooks[0].bookId, 'one');
assert.ok(local.bookImportLoanReceipts.includes(excelLoanReceiptKey('one', { type: 'student', id: 'stu-a' })));
assert.strictEqual(performDecision(local, local.bookImportFollowups[0], users[1],
  { choice: 'class_loan', revision: 1 }, now).error, 'stale_or_invalid_choice');
assert.strictEqual(performDecision(local, local.bookImportFollowups[1], users[0],
  { choice: 'class_loan', revision: 1 }, now).ok, true);
assert.strictEqual(local.books[1].borrowedByClassId, 'class-a');
assert.ok(local.bookImportLoanReceipts.includes(excelLoanReceiptKey('two', { type: 'class', id: 'class-a' })));
assert.strictEqual(performDecision(local, local.bookImportFollowups[3], users[0],
  { choice: 'not_our_class', revision: 1 }, now).error, 'task_escalated');
assert.strictEqual(assignTask(local, local.bookImportFollowups[3], 'class-a', users[3], 1, now).ok, true);
assert.strictEqual(performDecision(local, local.bookImportFollowups[3], users[0],
  { choice: 'fixed_location', revision: 2 }, now).ok, true);
assert.strictEqual(local.books[3].fixedLocation, 'Groep A');
// A previously confirmed fixed classroom shelf is not overwritten by a task
// assigned to another class, even by a second teacher.
const fixedConflictDb = structuredClone(db);
fixedConflictDb.books[3].fixedLocation = 'Groep B';
assert.strictEqual(performDecision(fixedConflictDb, fixedConflictDb.bookImportFollowups[3],
  users[0], { choice: 'fixed_location', revision: 1 }, now).error, 'task_escalated');
assert.strictEqual(assignTask(fixedConflictDb, fixedConflictDb.bookImportFollowups[3],
  'class-a', users[3], 1, now).ok, true);
assert.strictEqual(performDecision(fixedConflictDb, fixedConflictDb.bookImportFollowups[3],
  users[0], { choice: 'fixed_location', revision: 2 }, now).error,
'existing_fixed_location_conflict');
assert.strictEqual(fixedConflictDb.books[3].fixedLocation, 'Groep B');
// A physical shelf can be assigned while the book is already checked out;
// the ongoing loan must not be changed as a side effect.
const borrowedShelfDb = structuredClone(db);
borrowedShelfDb.books[4].status = 'borrowed';
borrowedShelfDb.books[4].borrowedByClassId = 'class-b';
assert.strictEqual(assignTask(borrowedShelfDb, borrowedShelfDb.bookImportFollowups[4],
  'class-b', users[3], 1, now).ok, true);
assert.strictEqual(performDecision(borrowedShelfDb, borrowedShelfDb.bookImportFollowups[4],
  users[2], { choice: 'fixed_location', revision: 2 }, now).ok, true);
assert.strictEqual(borrowedShelfDb.books[4].fixedLocation, 'Groep B');
assert.strictEqual(borrowedShelfDb.books[4].status, 'borrowed');
assert.strictEqual(borrowedShelfDb.books[4].borrowedByClassId, 'class-b');
// Even after an intervening genuine check-in, a historic task cannot
// reactivate the old Excel loan. The durable counter survives history rotation.
const afterRealCirculation = structuredClone(db);
noteLoanActivity(afterRealCirculation, 'one'); // real checkout
noteLoanActivity(afterRealCirculation, 'one'); // real check-in
afterRealCirculation.history = []; // activity feed fully rotated
assert.strictEqual(circulationRevision(afterRealCirculation, 'one'), 2);
assert.strictEqual(performDecision(afterRealCirculation,
  afterRealCirculation.bookImportFollowups[0], users[0],
  { choice: 'student_loan', studentId: 'stu-a', revision: 1 }, now).error,
  'book_circulation_changed_since_import');
assert.strictEqual(afterRealCirculation.books[0].status, 'available');
assert.strictEqual(performDecision(afterRealCirculation,
  afterRealCirculation.bookImportFollowups[0], users[0],
  { choice: 'fixed_location', revision: 1 }, now).ok, true);
// New tasks capture the current baseline; activity that predates the import
// must not prevent their legitimate, still-current classification.
const afterActivityTask = makeTask({ id: 'baseline-test', reportId: 'baseline-report',
  row: contextRow(0), book: afterRealCirculation.books[1],
  context: followupContext(contextRow(0), classes), createdAt: now,
  loanActivityRevision: circulationRevision(afterRealCirculation, 'one') });
assert.strictEqual(afterActivityTask.loanActivityRevision, 2);
const prototypeSafeDb = { bookImportLoanActivityCounters: {} };
noteLoanActivity(prototypeSafeDb, '__proto__');
assert.strictEqual(circulationRevision(prototypeSafeDb, '__proto__'), 1);
assert.strictEqual(Object.getPrototypeOf(prototypeSafeDb.bookImportLoanActivityCounters), null);

// PR6: a standalone library-presence question must be resolvable without
// inventing a class assignment. Removing a copy is an explicit admin action
// and closes all linked outstanding tasks and import reports.
const libraryRow = { index: 90, sourceRowNumber: 91, status: 'warning',
  issues: [{ code: 'library_presence_needs_review', severity: 'warning' }],
  context: { libraryPresence: { status: 'needs_review', value: 'nee' } } };
const standaloneTask = makeTask({
  id: 'library-only', reportId: 'library-report', row: libraryRow,
  book: db.books[4], context: followupContext(libraryRow, classes), createdAt: now,
});
assert.strictEqual(standaloneTask.classId, null);
assert.strictEqual(libraryOnlyTask(standaloneTask), true);
const libraryDb = structuredClone(db);
libraryDb.bookImportFollowups = [structuredClone(standaloneTask)];
libraryDb.bookImportReports = [{ id: 'library-report',
  followupTaskIds: ['library-only'], fullyReviewed: false }];
assert.strictEqual(listTasks(libraryDb, users[3], Date.parse(now)).tasks[0].libraryOnly, true);
assert.strictEqual(listTasks(libraryDb, users[3], Date.parse(now)).tasks[0].status, 'admin_review');
assert.strictEqual(performDecision(libraryDb, libraryDb.bookImportFollowups[0],
  users[0], { choice: 'library_keep', revision: 1 }, now).error,
'library_choice_forbidden');
assert.strictEqual(performDecision(libraryDb, libraryDb.bookImportFollowups[0],
  users[3], { choice: 'library_keep', revision: 1 }, now).ok, true);
assert.strictEqual(libraryDb.books.some((book) => book.id === 'five'), true);
assert.strictEqual(reportIsFullyReviewed(libraryDb, 'library-report'), true);
const removedLibraryDb = structuredClone(db);
removedLibraryDb.bookImportFollowups = [structuredClone(standaloneTask), {
  ...task('second-task', 'five', 'class-a'), reportId: 'linked-report',
}];
removedLibraryDb.bookImportReports = [
  { id: 'library-report', followupTaskIds: ['library-only'], fullyReviewed: false },
  { id: 'linked-report', followupTaskIds: ['second-task'], fullyReviewed: false },
];
assert.strictEqual(performDecision(removedLibraryDb, removedLibraryDb.bookImportFollowups[0],
  users[3], { choice: 'library_remove', revision: 1 }, now).error,
  'confirm_removal_required');
assert.strictEqual(removedLibraryDb.books.some((book) => book.id === 'five'), true);
assert.strictEqual(performDecision(removedLibraryDb, removedLibraryDb.bookImportFollowups[0],
  users[3], { choice: 'library_remove', confirmRemoval: true, revision: 1 }, now).ok, true);
assert.strictEqual(removedLibraryDb.books.some((book) => book.id === 'five'), false);
assert.strictEqual(removedLibraryDb.bookImportFollowups[0].status, 'completed');
assert.strictEqual(removedLibraryDb.bookImportFollowups[1].status, 'cancelled');
assert.strictEqual(removedLibraryDb.bookImportReports.every((report) => report.fullyReviewed), true);
assert.strictEqual(performDecision(removedLibraryDb, removedLibraryDb.bookImportFollowups[1],
  users[3], { choice: 'fixed_location', revision: 2 }, now).error,
  'stale_or_invalid_choice');
const borrowedLibraryDb = structuredClone(db);
borrowedLibraryDb.bookImportFollowups = [structuredClone(standaloneTask)];
borrowedLibraryDb.books[4].status = 'borrowed';
borrowedLibraryDb.books[4].borrowedByClassId = 'class-a';
assert.strictEqual(performDecision(borrowedLibraryDb, borrowedLibraryDb.bookImportFollowups[0],
  users[3], { choice: 'library_remove', confirmRemoval: true, revision: 1 }, now).error,
  'book_already_borrowed');
assert.strictEqual(borrowedLibraryDb.books.some((book) => book.id === 'five'), true);

// Missing physical copies and removed classes must go straight to admin.
// The task remains revisioned and can be reassigned or safely cancelled.
const orphanDb = structuredClone(db);
orphanDb.books = orphanDb.books.filter((book) => book.id !== 'four');
const orphanVisible = listTasks(orphanDb, users[3], Date.parse(now)).tasks.find((t) =>
  t.id === 'task-four');
assert.strictEqual(orphanVisible.status, 'admin_review');
assert.strictEqual(orphanVisible.bookMissing, true);
assert.strictEqual(cancelMissingBookTask(orphanDb, orphanDb.bookImportFollowups[3],
  users[0], 1, now).ok, false);
assert.strictEqual(cancelMissingBookTask(orphanDb, orphanDb.bookImportFollowups[3],
  users[3], 1, now).ok, true);
assert.strictEqual(orphanDb.bookImportFollowups[3].status, 'cancelled');
assert.strictEqual(orphanDb.bookImportFollowups[3].revision, 2);
const removedClassDb = structuredClone(db);
removedClassDb.classes = removedClassDb.classes.filter((c) => c.id !== 'class-b');
assert.strictEqual(listTasks(removedClassDb, users[3], Date.parse(now)).tasks.find((t) =>
  t.id === 'task-three').status, 'admin_review');
assert.strictEqual(listTasks(removedClassDb, users[2], Date.parse(now)).tasks.length, 0);
assert.strictEqual(escalateTasksForDeletedClass(removedClassDb, 'class-b', now), 1);
assert.strictEqual(removedClassDb.bookImportFollowups[2].classId, null);
assert.strictEqual(removedClassDb.bookImportFollowups[2].revision, 2);
assert.strictEqual(assignTask(removedClassDb, removedClassDb.bookImportFollowups[2],
  'class-a', users[3], 2, now).ok, true);
const libraryContextWithClass = task('not-library-only', 'four', 'class-a');
assert.strictEqual(libraryOnlyTask(libraryContextWithClass), false);
assert.strictEqual(performDecision(db, libraryContextWithClass, users[3],
  { choice: 'library_keep', revision: 1 }, now).error, 'library_choice_forbidden');
const inconsistentStudentDb = structuredClone(db);
inconsistentStudentDb.students[0].borrowedBooks.push({ bookId: 'two' });
assert.strictEqual(performDecision(inconsistentStudentDb,
  inconsistentStudentDb.bookImportFollowups[0], users[0],
  { choice: 'student_loan', studentId: 'stu-a', revision: 1 }, now).error,
'student_already_borrowed_edition');
assert.strictEqual(inconsistentStudentDb.books[0].status, 'available');
assert.strictEqual(performDecision(local, local.bookImportFollowups[2], users[2],
  { choice: 'not_our_class', revision: 1 }, now).ok, true);
assert.strictEqual(local.bookImportFollowups[2].classId, null);
assert.strictEqual(local.bookImportFollowups[2].status, 'admin_review');
assert.strictEqual(reportIsFullyReviewed(local, 'a1111111-1111-4111-a111-111111111111'), false);
assert.strictEqual(assignTask(local, local.bookImportFollowups[4], 'class-b', users[3], 1, now).ok, true);
assert.strictEqual(performDecision(local, local.bookImportFollowups[4], users[2],
  { choice: 'fixed_location', revision: 2 }, now).ok, true);
assert.strictEqual(assignTask(local, local.bookImportFollowups[2], 'class-b', users[3], 2, now).ok, true);
assert.strictEqual(performDecision(local, local.bookImportFollowups[2], users[2],
  { choice: 'fixed_location', revision: 3 }, now).ok, true);
assert.strictEqual(reportIsFullyReviewed(local, 'a1111111-1111-4111-a111-111111111111'), true);

// PR6 inventory safety: new books and uniquely identified old copies may get
// tasks, but unknown physical copies must remain blocked.
const workbook = (rows, existing = [], options = {}) => buildInventorySyncPreview({
  ok: true, rows,
}, existing, { classes, students, ...options });
const inventoryRow = (index, extra = {}) => ({
  ...contextRow(index),
  book: { editionIsbn: '9780140328721', title: 'Een nieuw klasboek',
    author: 'Schrijver', barcode: '', quantity: { value: 1, valid: true }, ...extra },
});
const newWithTask = workbook([inventoryRow(0)], [], { acceptWarnings: true });
assert.strictEqual(newWithTask.summary.readyToApply, true);
assert.strictEqual(newWithTask.summary.classFollowups, 1);
assert.strictEqual(newWithTask.classFollowups[0].target, 'new');
assert.strictEqual(newWithTask.rows[0].needsClassFollowup, true);
const existingClassCopy = { id: 'known-copy', metadataIsbn: '9780140328721',
  title: 'Een nieuw klasboek', author: 'Schrijver', barcode: '11009922', status: 'available' };
const existingWithTask = workbook([inventoryRow(0, { barcode: '11009922' })],
  [existingClassCopy], { acceptWarnings: true });
assert.strictEqual(existingWithTask.summary.readyToApply, true);
assert.deepStrictEqual(existingWithTask.classFollowups.map((x) => x.bookId), ['known-copy']);
const duplicateCopies = workbook([inventoryRow(0, {
  quantity: { value: 2, valid: true },
})], [existingClassCopy, { ...existingClassCopy, id: 'second-copy', barcode: '11009923' }],
{ acceptWarnings: true });
assert.strictEqual(duplicateCopies.summary.readyToApply, false);
assert.strictEqual(duplicateCopies.rows[0].reason, 'class_followup_requires_physical_copy_match');
assert.strictEqual(duplicateCopies.classFollowups.length, 0);
const unsafeReduction = workbook([inventoryRow(0)],
  [existingClassCopy, { ...existingClassCopy, id: 'second-copy', barcode: '11009923' }],
  { acceptWarnings: true, resolutions: [{ isbn: '9780140328721', action: 'keep_existing' }] });
assert.strictEqual(unsafeReduction.ok, false);
assert.strictEqual(unsafeReduction.error, 'invalid_sync_resolution_reason');
const warningNotAccepted = workbook([inventoryRow(0)], []);
assert.strictEqual(warningNotAccepted.summary.readyToApply, false);
assert.strictEqual(warningNotAccepted.classFollowups.length, 0);
// A completed class decision stays completed in later Excel uploads, even
// after a genuine return. Reimporting must not generate another classroom
// task, change borrowers or invent a historical checkout date.
const completedTask = makeTask({ id: 'completed-task', reportId: 'old-report',
  row: inventoryRow(0),
  book: existingClassCopy, context: followupContext(inventoryRow(0), classes),
  createdAt: now });
completedTask.status = 'completed';
completedTask.resolution = 'class_loan';
for (const physical of [
  existingClassCopy,
  { ...existingClassCopy, status: 'borrowed', borrowedByClassId: 'class-a' },
]) {
  const repeat = workbook([inventoryRow(0, { barcode: '11009922' })], [physical], {
    acceptWarnings: true, existingFollowups: [completedTask],
  });
  assert.strictEqual(repeat.summary.readyToApply, true);
  assert.strictEqual(repeat.summary.classFollowups, 0);
  assert.strictEqual(repeat.summary.classContextsAlreadyReviewed, 1);
  assert.strictEqual(repeat.classFollowups[0].target, 'previously_resolved');
  assert.strictEqual(repeat.rows[0].needsClassFollowup, false);
}
const neverResolvedLoan = workbook([inventoryRow(0, { barcode: '11009922' })],
  [{ ...existingClassCopy, status: 'borrowed', borrowedByClassId: 'class-a' }],
  { acceptWarnings: true });
assert.strictEqual(neverResolvedLoan.summary.readyToApply, false);
assert.strictEqual(neverResolvedLoan.rows[0].reason, 'class_followup_book_borrowed');

const PORT = 4076;
const BASE = 'http://127.0.0.1:' + PORT;
const hash = password => crypto.createHash('sha256').update(password).digest('hex');
async function call(route, token, payload, method) {
  const response = await fetch(BASE + route, {
    method: method || (payload === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}
function fileBase64(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Bibliotheek');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
}
function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('PR6 server start timeout')), 12000);
    function onData(chunk) {
      if (!chunk.toString().includes('http://localhost:' + PORT)) return;
      clearTimeout(timeout); child.stdout.off('data', onData); resolve();
    }
    child.stdout.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timeout); reject(Error('Server exited: ' + code)); });
  });
}
async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pr6-'));
  const dbPath = path.join(dir, 'db.json');
  const initial = structuredClone(db);
  initial.users.forEach((user) => { user.passwordHash = hash('pass'); });
  initial.students.forEach((student) => { student.username = student.id; student.passwordHash = hash('pass'); });
  fs.writeFileSync(dbPath, JSON.stringify(initial));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BOEKENBAAI_DATA_PATH: dbPath,
      BOEKENBAAI_STATIC_DIR: path.resolve(__dirname, '..', 'public'),
      BOEKENBAAI_IMPORT_ENRICH_ISBN: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await waitForServer(child);
    const login = async (username) => {
      const response = await call('/api/login', null, { username, password: 'pass' });
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      return response.body.token;
    };
    const teacherA = await login('docent-a');
    const teacherA2 = await login('collega-a');
    const teacherB = await login('docent-b');
    const admin = await login('beheerder');
    const studentA = await login('stu-a');
    const root = '/api/staff/book-import-followups';
    assert.strictEqual((await call(root, null)).status, 401);
    assert.strictEqual((await call(root, studentA)).status, 403);
    const teacherTasks = await call(root, teacherA);
    assert.strictEqual(teacherTasks.status, 200);
    assert.deepStrictEqual(teacherTasks.body.tasks.map((t) => t.id), ['task-one', 'task-two']);
    assert.deepStrictEqual((await call(root, teacherA2)).body.tasks.map((t) => t.id),
      ['task-one', 'task-two'], 'Multiple teachers of one class must see the SAME tasks');
    assert.deepStrictEqual((await call(root, teacherB)).body.tasks.map((t) => t.id),
      ['task-three']);
    assert.strictEqual((await call('/api/admin/book-import-followups/settings', teacherA)).status, 403);
    assert.strictEqual((await call('/api/admin/book-import-followups/settings', admin,
      { reminderDays: 7, escalationDays: 7 }, 'PUT')).status, 400);
    assert.strictEqual((await call('/api/admin/book-import-followups/settings', admin,
      { reminderDays: 3, escalationDays: 10 }, 'PUT')).status, 200);
    assert.strictEqual((await call(root, teacherB)).body.tasks[0].status, 'open');
    assert.strictEqual((await call(root + '/task-three/decision', teacherA,
      { choice: 'fixed_location', revision: 1 })).status, 403,
      'Cannot complete another teacher\'s class task');
    assert.strictEqual((await call(root + '/task-one/decision', studentA,
      { choice: 'class_loan', revision: 1 })).status, 403);
    assert.strictEqual((await call(root + '/task-one/decision', teacherA,
      { choice: 'student_loan', studentId: 'stu-b', revision: 1 })).status, 409);
    assert.strictEqual((await call(root + '/task-one/decision', teacherA,
      { choice: 'student_loan', studentId: 'stu-a', revision: 1 })).status, 200);
    assert.strictEqual((await call(root + '/task-one/decision', teacherA2,
      { choice: 'class_loan', revision: 1 })).status, 409,
      'A colleague must not overwrite an already completed task');
    const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(stored.books.find((b) => b.id === 'one').borrowedBy, 'stu-a');
    assert.strictEqual(stored.bookImportFollowups.find((t) => t.id === 'task-one').status, 'completed');
    assert.strictEqual(stored.bookImportReports[0].fullyReviewed, false);
    assert.strictEqual((await call('/api/admin/book-import-reports/a1111111-1111-4111-a111-111111111111', admin)).body.fullyReviewed, false);
    // The same physical copy stays unavailable even when another teacher
    // attempts an unrelated checkout during this workflow.
    assert.strictEqual((await call(root + '/task-two/decision', teacherA2,
      { choice: 'class_loan', revision: 1 })).status, 200);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((b) => b.id === 'two').borrowedByClassId, 'class-a');

    // Escalated and unassigned work is visible only to administration.
    assert.strictEqual((await call(root, teacherA)).body.tasks.length, 0);
    const escalated = await call(root, admin);
    assert.strictEqual(escalated.body.summary.escalated, 2);
    assert.strictEqual((await call('/api/admin/book-import-followups/task-five/assign', teacherA,
      { classId: 'class-a', revision: 1 })).status, 403);
    assert.strictEqual((await call('/api/admin/book-import-followups/task-five/assign', admin,
      { classId: 'not-a-class', revision: 1 })).status, 409);
    assert.strictEqual((await call('/api/admin/book-import-followups/task-five/assign', admin,
      { classId: 'class-a', revision: 1 })).status, 200);
    assert.strictEqual((await call(root, teacherA)).body.tasks.some((t) => t.id === 'task-five'), true);
    const revoked = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    revoked.classes.find((c) => c.id === 'class-a').teacherIds = ['teacher-a2'];
    fs.writeFileSync(dbPath, JSON.stringify(revoked));
    assert.strictEqual((await call(root, teacherA)).body.tasks.length, 0);
    assert.strictEqual((await call(root + '/task-five/decision', teacherA,
      { choice: 'fixed_location', revision: 2 })).status, 403);
    assert.strictEqual((await call(root + '/task-five/decision', teacherA2,
      { choice: 'fixed_location', revision: 2 })).status, 200);

    // Create-mode import with an uncertain class annotation now creates an
    // actionable pending task instead of silently discarding the Excel column.
    const sample = fileBase64([{
      Titel: 'Een nieuw klasboek', Auteur: 'Schrijver', 'ISBN-nummer': '9780140328721',
      Klassen: 'Groep B', Aantal: 1,
    }]);
    const staged = await call('/api/admin/book-import-stages', admin,
      { file: sample, fileName: 'pr6-klascontext.xlsx' });
    assert.strictEqual(staged.status, 201, JSON.stringify(staged.body).slice(0, 650));
    const id = staged.body.id;
    const reviewed = await call('/api/admin/book-import-stages/' + id + '/review', admin,
      { revision: staged.body.revision, acceptWarnings: true, corrections: [] });
    assert.strictEqual(reviewed.status, 200, JSON.stringify(reviewed.body).slice(0, 650));
    assert.strictEqual(reviewed.body.decisions.summary.readyToApply, true,
      'Deferrable class context must not make valid book identity unimportable');
    assert.strictEqual(reviewed.body.decisions.rows[0].needsClassFollowup, true);
    const applied = await call('/api/admin/book-import-stages/' + id + '/apply', admin,
      { revision: reviewed.body.revision, confirm: true });
    assert.strictEqual(applied.status, 200, JSON.stringify(applied.body).slice(0, 600));
    assert.strictEqual(applied.body.result.report.followupTasksCreated, 1);
    assert.strictEqual(applied.body.result.report.fullyReviewed, false);
    const afterImport = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const importedTasks = afterImport.bookImportFollowups.filter((t) =>
      t.reportId === applied.body.result.batchId);
    assert.strictEqual(importedTasks.length, 1);
    assert.strictEqual(importedTasks[0].classId, 'class-b');
    assert.strictEqual((await call(root, teacherB)).body.tasks.some((t) =>
      t.id === importedTasks[0].id), true);
    // Re-import while the first classroom task is still pending. Do not create
    // a second task for the same physical copy or falsely mark the new report
    // fully checked. The newly recorded report must share its predecessor's task.
    const uploadedAgain = await call('/api/admin/book-import-stages', admin,
      { mode: 'inventory_sync', file: sample, fileName: 'pr6-opnieuw.xlsx' });
    assert.strictEqual(uploadedAgain.status, 201,
      JSON.stringify(uploadedAgain.body).slice(0, 500));
    const checkedAgain = await call('/api/admin/book-import-stages/' + uploadedAgain.body.id
      + '/review', admin, { revision: uploadedAgain.body.revision, acceptWarnings: true,
        corrections: [] });
    assert.strictEqual(checkedAgain.status, 200, JSON.stringify(checkedAgain.body).slice(0, 550));
    assert.strictEqual(checkedAgain.body.decisions.summary.classFollowups, 1);
    const repeated = await call('/api/admin/book-import-stages/' + uploadedAgain.body.id
      + '/apply', admin, { revision: checkedAgain.body.revision, confirm: true });
    assert.strictEqual(repeated.status, 200, JSON.stringify(repeated.body).slice(0, 600));
    assert.strictEqual(repeated.body.result.created, 0);
    assert.strictEqual(repeated.body.result.report.followupTasksCreated, 0);
    assert.strictEqual(repeated.body.result.report.fullyReviewed, false);
    assert.deepStrictEqual(repeated.body.result.report.followupTaskIds, [importedTasks[0].id]);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).bookImportFollowups
      .filter((t) => t.bookId === importedTasks[0].bookId).length, 1);
    // A real loan was started and returned while the old import task was open.
    // The teacher cannot revive that obsolete loan but may still confirm
    // the permanent physical location of the same copy.
    assert.strictEqual((await call('/api/books/' + importedTasks[0].bookId
      + '/check-out', teacherB, { classId: 'class-b' })).status, 200);
    assert.strictEqual((await call('/api/books/' + importedTasks[0].bookId
      + '/check-in', teacherB, { classId: 'class-b' })).status, 200);
    const obsoleteLoan = await call(root + '/' + importedTasks[0].id + '/decision',
      teacherB, { choice: 'class_loan', revision: 1 });
    assert.strictEqual(obsoleteLoan.status, 409);
    assert.strictEqual(obsoleteLoan.body.error, 'book_circulation_changed_since_import');
    assert.strictEqual((await call(root + '/' + importedTasks[0].id + '/decision', teacherB,
      { choice: 'fixed_location', revision: 1 })).status, 200);
    assert.strictEqual((await call('/api/admin/book-import-reports/' + applied.body.result.batchId,
      admin)).body.fullyReviewed, true);
    assert.strictEqual((await call('/api/admin/book-import-reports/' + repeated.body.result.batchId,
      admin)).body.fullyReviewed, true);

    // End-to-end: after completion, a stale Excel upload is not a NEW task.
    // Neither a genuine checkout nor a genuine check-in is undone by reimport.
    const checkout = await call('/api/books/' + importedTasks[0].bookId
      + '/check-out', teacherB, { classId: 'class-b' });
    assert.strictEqual(checkout.status, 200, JSON.stringify(checkout.body));
    const checkin = await call('/api/books/' + importedTasks[0].bookId
      + '/check-in', teacherB, { classId: 'class-b' });
    assert.strictEqual(checkin.status, 200, JSON.stringify(checkin.body));
    const oldExcelAgain = await call('/api/admin/book-import-stages', admin,
      { mode: 'inventory_sync', file: sample, fileName: 'pr6-oud-na-inname.xlsx' });
    assert.strictEqual(oldExcelAgain.status, 201, JSON.stringify(oldExcelAgain.body));
    const oldExcelChecked = await call('/api/admin/book-import-stages/'
      + oldExcelAgain.body.id + '/review', admin,
      { revision: oldExcelAgain.body.revision, acceptWarnings: true, corrections: [] });
    assert.strictEqual(oldExcelChecked.status, 200, JSON.stringify(oldExcelChecked.body));
    assert.strictEqual(oldExcelChecked.body.decisions.summary.readyToApply, true);
    assert.strictEqual(oldExcelChecked.body.decisions.summary.classFollowups, 0);
    assert.strictEqual(oldExcelChecked.body.decisions.summary.classContextsAlreadyReviewed, 1);
    const oldExcelApplied = await call('/api/admin/book-import-stages/'
      + oldExcelAgain.body.id + '/apply', admin,
      { revision: oldExcelChecked.body.revision, confirm: true });
    assert.strictEqual(oldExcelApplied.status, 200, JSON.stringify(oldExcelApplied.body));
    assert.strictEqual(oldExcelApplied.body.result.report.followupTasksCreated, 0);
    assert.strictEqual(oldExcelApplied.body.result.report.fullyReviewed, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books
      .find((b) => b.id === importedTasks[0].bookId).status, 'available');
    const publicBook = await call('/api/books/' + importedTasks[0].bookId, studentA);
    assert.strictEqual(publicBook.status, 200);
    assert.ok(!JSON.stringify(publicBook.body).includes('sourceClassNames'),
      'Student clients must not see raw teacher task source values');
    // Codex PR6 regression: admin must be able to resolve a source row
    // containing only the library-presence column, without selecting a fake
    // classroom first. The two terminal decisions have different effects.
    const librarySeed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const libraryRow = { sourceRowNumber: 101, context: {
      libraryPresence: { status: 'needs_review', value: 'nee' } } };
    const buildLibraryRecord = (suffix, id, isbn) => {
      const book = { id, title: 'Bibliotheekcontrole ' + suffix, author: 'Auteur',
        barcode: suffix, metadataIsbn: isbn, status: 'available' };
      const reportId = 'f0000000-0000-4000-a000-00000000000' + suffix.slice(-1);
      const context = followupContext(libraryRow, librarySeed.classes);
      const task = makeTask({ id: 'library-' + suffix, reportId, row: libraryRow,
        book, context, createdAt: new Date().toISOString() });
      librarySeed.books.push(book);
      librarySeed.bookImportFollowups.push(task);
      librarySeed.bookImportReports.push({ id: reportId, fullyReviewed: false,
        followupTaskIds: [task.id] });
      return { task, reportId };
    };
    const keepLibrary = buildLibraryRecord('1', 'library-physical-1', '9780306406157');
    const removeLibrary = buildLibraryRecord('2', 'library-physical-2', '9780439554930');
    fs.writeFileSync(dbPath, JSON.stringify(librarySeed));
    const libraryOverview = await call(root, admin);
    assert.strictEqual(libraryOverview.status, 200);
    assert.strictEqual(libraryOverview.body.tasks.find((t) =>
      t.id === keepLibrary.task.id).libraryOnly, true);
    assert.strictEqual(libraryOverview.body.tasks.find((t) =>
      t.id === keepLibrary.task.id).status, 'admin_review');
    assert.strictEqual((await call(root + '/' + keepLibrary.task.id + '/decision', teacherB,
      { choice: 'library_keep', revision: 1 })).status, 403);
    const keepResponse = await call(root + '/' + keepLibrary.task.id + '/decision',
      admin, { choice: 'library_keep', revision: 1 });
    assert.strictEqual(keepResponse.status, 200, JSON.stringify(keepResponse.body));
    assert.strictEqual((await call('/api/admin/book-import-reports/' + keepLibrary.reportId,
      admin)).body.fullyReviewed, true);
    assert.ok(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.some((b) =>
      b.id === 'library-physical-1'));
    assert.strictEqual((await call(root + '/' + removeLibrary.task.id + '/decision',
      admin, { choice: 'library_remove', revision: 1 })).status, 409,
    'Permanent removal always requires an explicit confirmation');
    const removeResponse = await call(root + '/' + removeLibrary.task.id + '/decision',
      admin, { choice: 'library_remove', revision: 1, confirmRemoval: true });
    assert.strictEqual(removeResponse.status, 200, JSON.stringify(removeResponse.body));
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).books.some((b) =>
      b.id === 'library-physical-2'), false);
    assert.strictEqual((await call('/api/admin/book-import-reports/' + removeLibrary.reportId,
      admin)).body.fullyReviewed, true);

    // All deletion paths must cancel orphaned tasks immediately, and class
    // deletion must return uncompleted assigned work directly to admin.
    assert.strictEqual((await call('/api/books/four', admin, undefined, 'DELETE')).status, 200);
    assert.strictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')).bookImportFollowups
      .find((t) => t.id === 'task-four').status, 'cancelled');
    assert.strictEqual((await call('/api/classes/class-b', admin, undefined, 'DELETE')).status, 200);
    const afterClassRemoval = await call(root, admin);
    const formerlyClassB = afterClassRemoval.body.tasks.find((t) => t.id === 'task-three');
    assert.strictEqual(formerlyClassB.status, 'admin_review');
    assert.strictEqual(formerlyClassB.classId, null);
    assert.strictEqual((await call('/api/admin/book-import-followups/task-three/assign',
      admin, { classId: 'class-a', revision: formerlyClassB.revision })).status, 200);
    const reassignedTask = (await call(root, teacherA2)).body.tasks.find((t) =>
      t.id === 'task-three');
    assert.strictEqual(reassignedTask.status, 'open');
    assert.strictEqual((await call(root + '/task-three/decision', teacherA2,
      { choice: 'fixed_location', revision: reassignedTask.revision })).status, 200);
    assert.strictEqual((await call('/api/admin/book-import-reports/'
      + 'a1111111-1111-4111-a111-111111111111', admin)).body.fullyReviewed, true);

    const reductionDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const reductionBook = { id: 'reduction-book', title: 'Aantal verminderen',
      author: 'Auteur', barcode: '77664411', metadataIsbn: '9780747532699',
      status: 'available' };
    const reductionReport = 'f0000000-0000-4000-a000-000000000003';
    reductionDb.books.push(reductionBook);
    const reductionTask = makeTask({ id: 'reduction-task', reportId: reductionReport,
      row: libraryRow, book: reductionBook,
      context: followupContext(libraryRow, reductionDb.classes),
      createdAt: new Date().toISOString() });
    reductionDb.bookImportFollowups.push(reductionTask);
    reductionDb.bookImportReports.push({ id: reductionReport, fullyReviewed: false });
    fs.writeFileSync(dbPath, JSON.stringify(reductionDb));
    const reduced = await call('/api/books/reduction-book', admin, {
      quantityChange: -1, removeCopyId: 'reduction-book',
    }, 'PUT');
    assert.strictEqual(reduced.status, 200, JSON.stringify(reduced.body));
    const afterReduction = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterReduction.bookImportFollowups.find((t) =>
      t.id === 'reduction-task').status, 'cancelled');
    assert.strictEqual(afterReduction.bookImportReports.find((r) =>
      r.id === reductionReport).fullyReviewed, true);

    // A truly missing book from a historic/corrupt snapshot is still
    // recoverable through an admin-only cancel action, with a stale guard.
    const orphan = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const orphanReport = 'f0000000-0000-4000-a000-000000000004';
    const orphanCopy = { id: 'already-deleted', title: 'Verwijderd', author: 'Auteur' };
    const orphanTask = makeTask({ id: 'orphan-task', reportId: orphanReport,
      row: libraryRow, book: orphanCopy,
      context: followupContext(libraryRow, orphan.classes),
      createdAt: new Date().toISOString() });
    orphan.bookImportFollowups.push(orphanTask);
    orphan.bookImportReports.push({ id: orphanReport, fullyReviewed: false });
    fs.writeFileSync(dbPath, JSON.stringify(orphan));
    assert.strictEqual((await call('/api/admin/book-import-followups/orphan-task/cancel',
      teacherA2, { revision: 1 })).status, 403);
    assert.strictEqual((await call('/api/admin/book-import-followups/orphan-task/cancel',
      admin, { revision: 2 })).status, 409);
    assert.strictEqual((await call('/api/admin/book-import-followups/orphan-task/cancel',
      admin, { revision: 1 })).status, 200);
    assert.strictEqual((await call('/api/admin/book-import-reports/' + orphanReport,
      admin)).body.fullyReviewed, true);

    // Bulk deletion is blocked while any physical books are borrowed; after
    // actual returns, it closes remaining class tasks for removed copies.
    assert.strictEqual((await call('/api/books', admin, undefined, 'DELETE')).status, 400);
    assert.strictEqual((await call('/api/books/one/check-in', teacherA2,
      { studentId: 'stu-a' })).status, 200);
    assert.strictEqual((await call('/api/books/two/check-in', teacherA2,
      { classId: 'class-a' })).status, 200);
    const bulk = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const bulkReport = 'f0000000-0000-4000-a000-000000000005';
    bulk.bookImportFollowups.push(makeTask({ id: 'bulk-pending',
      reportId: bulkReport, row: libraryRow,
      book: bulk.books.find((b) => b.id === 'library-physical-1'),
      context: followupContext(libraryRow, bulk.classes),
      createdAt: new Date().toISOString() }));
    bulk.bookImportReports.push({ id: bulkReport, fullyReviewed: false });
    fs.writeFileSync(dbPath, JSON.stringify(bulk));
    assert.strictEqual((await call('/api/books', admin, undefined, 'DELETE')).status, 200);
    const emptied = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(emptied.books.length, 0);
    assert.strictEqual(emptied.bookImportFollowups.find((t) =>
      t.id === 'bulk-pending').status, 'cancelled');
    assert.strictEqual(emptied.bookImportReports.find((r) =>
      r.id === bulkReport).fullyReviewed, true);
    console.log('PR6 persistent follow-ups, role scoping, shared decisions and import API tests passed');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
