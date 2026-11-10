'use strict';

const { createHash } = require('node:crypto');
const { canonicalizeBookIsbn13 } = require('./book-edition-isbn-base');

function text(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
}
function workKey(source) {
  const title = text(source?.title);
  const author = text(source?.author);
  if (!title || !author) return '';
  const normalized = title.toLocaleLowerCase('nl-NL') + '\0' +
    author.toLocaleLowerCase('nl-NL');
  return createHash('sha256').update(normalized).digest('hex');
}
function metadataSnapshot(source, { bookId = '' } = {}) {
  return {
    title: text(source.title),
    author: text(source.author),
    isbn: canonicalizeBookIsbn13(
      source.editionIsbn || source.isbn || source.metadataIsbn || source.isbn13 || ''),
    publishedYear: Number.isSafeInteger(Number(source.publishedYear))
      && Number(source.publishedYear) >= 1000
      && Number(source.publishedYear) <= 3000
      ? Number(source.publishedYear) : null,
    pageCount: Number.isSafeInteger(Number(source.pageCount))
      && Number(source.pageCount) > 0 ? Number(source.pageCount) : null,
    bookId: bookId || source.bookId || '',
  };
}
function overrideFor(db, studentId, key) {
  return (db.examReadingListEntries || []).find(row =>
    row.studentId === studentId && row.workKey === key) || null;
}

function studentList(db, studentId) {
  const fromHistory = new Map();
  for (const record of db.readingRecords || []) {
    if (record.subjectType !== 'student' || record.subjectId !== studentId
      || record.suitableForExamList !== true || record.finished !== true) continue;
    const key = workKey(record);
    if (!key) continue;
    const date = String(record.updatedAt || record.reportedAt || '');
    const current = fromHistory.get(key);
    if (!current || date > current.readAt) {
      fromHistory.set(key, {
        workKey: key, ...metadataSnapshot(record),
        readAt: date,
      });
    }
  }

  const keys = new Set(fromHistory.keys());
  for (const row of db.examReadingListEntries || []) {
    if (row.studentId === studentId) keys.add(row.workKey);
  }

  const books = [];
  for (const key of keys) {
    const manual = overrideFor(db, studentId, key);
    if (manual?.excluded) continue;
    const auto = fromHistory.get(key);
    if (!auto && !manual?.manual) continue;
    const source = manual?.manual ? manual : auto;
    books.push({
      workKey: key,
      title: source.title,
      author: source.author,
      isbn: source.isbn || auto?.isbn || '',
      publishedYear: source.publishedYear || auto?.publishedYear || null,
      pageCount: source.pageCount || auto?.pageCount || null,
      bookId: source.bookId || auto?.bookId || '',
      finished: Boolean(auto),
      manuallyAdded: Boolean(manual?.manual),
      automaticallyAdded: Boolean(auto),
      readAt: auto?.readAt || null,
    });
  }
  books.sort((a,b)=>a.author.localeCompare(b.author,'nl',{sensitivity:'base'})
    || a.title.localeCompare(b.title,'nl',{sensitivity:'base'}));
  return {
    books,
    summary: {
      total: books.length,
      finished: books.filter(book => book.finished).length,
      planned: books.filter(book => !book.finished).length,
    },
  };
}

function addToList(db, studentId, book, now) {
  if (book?.suitableForExamList !== true) {
    const error = Error('Dit boek is niet gemarkeerd als examenmateriaal.');
    error.status = 400; throw error;
  }
  const key = workKey(book);
  if (!key) {
    const error = Error('Titel of auteur ontbreekt.');
    error.status = 422; throw error;
  }
  if (!Array.isArray(db.examReadingListEntries)) db.examReadingListEntries = [];
  const snapshot = metadataSnapshot(book, { bookId: book.id });
  const existing = overrideFor(db, studentId, key);
  if (existing) {
    if (existing.manual && !existing.excluded) return { changed: false, workKey: key };
    Object.assign(existing, snapshot, { manual: true, excluded: false, updatedAt: now });
  } else {
    db.examReadingListEntries.push({
      studentId, workKey: key, ...snapshot,
      manual: true, excluded: false, addedAt: now, updatedAt: now,
    });
  }
  return { changed: true, workKey: key };
}

function removeFromList(db, studentId, key, now) {
  if (!/^[a-f0-9]{64}$/.test(key)) {
    const error = Error('Ongeldige boekverwijzing.');
    error.status = 400; throw error;
  }
  const current = studentList(db, studentId).books.find(row => row.workKey === key);
  if (!current) {
    const error = Error('Boek staat niet op je leeslijst.');
    error.status = 404; throw error;
  }
  if (!Array.isArray(db.examReadingListEntries)) db.examReadingListEntries = [];
  const existing = overrideFor(db, studentId, key);
  if (existing) {
    existing.excluded = true;
    existing.manual = false;
    existing.updatedAt = now;
  } else {
    db.examReadingListEntries.push({
      studentId, workKey: key, ...metadataSnapshot(current),
      manual: false, excluded: true, addedAt: now, updatedAt: now,
    });
  }
  return { changed: true };
}

module.exports = { workKey, metadataSnapshot, studentList, addToList, removeFromList };
