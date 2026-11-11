'use strict';

// Student-only reading overview, built from persisted reading answers and
// current loan records. Old circulation logs are retained only in a bounded
// history: never represent those logs as a guaranteed lifetime total.
const DAY = 86400000;

function safeDate(value) {
  const d = value ? new Date(value) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
}
function safeCover(book) {
  const url = typeof book?.coverUrl === 'string' ? book.coverUrl.trim() : '';
  return /^(https?:\/\/|\/(?!\/))/.test(url) ? url.slice(0, 2048) : '';
}
function tagsFor(book) {
  return Array.isArray(book?.tags)
    ? book.tags.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 80))
    : [];
}
function metadata(book, fallback = {}) {
  const page = Number(fallback.pageCount || book?.pageCount || book?.pages || 0);
  return {
    title: String(fallback.title || book?.title || 'Onbekend boek').slice(0, 300),
    author: String(fallback.author || book?.author || '').slice(0, 300),
    coverUrl: safeCover(book),
    tags: tagsFor(book),
    pageCount: Number.isInteger(page) && page > 0 && page < 100000 ? page : null,
  };
}
function getBorrowedId(loan) {
  return typeof loan === 'string' ? loan : String(loan?.bookId || '');
}
function addWeekdays(target, startText, endText) {
  const start = safeDate(startText);
  const end = safeDate(endText);
  if (!start || !end || end < start) return false;
  let begin = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const finish = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  // Guard against bad dates, accidental extreme historical spans, and large work.
  if ((finish - begin) / DAY > 3650) return false;
  for (; begin <= finish; begin += DAY) {
    const day = new Date(begin).getUTCDay();
    if (day !== 0 && day !== 6) target.add(new Date(begin).toISOString().slice(0, 10));
  }
  return true;
}
function buildStudentReadingProfile(db, studentId, { page = 0, pageSize = 50, now = new Date() } = {}) {
  const student = (db.students || []).find(item => item.id === studentId);
  if (!student) return null;
  const byId = new Map((db.books || []).map(book => [book.id, book]));
  const completed = (db.readingRecords || [])
    .filter(record => record?.subjectType === 'student' && record.subjectId === studentId);
  const entries = [];
  const weekdays = new Set();
  let timedLoans = 0;
  let knownPages = 0;
  let missingPages = 0;
  const distinctReadBooks = new Set();
  const genres = new Map();
  const normalize = text => String(text || '').normalize('NFKC').trim().toLocaleLowerCase('nl-NL');

  for (const record of completed) {
    const book = byId.get(record.bookId);
    const info = metadata(book, record);
    const timestamp = record.loanBorrowedAt || record.reportedAt || '';
    if (addWeekdays(weekdays, record.loanBorrowedAt, record.reportedAt)) timedLoans++;
    entries.push({
      id: record.id, recordId: record.id, bookId: record.bookId || '',
      kind: 'returned', revision: record.revision || 1, finished: record.finished,
      edited: Array.isArray(record.changes) && record.changes.length > 0,
      borrowedAt: record.loanBorrowedAt || null, returnedAt: record.reportedAt || null,
      sortAt: timestamp, ...info,
    });
    if (record.finished === true) {
      const key = normalize(record.title) + '|' + normalize(record.author);
      if (key !== '|') distinctReadBooks.add(key);
      if (info.pageCount !== null) knownPages += info.pageCount;
      else missingPages++;
      for (const tag of info.tags) genres.set(tag, (genres.get(tag) || 0) + 1);
    }
  }
  for (const loan of student.borrowedBooks || []) {
    const bookId = getBorrowedId(loan);
    if (!bookId) continue;
    const book = byId.get(bookId);
    const borrowedAt = typeof loan === 'string' ? book?.borrowedAt : loan.borrowedAt || book?.borrowedAt;
    if (addWeekdays(weekdays, borrowedAt, now)) timedLoans++;
    entries.push({
      id: 'current:' + bookId, recordId: null, bookId, kind: 'current',
      borrowedAt: borrowedAt || null, returnedAt: null,
      sortAt: borrowedAt || now.toISOString(), ...metadata(book),
    });
  }
  // Historic checkout without a saved Ja/Nee record: keep it visible as
  // "Niet geregistreerd". Match records by loan start and exact copy ID
  // so completed periods are not incorrectly shown twice.
  const checkouts = (db.history || []).filter(x =>
    x && x.studentId === studentId && x.type === 'check_out' && x.bookId);
  for (const log of checkouts) {
    const known = entries.some(entry => entry.bookId === log.bookId &&
      entry.borrowedAt && safeDate(entry.borrowedAt) && safeDate(log.timestamp) &&
      Math.abs(new Date(entry.borrowedAt).getTime() - new Date(log.timestamp).getTime()) <= 120000);
    if (known) continue;
    const book = byId.get(log.bookId);
    entries.push({
      id: 'legacy:' + log.id, recordId: null, bookId: log.bookId, kind: 'legacy',
      borrowedAt: log.timestamp || null, returnedAt: null,
      sortAt: log.timestamp || '', ...metadata(book),
    });
  }
  entries.sort((a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')) ||
    String(a.id).localeCompare(String(b.id)));

  const genreRanking = Array.from(genres.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'nl'));
  const currentPage = Number.isInteger(page) && page >= 0 ? page : 0;
  const size = Math.max(1, Math.min(50, Number(pageSize) || 50));
  return {
    recent: entries.slice(0, 4),
    history: entries.slice(currentPage * size, (currentPage + 1) * size),
    nextPage: (currentPage + 1) * size < entries.length ? currentPage + 1 : null,
    statistics: {
      registeredLoanPeriods: entries.length,
      readTitles: distinctReadBooks.size,
      readPagesKnown: knownPages,
      booksMissingPageCount: missingPages,
      topGenres: genreRanking.slice(0, 5),
      weekdaysWithLoans: weekdays.size,
      periodsWithKnownDates: timedLoans,
      totalPeriodsWithDates: completed.length + (student.borrowedBooks || []).length,
      historyMayBeIncomplete: true,
    },
  };
}
module.exports = { buildStudentReadingProfile, addWeekdays, safeCover };
