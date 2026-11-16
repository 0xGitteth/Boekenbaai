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
    title:'Een boek',addedManually:true},
    {id:'auto',studentId:'s1',bookId:'b1',
      title:'Een boek',addedManually:false}],
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
assert.equal(db.examReadingLists.length,1,
  'A manually added exam title must not disappear during automatic history cleanup');
assert.equal(db.examReadingLists[0].id,'manual');
assert.equal(db.bookLoanHistoryDeletionAudit.length,1);
assert.equal(searchHistory(db,{student:'Leerling A',book:'Een boek'}).length,0);

// Exam entries represent an edition, not the physical copy that first
// created them. Removing a false history must retain another real reading.
{
  const edition='9780306406157';
  const current={
    students:[{id:'s1',name:'Leerling A',borrowedBooks:[]}],
    books:[{id:'a',title:'Oorlogswinter',editionIsbn:edition},
      {id:'b',title:'Oorlogswinter',editionIsbn:edition}],
    history:[{id:'bad',type:'check_out',bookId:'a',
      studentId:'s1',timestamp:'2026-10-12'}],
    bookLoanEvents:[],bookLoanPeriods:[],
    readingRecords:[
      {id:'wrong',subjectType:'student',subjectId:'s1',bookId:'a',finished:true},
      {id:'real',subjectType:'student',subjectId:'s1',bookId:'b',finished:true},
    ],
    examReadingLists:[{id:'exam',studentId:'s1',bookId:'a',
      addedManually:false,title:'Oorlogswinter'}],
  };
  const entry=searchHistory(current,{student:'Leerling A',book:'Oorlogswinter'})
    .find(item=>item.bookId==='a');
  assert.ok(entry);
  const result=removeFalseHistory(current,admin,{
    studentId:'s1',bookId:'a',expectedFingerprint:entry.fingerprint,confirm:true,
  });
  assert.equal(result.ok,true);
  assert.equal(result.examEntriesRemoved,0);
  assert.equal(current.examReadingLists[0].id,'exam');
  assert.deepEqual(current.readingRecords.map(item=>item.id),['real']);
}


// Removing older false history cannot erase an exam-list entry when that
// student currently has the same physical book on loan again.
{
  const isbn='9780306406157';
  const active={
    students:[{id:'s',name:'Student',borrowedBooks:[{bookId:'a'}]}],
    books:[{id:'a',title:'Titel',editionIsbn:isbn,status:'borrowed',borrowedBy:'s'}],
    history:[{id:'old',type:'check_out',bookId:'a',studentId:'s',
      timestamp:'2026-09-01'}],
    bookLoanEvents:[],bookLoanPeriods:[],readingRecords:[],
    examReadingLists:[{id:'exam',studentId:'s',bookId:'a',addedManually:false}],
  };
  const historical=searchHistory(active,{student:'Student'})[0];
  const removed=removeFalseHistory(active,admin,{studentId:'s',bookId:'a',
    expectedFingerprint:historical.fingerprint,confirm:true});
  assert.equal(removed.ok,true);
  assert.equal(removed.examEntriesRemoved,0);
  assert.equal(active.examReadingLists.length,1);
  assert.equal(active.books[0].borrowedBy,'s');
}
// The second copy can have been removed from inventory. Its saved reading
// editionKey still supports keeping the legitimate exam reading entry.
{
  const isbn='9780306406157';
  const active={
    students:[{id:'s',name:'Student',borrowedBooks:[]}],
    books:[{id:'a',title:'Titel',editionIsbn:isbn}],
    history:[{id:'bad',type:'check_out',bookId:'a',studentId:'s',
      timestamp:'2026-09-01'}],
    bookLoanEvents:[],bookLoanPeriods:[],
    readingRecords:[{id:'real',subjectType:'student',subjectId:'s',
      bookId:'deleted-copy',finished:true,editionKey:'isbn13||'+isbn}],
    examReadingLists:[{id:'exam',studentId:'s',bookId:'a',addedManually:false}],
  };
  const historical=searchHistory(active,{student:'Student'})
    .find(item=>item.bookId==='a');
  const removed=removeFalseHistory(active,admin,{studentId:'s',bookId:'a',
    expectedFingerprint:historical.fingerprint,confirm:true});
  assert.equal(removed.ok,true);
  assert.equal(removed.examEntriesRemoved,0);
  assert.equal(active.examReadingLists.length,1);
}


// A deleted original copy is no longer available in the stock table. Its
// edition-wide exam record still identifies the title, so another valid
// completed reading or active loan of that edition must retain the entry.
{
  const isbn='9780306406157';
  const active={
    students:[{id:'s',name:'Student',borrowedBooks:[{bookId:'b'}]}],
    books:[{id:'b',title:'Titel',editionIsbn:isbn,
      status:'borrowed',borrowedBy:'s'}],
    history:[{id:'bad',type:'check_out',bookId:'deleted-a',studentId:'s',
      timestamp:'2026-09-01'}],
    bookLoanEvents:[],bookLoanPeriods:[],
    readingRecords:[{id:'finished-b',subjectType:'student',subjectId:'s',
      bookId:'b',finished:true,editionKey:'isbn13||'+isbn}],
    examReadingLists:[{id:'exam',studentId:'s',bookId:'deleted-a',
      editionKey:'isbn13||'+isbn,addedManually:false}],
  };
  const historical=searchHistory(active,{student:'Student'})
    .find(item=>item.bookId==='deleted-a');
  assert.ok(historical);
  const removed=removeFalseHistory(active,admin,{studentId:'s',
    bookId:'deleted-a',expectedFingerprint:historical.fingerprint,confirm:true});
  assert.equal(removed.ok,true);
  assert.equal(removed.examEntriesRemoved,0);
  assert.equal(active.examReadingLists.length,1);
  assert.equal(active.readingRecords.length,1);
  assert.equal(active.books[0].borrowedBy,'s');
}


// A book without ISBN still has a durable legacy edition identity shared by
// its physical copies. Removing a false A relationship must not remove the
// exam entry while another copy B is being read or has been finished.
{
  const {keyForBook}=require('../personal-exam-reading-list');
  for(const removeOriginalCopy of [false,true]){
    const a={id:'noisbn-a',title:'Zonder ISBN',author:'Auteur',
      barcode:'4711001',status:'available'};
    const b={id:'noisbn-b',title:'Zonder ISBN',author:'Auteur',
      barcode:'4711002',status:'borrowed',borrowedBy:'s'};
    const editionKey=keyForBook(a);
    assert.equal(editionKey,keyForBook(b));
    assert.ok(editionKey.startsWith('legacy||'));
    const current={
      students:[{id:'s',name:'Student',borrowedBooks:[{bookId:'noisbn-b'}]}],
      books:removeOriginalCopy?[b]:[a,b],
      history:[{id:'false-a',type:'check_out',bookId:'noisbn-a',
        studentId:'s',timestamp:'2026-10-01'}],
      bookLoanEvents:[],bookLoanPeriods:[],
      readingRecords:[{id:'true-b',bookId:'noisbn-b',
        subjectType:'student',subjectId:'s',finished:true,
        editionKey,title:b.title,author:b.author}],
      examReadingLists:[{id:'exam-a',studentId:'s',bookId:'noisbn-a',
        title:a.title,author:a.author,editionKey,addedManually:false}],
    };
    const history=searchHistory(current,{student:'Student'})
      .find(item=>item.bookId==='noisbn-a');
    assert.ok(history);
    const result=removeFalseHistory(current,admin,{
      studentId:'s',bookId:'noisbn-a',
      expectedFingerprint:history.fingerprint,confirm:true,
    });
    assert.equal(result.ok,true);
    assert.equal(result.examEntriesRemoved,0);
    assert.equal(current.examReadingLists.length,1);
    assert.equal(current.readingRecords.length,1);
    assert.equal(current.books.find(copy=>copy.id==='noisbn-b').borrowedBy,'s');
  }
}

console.log('Durable circulation history, admin deletion and preservation: OK');
