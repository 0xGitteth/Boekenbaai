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

function isbnIdentity(item) {
  const saved=String(item?.editionKey||'');
  if(/^isbn13\|\|\d{13}$/.test(saved))return saved;
  const key=getEditionKey({metadataIsbn:String(item?.isbn||item?.editionIsbn||item?.metadataIsbn||'')});
  return key?.startsWith('isbn13||')?key:'';
}
function sameTitleAuthorWithoutIsbnConflict(left,right) {
  const normalize=value=>String(value||'').normalize('NFKC').trim()
    .replace(/\s+/g,' ').toLocaleLowerCase('nl-NL');
  const l=isbnIdentity(left),r=isbnIdentity(right);
  return !(l&&r&&l!==r)
    && normalize(left?.title)===normalize(right?.title)
    && normalize(left?.author)===normalize(right?.author);
}

function recordsFor(db, studentId, key, entry = null) {
  return (db.readingRecords || []).filter(record =>
    record.subjectType === 'student' && record.subjectId === studentId &&
    (keyForReading(record, db) === key ||
      (entry?.externalSource === true &&
        sameTitleAuthorWithoutIsbnConflict(entry,record))));
}

function getEntries(db, studentId) {
  return (Array.isArray(db.examReadingLists) ? db.examReadingLists : [])
    .filter(entry => entry.studentId === studentId);
}

function publicEntry(db, entry) {
  const records = recordsFor(db, entry.studentId, entry.editionKey, entry);
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
    externalSource: entry.externalSource === true,
    genre: entry.genre || '',
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


function addExternalBook(db, studentId, input, actorId, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Vul de gegevens van je eigen boek in.');
  }
  const title = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  const author = typeof input.author === 'string' ? input.author.trim().replace(/\s+/g, ' ') : '';
  const rawIsbn = typeof input.isbn === 'string' ? input.isbn.trim() : '';
  const isbn = rawIsbn.replace(/[\s-]/g, '').toUpperCase();
  const genre = typeof input.genre === 'string' ? input.genre.trim().replace(/\s+/g, ' ') : '';
  const rawPages = input.pageCount;
  const pages = rawPages === '' || rawPages === null || rawPages === undefined ? null : Number(rawPages);
  if (!title || !author || title.length > 300 || author.length > 300) {
    throw new Error('Vul een titel en auteur in (maximaal 300 tekens).');
  }
  if (genre.length > 80) throw new Error('Genre mag maximaal 80 tekens bevatten.');
  if (pages !== null && (!Number.isInteger(pages) || pages < 1 || pages > 99999)) {
    throw new Error('Aantal pagina’s moet tussen 1 en 99.999 liggen.');
  }
  if (isbn && !/^(?:[0-9]{13}|[0-9]{9}[0-9X])$/.test(isbn)) {
    throw new Error('Vul een geldig ISBN-10 of ISBN-13 in, of laat dit veld leeg.');
  }
  const book = { title, author, ...(isbn ? { metadataIsbn: isbn } : {}),
    ...(pages ? { pageCount: pages } : {}) };
  if (isbn && !String(getEditionKey(book) || '').startsWith('isbn13||')) {
    throw new Error('Het ISBN heeft een ongeldig controlecijfer.');
  }
  const existing = getEntries(db, studentId).find(entry =>
    sameTitleAuthorWithoutIsbnConflict(entry,{title,author,isbn}));
  if (existing) return { entry: existing, created: false };
  const result = addBook(db, studentId, book, actorId, now);
  if (result.created) {
    result.entry.externalSource = true;
    result.entry.genre = genre;
    result.entry.suitableForExamList = false;
    result.entry.bookId = '';
  }
  return result;
}

function synchronizeReturn(db, record, now) {
  if (!record || record.subjectType !== 'student' || record.suitableForExamList !== true) return null;
  const student = (db.students || []).find(item => item.id === record.subjectId);
  if (!examReadingAccess(db, student).eligible) return null;
  // When a currently loaned exam copy is returned, undo the *automatic*
  // in-progress state. A later correction from Ja to Nee must become
  // "Nog lezen", not incorrectly remain "Aan het lezen".
  const returningKey = keyForReading(record, db);
  const onList = getEntries(db, record.subjectId).find(entry => entry.editionKey === returningKey);
  // A corrected answer from an earlier loan period must not undo a new
  // automatic "Aan het lezen" status for the same edition or same copy.
  const currentLoan=(student.borrowedBooks||[]).find(item=>
    (typeof item==='string'?item:item.bookId)===record.bookId);
  const borrowedAt=typeof currentLoan==='string'
    ? (db.books||[]).find(book=>book.id===record.bookId)?.borrowedAt
    : currentLoan?.borrowedAt;
  const recordedPeriod=Boolean(record.bookId&&record.loanBorrowedAt);
  const sameTrackedPeriod=recordedPeriod&&onList?.autoLoanBookId===record.bookId
    &&onList?.autoLoanBorrowedAt===record.loanBorrowedAt;
  // Legacy markers without a loan-period ID may only be undone at the
  // actual current return, never by changing an earlier reading answer.
  const sameLegacyPeriod=recordedPeriod&&!onList?.autoLoanBookId
    &&!onList?.autoLoanBorrowedAt&&borrowedAt===record.loanBorrowedAt;
  if(onList?.autoCurrentLoan===true&&(sameTrackedPeriod||sameLegacyPeriod)){
    onList.autoCurrentLoan=false;
    delete onList.autoLoanBookId;
    delete onList.autoLoanBorrowedAt;
    if(onList.manualStatus==='aan_het_lezen')
      changeStatus(onList,'nog_lezen',record.reportedBy,now);
  }
  if (record.finished !== true) return null;
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
    .find(entry => entry.editionKey === matchingKey ||
      (entry.externalSource === true &&
        sameTitleAuthorWithoutIsbnConflict(entry,record)));
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
  synchronizeReturn, changeStatus, addExternalBook,
};
