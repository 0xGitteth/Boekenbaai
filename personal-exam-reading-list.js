'use strict';

// The personal exam list is independent from stock, loans and check-in history.
const { randomUUID } = require('node:crypto');
const { getEditionKey } = require('./book-edition-identity');
const { mayManageStudent } = require('./book-loan-policy');

const STATUSES = new Set(['nog_lezen', 'aan_het_lezen', 'gelezen']);

function keyForBook(book) {
  if (!book || typeof book !== 'object') return '';
  const edition = getEditionKey(book);
  if (edition) return edition;
  const title = String(book.title || '').normalize('NFKC').trim().toLowerCase();
  const author = String(book.author || '').normalize('NFKC').trim().toLowerCase();
  if (title && author) return 'work||' + JSON.stringify([title, author]);
  return book.id ? 'copy||' + String(book.id) : '';
}

function keyForReading(record) {
  return record.editionKey || keyForBook({
    ...record,
    metadataIsbn: record.isbn || '',
  }) || (record.bookId ? 'copy||' + record.bookId : '');
}

function snapshot(book) {
  const year = Number(book.firstPublishedYear || book.publishedYear || 0);
  const pages = Number(book.pageCount || book.pages || 0);
  return {
    title: String(book.title || 'Onbekend boek').slice(0, 300),
    author: String(book.author || '').slice(0, 300),
    isbn: String(book.editionIsbn || book.metadataIsbn || '').slice(0, 32),
    publishedYear: Number.isInteger(year) && year >= 1000 && year <= 2200 ? year : null,
    pageCount: Number.isInteger(pages) && pages > 0 && pages < 100000 ? pages : null,
    suitableForExamList: book.suitableForExamList === true,
  };
}

function recordsFor(db, studentId, key) {
  return (db.readingRecords || []).filter(record =>
    record.subjectType === 'student' && record.subjectId === studentId &&
    keyForReading(record) === key);
}

function getEntries(db, studentId) {
  return (Array.isArray(db.examReadingLists) ? db.examReadingLists : [])
    .filter(entry => entry.studentId === studentId);
}

function publicEntry(db, entry) {
  const records = recordsFor(db, entry.studentId, entry.editionKey);
  const recordedRead = records.some(record => record.finished === true);
  return {
    id: entry.id,
    bookId: entry.bookId,
    editionKey: entry.editionKey,
    title: entry.title,
    author: entry.author,
    isbn: entry.isbn,
    publishedYear: entry.publishedYear,
    pageCount: entry.pageCount,
    suitableForExamList: entry.suitableForExamList === true,
    status: recordedRead ? 'gelezen' : entry.manualStatus,
    manualStatus: entry.manualStatus,
    readFromReturn: recordedRead,
    addedManually: entry.addedManually === true,
    addedAt: entry.addedAt,
    updatedAt: entry.updatedAt,
    revision: entry.revision || 1,
  };
}

function listForStudent(db, studentId) {
  const entries = getEntries(db, studentId)
    .map(entry => publicEntry(db, entry))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
      String(a.title || '').localeCompare(String(b.title || ''), 'nl'));
  const records = (db.readingRecords || []).filter(record =>
    record.subjectType === 'student' && record.subjectId === studentId);
  const finishedWorks = new Set(records.filter(record => record.finished === true)
    .map(keyForReading).filter(Boolean));
  return {
    entries,
    statistics: {
      readBooks: finishedWorks.size,
      finishedReturns: records.filter(record => record.finished === true).length,
      unfinishedReturns: records.filter(record => record.finished === false).length,
      unknownReturns: 0, // Older returns without an answer are not treated as No.
    },
  };
}

function mayManageExamList(db, user, student) {
  if (!user || !student) return false;
  if (user.role === 'student') return user.id === student.id;
  return mayManageStudent(db, user, student);
}

function ensureList(db) {
  if (!Array.isArray(db.examReadingLists)) db.examReadingLists = [];
  return db.examReadingLists;
}

function addBook(db, studentId, book, actorId, now, manually = true) {
  const key = keyForBook(book);
  if (!key) throw Error('exam_list_book_identity_required');
  const list = ensureList(db);
  let entry = list.find(item => item.studentId === studentId && item.editionKey === key);
  if (entry) {
    if (manually && !entry.addedManually) {
      entry.addedManually = true;
      entry.updatedAt = now;
      entry.updatedBy = actorId;
      entry.revision = (entry.revision || 1) + 1;
    }
    return { entry, created: false };
  }
  entry = {
    id: randomUUID(),
    studentId,
    editionKey: key,
    bookId: String(book.id || book.bookId || ''),
    ...snapshot(book),
    manualStatus: 'nog_lezen',
    addedManually: manually,
    addedAt: now,
    updatedAt: now,
    updatedBy: actorId,
    revision: 1,
  };
  list.push(entry);
  return { entry, created: true };
}

function synchronizeReturn(db, record, now) {
  if (!record || record.subjectType !== 'student' ||
      record.finished !== true || record.suitableForExamList !== true) return null;
  // The confirmed reader is the student, even when staff submitted the return.
  const book = {
    id: record.bookId,
    title: record.title,
    author: record.author,
    metadataIsbn: record.isbn,
    publishedYear: record.publishedYear,
    pageCount: record.pageCount,
    suitableForExamList: true,
  };
  const matchingKey = keyForReading(record);
  const existing = getEntries(db, record.subjectId)
    .find(entry => entry.editionKey === matchingKey);
  if (existing) return existing;
  // Preserve the original edition key from the check-in when present.
  const created = addBook(db, record.subjectId, book, record.reportedBy, now, false);
  if (created.entry.editionKey !== matchingKey && matchingKey) {
    created.entry.editionKey = matchingKey;
  }
  return created.entry;
}

function changeStatus(entry, status, actorId, now) {
  if (!STATUSES.has(status)) throw Error('invalid_exam_reading_status');
  if (entry.manualStatus === status) return false;
  entry.manualStatus = status;
  entry.updatedAt = now;
  entry.updatedBy = actorId;
  entry.revision = (entry.revision || 1) + 1;
  return true;
}

module.exports = {
  STATUSES, keyForBook, keyForReading, snapshot, listForStudent,
  mayManageExamList, publicEntry, getEntries, addBook,
  synchronizeReturn, changeStatus,
};
