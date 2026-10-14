'use strict';
const assert = require('assert');
const { resolveReviewedLoan, inspectReviewedLoans, stageReviewedLoan,
  excelLoanReceiptKey, historicalExcelLoanReceipts, persistExcelLoanReceipts } =
  require('../book-import-loan-migration');
const ISBN = '9780131103627';
const students = [
  { id: 's1', name: 'Lisa Leerling', borrowedBooks: [] },
  { id: 's2', name: 'Andere Leerling', borrowedBooks: [], active: false },
];
const classes = [{ id: 'c1', name: 'Structuur BB' }];
const row = (index, loan = { status: 'matched', id: 's1', name: 'Lisa Leerling' }) => ({
  index, status: 'ready', book: {
    title: 'Testboek', author: 'A Auteur',
    editionIsbn: ISBN, quantity: { valid: true, value: 1 },
  }, context: { studentLoan: loan },
});

assert.deepStrictEqual(resolveReviewedLoan(row(0), { students, classes }), {
  ok: true, borrower: { type: 'student', id: 's1', name: 'Lisa Leerling' },
});
assert.strictEqual(resolveReviewedLoan({ ...row(0), context: {} }, { students, classes }).borrower, null);
assert.strictEqual(resolveReviewedLoan({ ...row(0),
  context: { studentLoan: row(0).context.studentLoan,
    classLoan: { status: 'matched', id: 'c1', name: 'Structuur BB' } },
}, { students, classes }).error, 'conflicting_loan_context');
assert.strictEqual(resolveReviewedLoan({ ...row(0), book: {
  ...row(0).book, quantity: { valid: true, value: 2 },
} }, { students, classes }).error, 'loan_requires_single_copy');
assert.strictEqual(resolveReviewedLoan(row(0, {
  status: 'unmatched', name: 'Onbekend',
}), { students, classes }).error, 'loan_borrower_needs_review');
assert.strictEqual(resolveReviewedLoan(row(0, {
  status: 'matched', id: 's2', name: 'Lisa Leerling',
}), { students, classes }).error, 'loan_borrower_changed');
assert.strictEqual(resolveReviewedLoan(row(0, {
  status: 'matched', id: 's2', name: 'Andere Leerling',
}), { students, classes }).error, 'loan_borrower_inactive');
assert.strictEqual(resolveReviewedLoan({ ...row(0),
  context: { classLoan: { status: 'matched', id: 'c1', name: 'Structuur BB' } },
}, { students, classes }).borrower.type, 'class');
assert.strictEqual(resolveReviewedLoan(row(0), {
  students: students.concat({ id: 's3', name: 'Lisa Leerling', borrowedBooks: [] }), classes,
}).error, 'loan_borrower_changed', 'Two matching students must never be guessed');

const duplicate = inspectReviewedLoans([row(0), row(1)], { students, classes, books: [] });
assert.strictEqual(duplicate.get(0).error, 'duplicate_student_loan_in_workbook');
assert.strictEqual(duplicate.get(1).error, 'duplicate_student_loan_in_workbook');
const alreadyBorrowed = [{
  id: 'existing-book', editionIsbn: ISBN, status: 'borrowed', borrowedBy: 's1',
}];
const existing = inspectReviewedLoans([row(0)], {
  students: [{ ...students[0], borrowedBooks: ['existing-book'] }, students[1]],
  classes, books: alreadyBorrowed,
});
assert.strictEqual(existing.get(0).error, 'student_already_borrowed_edition');
const legacyInvalidIsbnField = inspectReviewedLoans([row(0)], {
  students: [{ ...students[0], borrowedBooks: [{ bookId: 'existing-book' }] }, students[1]],
  classes, books: [{ id: 'existing-book', editionIsbn: 'bad-legacy-id', metadataIsbn: ISBN }],
});
assert.strictEqual(legacyInvalidIsbnField.get(0).error, 'student_already_borrowed_edition',
  'An invalid legacy edition field must never conceal the valid metadata ISBN');
const skipped = inspectReviewedLoans([{ ...row(0), status: 'skipped' }], {
  students, classes, books: alreadyBorrowed,
});
assert.strictEqual(skipped.size, 0, 'A skipped row must not create or block another loan');

const db = { students: JSON.parse(JSON.stringify(students)), classes: [...classes] };
const copy = { id: 'new-copy', status: 'available', borrowedBy: null, borrowedByClassId: null };
const event = stageReviewedLoan(copy, { type: 'student', id: 's1' }, db);
assert.strictEqual(copy.status, 'borrowed');
assert.strictEqual(copy.borrowedBy, 's1');
assert.strictEqual(copy.borrowedAt, null, 'Never fabricate the historic borrowing date');
assert.strictEqual(copy.dueDate, null);
assert.strictEqual(db.students[0].borrowedBooks[0].bookId, copy.id);
assert.strictEqual(db.students[0].borrowedBooks[0].borrowedAt, null);
assert.strictEqual(event.type, 'loan_imported', 'Historical imports must not count as a new checkout');
assert.strictEqual(event.studentId, 's1');
assert.throws(() => stageReviewedLoan(copy, { type: 'student', id: 's1' }, db),
  /import_loan_copy_unavailable/);
const classCopy = { id: 'class-copy', status: 'available', borrowedBy: null,
  borrowedByClassId: null };
const classEvent = stageReviewedLoan(classCopy, { type: 'class', id: 'c1' }, db);
assert.strictEqual(classCopy.borrowedByClassId, 'c1');
assert.strictEqual(classCopy.borrowedBy, null);
assert.strictEqual(classEvent.classId, 'c1');
assert.strictEqual(db.students[0].borrowedBooks.length, 1,
  'Class loans must not create fictional student borrowing records');
assert.throws(() => stageReviewedLoan({ id: 'x', status: 'available' },
  { type: 'class', id: 'unknown' }, db), /import_loan_borrower_changed/);
// A receipt must remain valid even after its original loan is checked in
// and its corresponding import report and activity log have been rotated away.
const receipt = excelLoanReceiptKey('book-123', { type: 'student', id: 's1' });
assert.match(receipt, /^[a-f0-9]{64}$/);
assert.ok(!receipt.includes('s1') && !receipt.includes('book-123'));
assert.notStrictEqual(receipt, excelLoanReceiptKey('book-123', { type: 'class', id: 's1' }));
assert.strictEqual(excelLoanReceiptKey('', { type: 'student', id: 's1' }), null);
const receiptsDb = {
  bookImportReports: [{ loanChanges: [
    { bookId: 'legacy-copy', borrowerType: 'class', borrowerId: 'c1' },
  ] }],
};
assert.ok(historicalExcelLoanReceipts(receiptsDb).has(
  excelLoanReceiptKey('legacy-copy', { type: 'class', id: 'c1' })));
persistExcelLoanReceipts(receiptsDb, [
  { bookId: 'book-123', borrower: { type: 'student', id: 's1' } },
  { bookId: 'book-123', borrower: { type: 'student', id: 's1' } },
]);
assert.strictEqual(receiptsDb.bookImportLoanReceipts.length, 2,
  'Duplicates collapse and old import reports are permanently backfilled');
receiptsDb.bookImportReports = [];
receiptsDb.history = [];
assert.ok(historicalExcelLoanReceipts(receiptsDb).has(receipt));
assert.ok(historicalExcelLoanReceipts(receiptsDb).has(
  excelLoanReceiptKey('legacy-copy', { type: 'class', id: 'c1' })));
assert.throws(() => persistExcelLoanReceipts(receiptsDb, [
  { bookId: 'book-123', borrower: { type: 'invalid', id: 's1' } },
]), /import_loan_invalid_receipt/);

console.log('PR5 legacy Excel loan migration validation tests passed');
