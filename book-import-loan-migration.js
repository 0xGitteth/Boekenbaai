'use strict';

// A loan column in Excel represents a previously borrowed physical copy.
// Accept only an exact, unique borrower match and one physical copy per row;
// unknown check-out dates must never be invented.
const { matchEntityByName } = require('./book-import-analysis-context');
const { canonicalizeBookIsbn13 } = require('./book-edition-core');

function resolveReviewedLoan(row, { students = [], classes = [] } = {}) {
  const context = row && typeof row === 'object' ? row.context || {} : {};
  const studentLoan = context.studentLoan;
  const classLoan = context.classLoan;
  if (!studentLoan && !classLoan) return { ok: true, borrower: null };
  if (context.excludeFromSchoolCollection || (studentLoan && classLoan)) {
    return { ok: false, error: 'conflicting_loan_context' };
  }
  if (row.book?.quantity?.valid !== true || row.book.quantity.value !== 1) {
    return { ok: false, error: 'loan_requires_single_copy' };
  }
  const desired = studentLoan || classLoan;
  if (desired.status !== 'matched' || !desired.id || typeof desired.name !== 'string') {
    return { ok: false, error: 'loan_borrower_needs_review' };
  }
  const kind = studentLoan ? 'student' : 'class';
  const directory = kind === 'student' ? students : classes;
  const actual = matchEntityByName(desired.name, directory);
  if (actual.status !== 'matched' || actual.matches[0].id !== desired.id) {
    return { ok: false, error: 'loan_borrower_changed' };
  }
  const record = directory.find((entry) => entry && entry.id === desired.id);
  if (!record || (kind === 'student' && (record.active === false || record.status === 'inactive'))) {
    return { ok: false, error: 'loan_borrower_inactive' };
  }
  return { ok: true, borrower: { type: kind, id: desired.id, name: actual.matches[0].name } };
}

function inspectReviewedLoans(rows, {
  students = [], classes = [], books = [], allowExistingLoan = false,
} = {}) {
  const decisions = new Map();
  const oncePerStudentEdition = new Map();
  const storedBooks = new Map(books.map((book) => [book.id, book]));
  for (const row of rows || []) {
    if (!row || row.status === 'skipped') continue;
    const resolution = resolveReviewedLoan(row, { students, classes });
    decisions.set(row.index, resolution);
    if (!resolution.ok || !resolution.borrower || resolution.borrower.type !== 'student') continue;
    const isbn = canonicalizeBookIsbn13(row.book?.editionIsbn);
    if (!isbn) continue;
    const key = JSON.stringify([resolution.borrower.id, isbn]);
    if (oncePerStudentEdition.has(key)) {
      const previous = oncePerStudentEdition.get(key);
      decisions.set(previous, { ok: false, error: 'duplicate_student_loan_in_workbook' });
      decisions.set(row.index, { ok: false, error: 'duplicate_student_loan_in_workbook' });
    } else {
      oncePerStudentEdition.set(key, row.index);
    }
    const student = students.find((person) => person.id === resolution.borrower.id);
    const existing = Array.isArray(student?.borrowedBooks) ? student.borrowedBooks : [];
    const alreadyOwnsEdition = existing.some((loan) => {
      const id = typeof loan === 'string' ? loan : loan?.bookId;
      const book = storedBooks.get(id);
      return book && (canonicalizeBookIsbn13(book.editionIsbn)
        || canonicalizeBookIsbn13(book.metadataIsbn)) === isbn;
    });
    if (alreadyOwnsEdition && !allowExistingLoan) decisions.set(row.index, {
      ok: false, error: 'student_already_borrowed_edition',
    });
  }
  return decisions;
}

function stageReviewedLoan(copy, borrower, db) {
  if (!borrower) return null;
  if (!copy?.id || copy.status === 'borrowed' || copy.borrowedBy || copy.borrowedByClassId) {
    throw Error('import_loan_copy_unavailable');
  }
  if (borrower.type === 'student') {
    const student = (db.students || []).find((entry) => entry.id === borrower.id);
    if (!student || student.active === false || student.status === 'inactive') {
      throw Error('import_loan_borrower_changed');
    }
    const active = Array.isArray(student.borrowedBooks) ? student.borrowedBooks : [];
    const hasExisting = active.some((loan) => (typeof loan === 'string' ? loan : loan?.bookId) === copy.id);
    if (hasExisting) throw Error('import_loan_duplicate');
    if (!Array.isArray(student.borrowedBooks)) student.borrowedBooks = [];
    student.borrowedBooks.push({ bookId: copy.id, borrowedAt: null, source: 'excel_import' });
    copy.borrowedBy = student.id;
    copy.borrowedByClassId = null;
  } else if (borrower.type === 'class') {
    const klass = (db.classes || []).find((entry) => entry.id === borrower.id);
    if (!klass) throw Error('import_loan_borrower_changed');
    copy.borrowedBy = null;
    copy.borrowedByClassId = klass.id;
  } else throw Error('import_loan_invalid_borrower');
  copy.status = 'borrowed';
  copy.borrowedAt = null;
  copy.dueDate = null;
  return { type: 'loan_imported', bookId: copy.id,
    ...(borrower.type === 'student' ? { studentId: borrower.id } : { classId: borrower.id }) };
}

module.exports = { resolveReviewedLoan, inspectReviewedLoans, stageReviewedLoan };
