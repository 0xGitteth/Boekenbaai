'use strict';
const assert=require('node:assert/strict');
const {appendDurableLoanEvent,borrowEvents,borrowCountEvents,
  searchHistory,removeFalseHistory,listCurrentLoans,removeFalseCurrentLoan}=
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


// Teachers may correct only history of pupils in their *current* class.
{
  const scoped={
    classes:[
      {id:'class-a',teacherIds:['mentor-a'],studentIds:['sa']},
      {id:'class-b',teacherIds:['mentor-b'],studentIds:['sb']},
    ],
    students:[
      {id:'sa',name:'Leerling A',borrowedBooks:[],classIds:['class-b']},
      {id:'sb',name:'Leerling B',borrowedBooks:[],classIds:['class-b']},
    ],
    books:[{id:'a',title:'Boek A'},{id:'b',title:'Boek B'}],
    history:[
      {id:'ha',type:'check_out',bookId:'a',studentId:'sa'},
      {id:'hb',type:'check_out',bookId:'b',studentId:'sb'},
    ],
    bookLoanEvents:[],bookLoanPeriods:[],readingRecords:[],examReadingLists:[],
  };
  const mentorA={role:'teacher',id:'mentor-a'};
  const mentorB={role:'teacher',id:'mentor-b'};
  const own=searchHistory(scoped,{actor:mentorA});
  assert.deepEqual(own.map(item=>item.studentId),['sa'],
    'The current class roster wins over a stale student.classIds array');
  assert.deepEqual(searchHistory(scoped,{actor:mentorB}).map(item=>item.studentId),['sb']);
  assert.equal(searchHistory(scoped,{actor:{role:'admin',id:'admin'}}).length,2);
  const forbidden=removeFalseHistory(scoped,mentorA,{
    studentId:'sb',bookId:'b',expectedFingerprint:searchHistory(scoped)
      .find(item=>item.bookId==='b').fingerprint,confirm:true});
  assert.equal(forbidden.error,'forbidden');
  assert.equal(scoped.history.length,2,'An unauthorized attempt changes nothing');
  const removed=removeFalseHistory(scoped,mentorA,{
    studentId:'sa',bookId:'a',expectedFingerprint:own[0].fingerprint,confirm:true});
  assert.equal(removed.ok,true);
  assert.equal(scoped.history.length,1);
  assert.equal(scoped.history[0].studentId,'sb');
  assert.equal(scoped.bookLoanHistoryDeletionAudit[0].performedBy,'mentor-a');
  // Permission revocation must immediately revoke access.
  scoped.classes[0].teacherIds=[];
  assert.deepEqual(searchHistory(scoped,{actor:mentorA}),[]);
  assert.equal(removeFalseHistory(scoped,mentorA,{
    studentId:'sa',bookId:'a',expectedFingerprint:own[0].fingerprint,confirm:true,
  }).error,'forbidden');
}

// The real Dex scenario: two different titles and physical ISBNs are both
// actively linked. Cancelling the wrong title must not pretend a return
// happened, delete reading records or alter either legitimate active loan.
{
  const wrong={id:'pizzamaffia-a',title:'Pizzamaffia',
    barcode:'9789048849468',status:'borrowed',borrowedBy:'dex',
    borrowedByClassId:null,borrowedAt:'2026-11-10'};
  const right={id:'slaat-door',title:'Pizzamaffia slaat door',
    barcode:'9789048848447',status:'borrowed',borrowedBy:'dex',
    borrowedByClassId:null,borrowedAt:'2026-11-11'};
  const other={id:'stamppot',title:'Stamppot met kogels',
    status:'borrowed',borrowedBy:'dex'};
  const original={
    books:[wrong,right,other],
    students:[{id:'dex',name:'Dex Rombouts',borrowedBooks:[
      {bookId:wrong.id},{bookId:right.id},{bookId:other.id}]}],
    classes:[],history:[{id:'original-checkout',type:'check_out',
      bookId:wrong.id,studentId:'dex'}],
    bookLoanEvents:[],bookLoanPeriods:[],
    readingRecords:[{id:'finished-correct',subjectType:'student',
      subjectId:'dex',bookId:right.id,finished:true}],
  };
  const beforeHistory=JSON.stringify(original.history);
  const beforeReadings=JSON.stringify(original.readingRecords);
  const find=listCurrentLoans(original,{borrower:'Dex',book:'Pizzamaffia'});
  const wrongEntry=find.find(item=>item.bookId===wrong.id);
  assert.ok(wrongEntry);
  assert.equal(removeFalseCurrentLoan(original,{role:'teacher',id:'mentor'},{
    bookId:wrong.id,borrowerId:'dex',borrowerType:'student',
    expectedFingerprint:wrongEntry.fingerprint,confirm:true,
  }).error,'forbidden');
  assert.equal(removeFalseCurrentLoan(original,admin,{
    bookId:wrong.id,borrowerId:'dex',borrowerType:'student',
    expectedFingerprint:'old',confirm:true,
  }).error,'loan_changed');
  const removed=removeFalseCurrentLoan(original,admin,{
    bookId:wrong.id,borrowerId:'dex',borrowerType:'student',
    expectedFingerprint:wrongEntry.fingerprint,confirm:true,
  });
  assert.equal(removed.ok,true);
  assert.equal(wrong.status,'available');
  assert.equal(wrong.borrowedBy,null);
  assert.deepEqual(original.students[0].borrowedBooks.map(item=>item.bookId),
    [right.id,other.id]);
  assert.equal(right.status,'borrowed');
  assert.equal(other.status,'borrowed');
  assert.equal(JSON.stringify(original.history),beforeHistory);
  assert.equal(JSON.stringify(original.readingRecords),beforeReadings);
  assert.equal(original.bookLoanCurrentCorrectionAudit.length,1);
  assert.equal(original.history.filter(item=>item.type==='check_in').length,0);
}

// Both corrective actions must be visible as DIFFERENT workflows in the
// same staff lending area, including the exact physical ID and confirmation.
{
  const fs=require('node:fs'),path=require('node:path');
  const ui=fs.readFileSync(path.join(__dirname,'..',
    'public/admin-loan-history.js'),'utf8');
  assert.match(ui,/Foutieve actuele uitlening corrigeren/);
  assert.match(ui,/Foutieve leenhistorie corrigeren/);
  assert.match(ui,/Exemplaar-ID: /);
  assert.match(ui,/expectedFingerprint:loan\.fingerprint,confirm:true/);
  assert.match(ui,/activeLoanRemoved/);
  assert.match(ui,/boekenbaai:staff-refresh/);
  assert.match(ui,/currentSection\.hidden/);
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/user\.role!=='admin'/);
  assert.match(server,/limit:100,actor:user/);
}

console.log('Durable circulation history, admin deletion and preservation: OK');
