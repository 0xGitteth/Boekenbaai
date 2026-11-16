'use strict';
const assert=require('node:assert/strict');
const {appendDurableLoanEvent,borrowEvents,borrowCountEvents,
  searchHistory,removeFalseHistory}=
  require('../book-loan-history-admin');
const admin={role:'admin',id:'beheer'};
const db={
  students:[{id:'s1',name:'Leerling A',
    borrowedBooks:[{bookId:'b2',borrowedAt:'2026-11-10'}]}],
  books:[{id:'b1',title:'Een boek',author:'A'},
    {id:'b2',title:'Ander boek',author:'B'}],
  history:[
    {id:'h1',type:'check_out',bookId:'b1',studentId:'s1',
      timestamp:'2026-10-12'},
  ],
  bookLoanEvents:[],
  bookLoanPeriods:[{id:'p1',bookId:'b1',studentId:'s1',
    borrowedAt:'2026-10-12',returnedAt:'2026-10-15'}],
  readingRecords:[{id:'r1',subjectType:'student',subjectId:'s1',
    bookId:'b1',finished:true},
    {id:'r2',subjectType:'student',subjectId:'s1',
      bookId:'b2',finished:true}],
  examReadingLists:[{id:'manual',studentId:'s1',bookId:'b1',
    title:'Een boek',addedManually:true}],
};
assert.equal(appendDurableLoanEvent(db,db.history[0]),true);
assert.equal(borrowCountEvents(db).filter(x=>x.type==='check_out').length,1,
  'A preserved historical interval matching a logged checkout counts once');
assert.equal(appendDurableLoanEvent(db,db.history[0]),false);
assert.equal(borrowEvents(db).filter(x=>x.id==='h1').length,1);
const candidates=searchHistory(db,{student:'leerling',book:'een'});
assert.equal(candidates.length,1);
assert.equal(candidates[0].importedPeriods,1);
assert.equal(removeFalseHistory(db,{role:'teacher',id:'t'},{
  studentId:'s1',bookId:'b1',expectedFingerprint:candidates[0].fingerprint,
  confirm:true}).ok,false);
assert.equal(removeFalseHistory(db,admin,{
  studentId:'s1',bookId:'b1',expectedFingerprint:'stale',confirm:true
}).error,'history_changed');
const cleaned=removeFalseHistory(db,admin,{
  studentId:'s1',bookId:'b1',expectedFingerprint:candidates[0].fingerprint,
  confirm:true,
});
assert.equal(cleaned.ok,true);
assert.equal(cleaned.eventsRemoved,1);
assert.equal(cleaned.readingRecordsRemoved,1);
assert.equal(cleaned.importedPeriodsRemoved,1);
assert.equal(cleaned.examEntriesRemoved,1);
assert.equal(db.bookLoanEvents.length,0);
assert.equal(db.history.length,0);
assert.equal(db.bookLoanPeriods.length,0);
assert.equal(db.readingRecords.length,1);
assert.equal(db.students[0].borrowedBooks[0].bookId,'b2');
assert.equal(db.examReadingLists.length,0,
  'An explicitly deleted student-copy relationship includes its exam list entry');
assert.equal(db.bookLoanHistoryDeletionAudit.length,1);
assert.equal(searchHistory(db,{student:'Leerling A',book:'Een boek'}).length,0);
console.log('Durable circulation history, admin deletion and preservation: OK');
