'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  keyForBook, addBook, synchronizeReturn, listForStudent, changeStatus,
  publicEntry, mayManageExamList, addExternalBook,
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
  classes: [{ id: 'klas-a', name: 'Bovenbouw structuur', teacherIds: ['teacher-a'] },
    { id: 'klas-b', name: 'Onderbouw BKT', teacherIds: ['teacher-b'] }],
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

// Old returns without editionKey put a physical barcode in the "isbn"
// field. Reading status must still match the same title/author identity.
const oldBook = { id: 'legacy-no-isbn', title: 'Boek zonder ISBN',
  author: 'Auteur C', barcode: 'DOK-LOCAL-0008',
  suitableForExamList: true };
db.books.push(oldBook);
const manualLegacy = addBook(db, student.id, oldBook, student.id, now).entry;
const oldRecord = createReturnReadingRecord({
  db, book: oldBook, student, finished: true, actorId: 'teacher-a', now,
});
delete oldRecord.editionKey;
assert.equal(oldRecord.isbn, oldBook.barcode,
  'Legacy record used the copy barcode as its ISBN fallback');
synchronizeReturn(db, oldRecord, now);
assert.equal(publicEntry(db, manualLegacy).readFromReturn, true);
assert.equal(db.examReadingLists.filter(entry =>
  entry.title === oldBook.title).length, 1);
db.books = db.books.filter(book => book.id !== oldBook.id);
assert.equal(publicEntry(db, manualLegacy).readFromReturn, true,
  'Historic reading survives removal of physical copy');



// A private exam title exists without school stock, loan, check-in, or an
// ISBN. Normalized title and author prevent accidental duplicate additions.
const privateDb = { books: [], students:[{id:'solo'}], classes:[],
  examReadingLists:[], readingRecords:[] };
const personal = addExternalBook(privateDb,'solo',{
  title:'  Mijn eigen boek ', author:' Auteur X ', pageCount:251, genre:'Fantasy',
},'solo',now);
assert.equal(personal.created,true);
assert.equal(personal.entry.externalSource,true);
assert.equal(personal.entry.pageCount,251);
assert.equal(personal.entry.suitableForExamList,false);
assert.equal(personal.entry.bookId,'');
assert.equal(privateDb.books.length,0);
assert.equal(addExternalBook(privateDb,'solo',{
  title:'Mijn eigen boek', author:'Auteur X',
},'solo',now).created,false);
assert.equal(listForStudent(privateDb,'solo').entries[0].externalSource,true);
changeStatus(personal.entry,'gelezen','solo',now);
assert.equal(publicEntry(privateDb,personal.entry).status,'gelezen');
changeStatus(personal.entry,'nog_lezen','solo',now);
privateDb.readingRecords.push({
  id:'same-title-return',subjectType:'student',subjectId:'solo',
  editionKey:'isbn13||9780306406157',title:'Mijn eigen boek',author:'Auteur X',finished:true,
});
assert.equal(publicEntry(privateDb,personal.entry).readFromReturn,true,
  'A later real school checkout should confirm the matching private title');
assert.equal(publicEntry(privateDb,personal.entry).status,'gelezen');
const spacedIsbn = addExternalBook(privateDb,'solo',{
  title:'Boek met ISBN',author:'Auteur B',isbn:'978 0 306 40615 7',
},'solo',now);
assert.equal(spacedIsbn.created,true);
assert.equal(spacedIsbn.entry.isbn,'9780306406157',
  'Whitespace-separated valid ISBNs must be accepted');
assert.throws(()=>addExternalBook(privateDb,'solo',{title:'',author:'X'},'solo',now),/titel en auteur/i);
assert.throws(()=>addExternalBook(privateDb,'solo',{title:'X',author:'Y',pageCount:-4},'solo',now),/pagina/i);
assert.throws(()=>addExternalBook(privateDb,'solo',{title:'X',author:'Y',isbn:'1234567890123'},'solo',now),/controlecijfer/i);

const sameTitleDb={books:[],students:[{id:'solo'}],examReadingLists:[],readingRecords:[]};
const bookA=addExternalBook(sameTitleDb,'solo',{
  title:'Dezelfde titel',author:'Auteur',isbn:'9780140328721',
},'solo',now);
const bookB=addExternalBook(sameTitleDb,'solo',{
  title:'Dezelfde titel',author:'Auteur',isbn:'9780306406157',
},'solo',now);
assert.equal(bookA.created,true);
assert.equal(bookB.created,true,'Distinct explicit ISBNs must remain distinct list entries');
sameTitleDb.readingRecords.push({
  subjectType:'student',subjectId:'solo',bookId:'x',title:'Dezelfde titel',
  author:'Auteur',isbn:'9780306406157',editionKey:'isbn13||9780306406157',finished:true,
});
assert.equal(publicEntry(sameTitleDb,bookA.entry).readFromReturn,false,
  'Different explicit ISBN must not mark an external book read');
assert.equal(publicEntry(sameTitleDb,bookB.entry).readFromReturn,true);

const newerBorrowedAt='2026-11-12T07:30:00.000Z';
const periodStudent={...student,borrowedBooks:[{bookId:a.id,borrowedAt:newerBorrowedAt}]};
const periodDb={books:[{...a,borrowedAt:newerBorrowedAt}],students:[periodStudent],
  classes:db.classes,examReadingLists:[],readingRecords:[]};
const periodEntry=addBook(periodDb,'student-a',a,'teacher-a',now).entry;
changeStatus(periodEntry,'aan_het_lezen','teacher-a',now);
periodEntry.autoCurrentLoan=true;
periodEntry.autoLoanBookId=a.id;
periodEntry.autoLoanBorrowedAt=newerBorrowedAt;
const priorReturn={subjectType:'student',subjectId:'student-a',
  bookId:a.id,editionKey:keyForBook(a),title:a.title,author:a.author,
  loanBorrowedAt:'2026-10-12T07:30:00.000Z',reportedBy:'teacher-a',
  suitableForExamList:true,finished:false};
synchronizeReturn(periodDb,priorReturn,now);
assert.equal(periodEntry.autoCurrentLoan,true,
  'Editing an earlier loan must not clear the current automatic reading status');
assert.equal(periodEntry.manualStatus,'aan_het_lezen');
synchronizeReturn(periodDb,{...priorReturn,loanBorrowedAt:newerBorrowedAt},now);
assert.equal(periodEntry.autoCurrentLoan,false);
assert.equal(periodEntry.manualStatus,'nog_lezen',
  'Returning the tracked current period must clear its automatic status');
const serverSource=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
assert.match(serverSource,/autoLoanBookId = book\.id/);
assert.match(serverSource,/autoLoanBorrowedAt = now/);

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
