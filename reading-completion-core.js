'use strict';

// Reading completion is an explicit answer at a physical return, not an
// inference from a checkout, a returned book, or a class-level circulation.
// Keep an immutable book snapshot to survive a later inventory replacement.
const { randomUUID } = require('node:crypto');
const { mayManageClass, mayManageStudent } = require('./book-loan-policy');

function createReturnReadingRecord({ db, book, student = null, klass = null, finished, actorId, now }) {
  if (typeof finished !== 'boolean') throw Error('reading_answer_required');
  if (!book?.id || (!student && !klass) || (student && klass)) throw Error('invalid_reading_scope');
  if (!Array.isArray(db.readingRecords)) db.readingRecords = [];
  const subjectType = student ? 'student' : 'class';
  const subjectId = student?.id || klass.id;
  const record = {
    id: randomUUID(),
    bookId: book.id,
    title: String(book.title || 'Onbekend boek'),
    author: String(book.author || ''),
    isbn: String(book.metadataIsbn || book.editionIsbn || book.barcode || ''),
    suitableForExamList: book.suitableForExamList === true,
    subjectType,
    subjectId,
    loanBorrowedAt: book.borrowedAt || null,
    finished,
    reportedAt: now,
    updatedAt: now,
    revision: 1,
    reportedBy: actorId,
    updatedBy: actorId,
    changes: [],
  };
  db.readingRecords.push(record);
  return record;
}

function mayViewReadingRecord(db, user, record) {
  if (!user || !record || !['student', 'class'].includes(record.subjectType)) return false;
  if (user.role === 'admin') return true;
  if (record.subjectType === 'student') {
    if (user.role === 'student') return record.subjectId === user.id;
    return mayManageStudent(db, user, (db.students || [])
      .find(student => student.id === record.subjectId));
  }
  return user.role === 'teacher' && mayManageClass(db, user, record.subjectId);
}

function publicReadingRecord(db, record, user) {
  const isStudent = record.subjectType === 'student';
  const subject = isStudent
    ? (db.students || []).find(item => item.id === record.subjectId)
    : (db.classes || []).find(item => item.id === record.subjectId);
  return {
    id: record.id,
    bookId: record.bookId,
    title: record.title,
    author: record.author,
    isbn: record.isbn,
    suitableForExamList: record.suitableForExamList === true,
    subjectType: record.subjectType,
    subjectId: user.role === 'student' ? undefined : record.subjectId,
    subjectName: user.role === 'student' ? undefined : (subject?.name || 'Niet meer aanwezig'),
    finished: record.finished,
    reportedAt: record.reportedAt,
    updatedAt: record.updatedAt,
    revision: record.revision || 1,
  };
}

function amendReadingRecord(record, finished, actorId, now) {
  if (typeof finished !== 'boolean') throw Error('reading_answer_required');
  if (record.finished === finished) return false;
  const previous = record.finished;
  if (!Array.isArray(record.changes)) record.changes = [];
  record.changes.push({
    previous, finished, changedBy: actorId, changedAt: now,
  });
  record.finished = finished;
  record.updatedAt = now;
  record.updatedBy = actorId;
  record.revision = (record.revision || 1) + 1;
  return true;
}

module.exports = {
  createReturnReadingRecord, mayViewReadingRecord,
  publicReadingRecord, amendReadingRecord,
};
