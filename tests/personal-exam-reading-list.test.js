'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  keyForBook, addBook, synchronizeReturn, listForStudent, changeStatus,
  publicEntry, mayManageExamList,
} = require('../personal-exam-reading-list');
const { createReturnReadingRecord, amendReadingRecord } = require('../reading-completion-core');

const now = '2026-11-11T09:00:00.000Z';
const a = { id: 'copy-a', title: 'Proefboek', author: 'A Auteur',
  metadataIsbn: '9780306406157', pageCount: 220, suitableForExamList: true };
const b = { ...a, id: 'copy-b' };
const db = {
  books: [a, b], students: [
    { id: 'student-a', classIds: ['klas-a'] },
    { id: 'student-b', classIds: ['klas-b'] },
  ],
  classes: [{ id: 'klas-a', teacherIds: ['teacher-a'] },
    { id: 'klas-b', teacherIds: ['teacher-b'] }],
  examReadingLists: [], readingRecords: [],
};
const student = db.students[0];
assert.equal(keyForBook(a), keyForBook(b), 'Copies of same edition share a key');
assert.equal(mayManageExamList(db, { id: 'student-a', role: 'student' }, student), true);
assert.equal(mayManageExamList(db, { id: 'student-b', role: 'student' }, student), false);
assert.equal(mayManageExamList(db, { id: 'teacher-b', role: 'teacher' }, student), false);
assert.equal(mayManageExamList(db, { id: 'teacher-a', role: 'teacher' }, student), true);
assert.equal(mayManageExamList(db, { id: 'admin', role: 'admin' }, student), true);

let result = addBook(db, 'student-a', a, 'student-a', now);
assert.equal(result.created, true);
const id = result.entry.id;
result = addBook(db, 'student-a', b, 'student-a', now);
assert.equal(result.created, false);
assert.equal(result.entry.id, id);
assert.equal(db.examReadingLists.length, 1, 'No duplicate for same ISBN');
assert.equal(listForStudent(db, 'student-b').entries.length, 0, 'Student isolation');

const no = createReturnReadingRecord({
  db, book: a, student, finished: false, actorId: 'teacher-a', now,
});
assert.equal(synchronizeReturn(db, no, now), null);
assert.equal(listForStudent(db, student.id).statistics.readBooks, 0);
assert.equal(listForStudent(db, student.id).statistics.unfinishedReturns, 1);
assert.equal(publicEntry(db, result.entry).status, 'nog_lezen');

amendReadingRecord(no, true, 'student-a', now);
synchronizeReturn(db, no, now);
assert.equal(db.examReadingLists.length, 1);
assert.equal(publicEntry(db, result.entry).status, 'gelezen');
assert.equal(listForStudent(db, student.id).statistics.readBooks, 1);
amendReadingRecord(no, false, 'student-a', now);
synchronizeReturn(db, no, now);
assert.equal(publicEntry(db, result.entry).readFromReturn, false);
assert.equal(publicEntry(db, result.entry).status, 'nog_lezen');
assert.equal(listForStudent(db, student.id).statistics.readBooks, 0);
assert.equal(listForStudent(db, student.id).statistics.unfinishedReturns, 1);

changeStatus(result.entry, 'aan_het_lezen', 'student-a', now);
assert.equal(publicEntry(db, result.entry).status, 'aan_het_lezen');
changeStatus(result.entry, 'gelezen', 'student-a', now);
assert.equal(publicEntry(db, result.entry).status, 'gelezen');
assert.equal(listForStudent(db, student.id).statistics.readBooks, 0,
  'Manual list progress must not fabricate a confirmed return');

const otherBook = { ...a, id: 'copy-c', title: 'Tweede boek', metadataIsbn: '9780140328721' };
const yes = createReturnReadingRecord({
  db, book: otherBook, student, finished: true, actorId: 'teacher-a', now,
});
synchronizeReturn(db, yes, now);
assert.equal(db.examReadingLists.length, 2, 'Automatic addition on a confirmed return');
assert.equal(db.examReadingLists[1].addedManually, false);
assert.equal(publicEntry(db, db.examReadingLists[1]).readFromReturn, true);
assert.equal(db.readingRecords.length, 2, 'Circulation audit history is intact');

// Conflicting official ISBN fields must never merge two distinct editions
// or overwrite the stable key of an existing manual list item.
const originalKey = result.entry.editionKey;
const conflictBook = { id: 'copy-conflict', title: 'Andere titel',
  author: 'Andere auteur', metadataIsbn: a.metadataIsbn,
  editionIsbn: otherBook.metadataIsbn, suitableForExamList: true };
const conflict = createReturnReadingRecord({
  db, book: conflictBook, student, finished: true,
  actorId: 'teacher-a', now,
});
assert.notEqual(conflict.editionKey, originalKey);
synchronizeReturn(db, conflict, now);
assert.equal(db.examReadingLists.length, 3);
assert.equal(result.entry.editionKey, originalKey,
  'Existing ISBN A entry must keep its original identity');
assert.ok(db.examReadingLists.some(item =>
  item.title === 'Andere titel' && item.editionKey === conflict.editionKey));
assert.equal(publicEntry(db, result.entry).readFromReturn, false,
  'Conflicting return must not mark existing ISBN A title as read');


for (const name of ['server.js', 'public/personal-exam-reading-list.js']) {
  execFileSync(process.execPath, ['--check', path.join(__dirname, '..', name)], { stdio: 'pipe' });
}
const index = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const vite = fs.readFileSync(path.join(__dirname, '../vite.config.js'), 'utf8');
assert.match(index, /id="student-exam-reading-list"/);
assert.match(index, /id="student-book-detail-exam-add"/);
assert.match(index, /personal-exam-reading-list\.js/);
assert.match(vite, /'personal-exam-reading-list\.js'/);
assert.match(vite, /'personal-exam-reading-list\.css'/);
console.log('Personal exam list model and UI wiring: OK');
