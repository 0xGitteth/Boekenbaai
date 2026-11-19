'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {candidate,listCandidates,correctContinuousLoan}=
  require('../book-loan-event-correction');

const originalAt='2026-11-16T09:00:00.000Z';
const returnedAt='2026-11-18T09:31:00.000Z';
const reissuedAt='2026-11-18T13:22:00.000Z';
const admin={role:'admin',id:'beheer'};
function fixture(){
  const a={id:'loan-a',type:'check_out',bookId:'copy-a',studentId:'dex',
    timestamp:originalAt};
  const b={id:'return-b',type:'check_in',bookId:'copy-a',studentId:'dex',
    timestamp:returnedAt};
  const c={id:'loan-c',type:'check_out',bookId:'copy-a',studentId:'dex',
    timestamp:reissuedAt};
  return {
    users:[admin],
    books:[
      {id:'copy-a',title:'Pizzamaffia slaat door',barcode:'9789048848447',
        status:'borrowed',borrowedBy:'dex',borrowedByClassId:null,
        borrowedAt:reissuedAt,dueDate:'2026-12-12'},
      {id:'copy-b',title:'Stamppot met kogels',status:'borrowed',
        borrowedBy:'dex',borrowedAt:originalAt},
      {id:'copy-same-isbn',title:'Pizzamaffia slaat door',
        barcode:'9789048848447',status:'available'},
    ],
    students:[{id:'dex',name:'Dex Rombouts',borrowedBooks:[
      {bookId:'copy-a',borrowedAt:reissuedAt,dueDate:'2026-12-12'},
      {bookId:'copy-b',borrowedAt:originalAt},
    ]}],
    history:[c,b],
    bookLoanEvents:[a,b,c],
    bookLoanPeriods:[],
    readingRecords:[{id:'read-b',subjectType:'student',subjectId:'dex',
      bookId:'copy-a',finished:true,reportedAt:returnedAt,
      loanBorrowedAt:originalAt,revision:1,changes:[]}],
    examReadingLists:[{id:'exam',studentId:'dex',bookId:'copy-a',
      manualStatus:'aan_het_lezen',autoCurrentLoan:true,
      autoLoanBookId:'copy-a',autoLoanBorrowedAt:reissuedAt,revision:3,
      addedManually:false}],
  };
}
const confirm=found=>({studentId:'dex',bookId:'copy-a',
  expectedFingerprint:found.fingerprint,
  reason:'false_return_and_recheckout',confirm:true});
const db=fixture();
const found=candidate(db,'dex','copy-a');
assert.ok(found,'A confirmed 3-event same-copy sequence should be identified');
assert.equal(found.incorrectReturnId,'return-b');
assert.equal(found.recheckoutId,'loan-c');
assert.equal(listCandidates(db,{borrower:'Dex',book:'Pizzamaffia'}).length,1);
let before=JSON.stringify(db);
assert.equal(correctContinuousLoan(db,{role:'teacher',id:'t'},confirm(found)).error,'forbidden');
assert.equal(correctContinuousLoan(db,admin,{...confirm(found),confirm:false}).error,'invalid_request');
assert.equal(correctContinuousLoan(db,admin,{...confirm(found),expectedFingerprint:'stale'}).error,
  'changed_or_ambiguous');
assert.equal(JSON.stringify(db),before,'Rejected operations must leave all data unchanged');
const fixed=correctContinuousLoan(db,admin,confirm(found));
assert.equal(fixed.ok,true);
assert.equal(fixed.removedEvents,2);
assert.equal(db.books[0].status,'borrowed');
assert.equal(db.books[0].borrowedBy,'dex');
assert.equal(db.books[0].borrowedAt,originalAt);
assert.equal(db.books[0].dueDate,'2026-12-12');
assert.equal(db.students[0].borrowedBooks[0].borrowedAt,originalAt);
assert.deepEqual(db.students[0].borrowedBooks.map(x=>x.bookId),['copy-a','copy-b']);
assert.deepEqual(db.bookLoanEvents.map(x=>x.id),['loan-a']);
assert.equal(db.history.length,0);
assert.equal(db.readingRecords.length,0);
assert.equal(db.examReadingLists[0].autoLoanBorrowedAt,originalAt);
assert.equal(db.examReadingLists[0].manualStatus,'aan_het_lezen');
assert.equal(db.bookLoanEventCorrectionAudit.length,1);
assert.equal(db.bookLoanEventCorrectionAudit[0].removedReadingRecordId,'read-b');
assert.equal(db.bookImportLoanActivityCounters['copy-a'],1);
assert.equal(candidate(db,'dex','copy-a'),null,'Cannot repeat correction');
assert.equal(correctContinuousLoan(db,admin,confirm(found)).error,'changed_or_ambiguous');
assert.equal(db.books[2].status,'available','Same ISBN does not mean same physical copy');

function reject(change,reason){
  const target=fixture();
  change(target);
  const before=JSON.stringify(target);
  assert.equal(candidate(target,'dex','copy-a'),null,reason);
  assert.equal(JSON.stringify(target),before,'A failed preview must be read-only');
}
reject(d=>d.books.push({...d.books[0]}),'Duplicate physical ID');
reject(d=>d.students.push({id:'other',borrowedBooks:[{bookId:'copy-a',borrowedAt:reissuedAt}]}),
  'Another pupil claims the physical copy');
reject(d=>{d.books[0].borrowedBy='other';},'Wrong live borrower');
reject(d=>{d.books[0].status='available';},'Not currently borrowed');
reject(d=>{d.books[0].borrowedAt=originalAt;},'Live checkout no longer matches');
reject(d=>{d.bookLoanEvents[2].studentId='other';},'Recheckout of different pupil');
reject(d=>{d.readingRecords[0].revision=2;},'Edited reading must be retained');
reject(d=>{d.readingRecords.push({...d.readingRecords[0],id:'second'});},'Ambiguous reading record');
reject(d=>{d.readingRecords[0].loanBorrowedAt=reissuedAt;},'Reading references another loan');
reject(d=>{d.bookLoanPeriods.push({id:'p',studentId:'dex',bookId:'copy-a',
  borrowedAt:originalAt,returnedAt:returnedAt});},'Imported period may be genuine');
reject(d=>{d.bookLoanEvents.push({id:'extra',bookId:'copy-a',type:'check_in',
  studentId:'dex',timestamp:'2026-11-18T14:00:00.000Z'});},
'Later loan activity must stop a replay');
reject(d=>{d.examReadingLists[0].autoLoanBorrowedAt=originalAt;},
  'Unrelated exam current-period marker');

// Older Excel loan imports may have retained only the return's immutable
// loanBorrowedAt field rather than a check_out event. It is sufficient evidence
// for the original start date without fabricating a historical checkout.
{
  const imported=fixture();
  imported.bookLoanEvents=imported.bookLoanEvents.filter(x=>x.id!=='loan-a');
  const original=JSON.stringify(imported);
  const choices=listCandidates(imported,{borrower:'Dex',book:'Pizzamaffia slaat door'});
  assert.equal(choices.length,1);
  assert.equal(choices[0].canCorrect,true);
  assert.equal(choices[0].originalCheckoutLogged,false);
  assert.equal(JSON.stringify(imported),original,'Diagnosis must be strictly read-only');
  assert.equal(correctContinuousLoan(imported,admin,confirm(choices[0])).ok,true);
  assert.equal(imported.books[0].borrowedAt,originalAt);
  assert.equal(imported.bookLoanEvents.length,0,
    'The correction must not invent a missing historical checkout');
}
{
  const unknown=fixture();
  unknown.bookLoanEvents=unknown.bookLoanEvents.filter(x=>x.id!=='loan-a');
  unknown.readingRecords[0].loanBorrowedAt=null;
  const items=listCandidates(unknown,{borrower:'Dex',book:'Pizzamaffia'});
  assert.equal(items.length,1);
  assert.equal(items[0].canCorrect,false);
  assert.equal(items[0].reason,'original_unknown');
  assert.match(items[0].errorMessage,/oorspronkelijke uitleendatum/);
}
{
  const changed=fixture();
  changed.readingRecords[0].revision=2;
  const items=listCandidates(changed,{borrower:'Dex',book:'Pizzamaffia'});
  assert.equal(items[0].canCorrect,false);
  assert.equal(items[0].reason,'reading_changed');
}
{
  const occupied=fixture();
  occupied.students.push({id:'another',borrowedBooks:[
    {bookId:'copy-a',borrowedAt:reissuedAt}]});
  assert.equal(listCandidates(occupied,{borrower:'Dex'})[0].reason,
    'borrower_conflict');
}
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','public/admin-loan-history.js'),'utf8');
assert.match(server,/loanHistoryRoot\+'\/continuity\/correct'/);
assert.match(server,/correctContinuousLoan\(latest,administrator,body\)/);
assert.match(server,/await mutateJsonLockedAsync\(/);
assert.match(ui,/Foutieve inlevering en heruitlening corrigeren/);
assert.match(ui,/originalLoanStillActive/);
assert.match(ui,/expectedFingerprint:item\.fingerprint/);
console.log('Targeted false-return and recheckout correction: OK');
