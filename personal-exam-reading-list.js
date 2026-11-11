'use strict';

// The personal exam list is independent from stock, loans and check-in history.
const { randomUUID } = require('node:crypto');
const { getEditionKey } = require('./book-edition-identity');
const { mayManageStudent } = require('./book-loan-policy');
const { examReadingAccess } = require('./exam-reading-access');

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

function keyForReading(record, db = null) {
  if (record.editionKey) return record.editionKey;

  // Older records stored the physical copy barcode in "isbn" when a book
  // had no ISBN. That barcode is not reliable edition-level metadata.
  const sameSnapshot = item => item &&
    String(item.title || '').normalize('NFKC').trim().toLowerCase() ===
      String(record.title || '').normalize('NFKC').trim().toLowerCase() &&
    String(item.author || '').normalize('NFKC').trim().toLowerCase() ===
      String(record.author || '').normalize('NFKC').trim().toLowerCase();
  const currentBook = (db?.books || []).find(book =>
    book.id === record.bookId && sameSnapshot(book));
  if (currentBook) return keyForBook(currentBook);

  const priorEntry = (db?.examReadingLists || []).find(entry =>
    entry.bookId === record.bookId && sameSnapshot(entry));
  if (priorEntry) return priorEntry.editionKey;

  // No official ISBN can be proven after that copy is gone. Fall back to
  // the legacy title/author identity rather than guessing from its barcode.
  return keyForBook({ title: record.title, author: record.author }) ||
    (record.bookId ? 'copy||' + record.bookId : '');
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
    keyForReading(record, db) === key);
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
    .map(record => keyForReading(record, db)).filter(Boolean));
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

function addBook(db, studentId, book, actorId, now, manually = true, originalEditionKey = '') {
  const key = originalEditionKey || keyForBook(book);
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
  const student = (db.students || []).find(item => item.id === record.subjectId);
  if (!examReadingAccess(db, student).eligible) return null;
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
  const matchingKey = keyForReading(record, db);
  const existing = getEntries(db, record.subjectId)
    .find(entry => entry.editionKey === matchingKey);
  if (existing) return existing;
  // Use the immutable identity captured at check-in. Reconstructing a book
  // from one ISBN could otherwise merge two different editions and then
  // accidentally rewrite the identity of an existing personal-list entry.
  const result = addBook(db, record.subjectId, book, record.reportedBy, now, false, matchingKey);
  return result.entry;
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
