'use strict';
const assert=require('node:assert/strict');
const {
  normalizeResolutions,buildAssignmentPreview,applyAssignmentPreview,
}=require('../book-import-assignment-reconciliation');
const ISBN='9780306406157';
const copy=(id,barcode,extra={})=>({
  id,title:'Oorlogswinter',author:'Jan Terlouw',metadataIsbn:ISBN,
  barcode,status:'available',borrowedBy:null,borrowedByClassId:null,
  fixedLocation:null,description:'Mooie verrijkte omschrijving',
  coverUrl:'https://example.org/cover.jpg',themes:['Tweede Wereldoorlog'],
  ...extra,
});
const directory=()=>({
  books:[
    copy('copy-1','4711001',{status:'borrowed',borrowedBy:'lisa',
      borrowedAt:'2026-10-03T10:00:00.000Z',dueDate:'2026-10-24'}),
    copy('copy-2','4711002'),
  ],
  students:[
    {id:'lisa',name:'Lisa Leerling',borrowedBooks:[{bookId:'copy-1',
      borrowedAt:'2026-10-03T10:00:00.000Z'}]},
    {id:'tim',name:'Tim Leerling',borrowedBooks:[]},
    {id:'sophie',name:'Sophie Leerling',borrowedBooks:[]},
  ],
  classes:[{id:'a',name:'Klas A'},{id:'b',name:'Klas B'}],
  history:[{id:'historic',type:'check_out',bookId:'copy-1'}],
  readingRecords:[{id:'read-1',finished:true,bookId:'copy-1'}],
  braveEnrichmentJobs:[{id:'keep',state:'complete'}],
});
const row=(index,barcode,context={},extra={})=>({
  index,sourceRowNumber:index+2,status:'ready',
  book:{editionIsbn:ISBN,title:'Oorlogswinter',author:'Jan Terlouw',
    barcode,quantity:{valid:true,value:1},...extra},context,
});
const preview=(db,rows,choices=[])=>buildAssignmentPreview({ok:true,rows},db,choices);
const loanTo=(id,name)=>({studentLoan:{status:'matched',id,name}});
const classLoan=(id,name)=>({classLoan:{status:'matched',id,name}});
const now='2026-11-12T12:00:00.000Z';

let db=directory();
const unchanged=preview(db,[row(0,'4711001',loanTo('lisa','Lisa Leerling'))]);
assert.equal(unchanged.ok,true);
assert.deepEqual(unchanged.differences,[]);
assert.equal(unchanged.summary.readyToApply,false,
  'No differences cannot create a phantom administrative action');

const blank=preview(db,[row(0,'4711001')]);
assert.equal(blank.differences.length,1);
assert.equal(blank.differences[0].kind,'loan');
assert.equal(blank.differences[0].blankSource,true);
assert.equal(blank.differences[0].choice,'pending');
assert.equal(blank.summary.readyToApply,false,'Blank Excel cell may never end an active loan');
assert.equal(normalizeResolutions([{id:'0:loan',action:'delete'}]).ok,false);
const keep=preview(db,[row(0,'4711001')],[{id:'0:loan',action:'keep'}]);
assert.equal(keep.summary.readyToApply,true);
const unchangedSnapshot=JSON.stringify(db);
const keepApplied=applyAssignmentPreview(db,keep,'admin',now);
assert.equal(keepApplied.applied,0);
assert.equal(JSON.stringify(db.books),JSON.stringify(JSON.parse(unchangedSnapshot).books));
assert.deepEqual(db.students,JSON.parse(unchangedSnapshot).students);
assert.deepEqual(db.history,JSON.parse(unchangedSnapshot).history);
assert.deepEqual(db.readingRecords,JSON.parse(unchangedSnapshot).readingRecords);

db=directory();
const correction=preview(db,[row(0,'4711001',loanTo('tim','Tim Leerling'))]);
assert.equal(correction.summary.differences,1);
assert.equal(correction.differences[0].before.id,'lisa');
assert.equal(correction.differences[0].after.id,'tim');
const selected=preview(db,[row(0,'4711001',loanTo('tim','Tim Leerling'))],
  [{id:'0:loan',action:'apply'}]);
assert.equal(selected.summary.readyToApply,true);
const beforeBook={...db.books[0]}, beforeHistory=JSON.stringify(db.history);
const result=applyAssignmentPreview(db,selected,'admin',now);
assert.equal(result.loans,1);
assert.equal(db.books[0].borrowedBy,'tim');
assert.equal(db.books[0].borrowedAt,null,
  'An administrative reassignment cannot inherit Lisa checkout timestamp');
assert.equal(db.books[0].dueDate,null,
  'An administrative reassignment cannot inherit Lisa due date');
assert.equal(db.students[0].borrowedBooks.length,0);
assert.equal(db.students[1].borrowedBooks[0].bookId,'copy-1');
assert.equal(db.students[1].borrowedBooks[0].borrowedAt,null);
for(const field of ['description','coverUrl'])assert.equal(db.books[0][field],beforeBook[field]);
assert.deepEqual(db.books[0].themes,beforeBook.themes);
assert.equal(JSON.stringify(db.history),beforeHistory,
  'Correcting an old mistake must not generate a real checkout or return');
assert.deepEqual(db.readingRecords,[{id:'read-1',finished:true,bookId:'copy-1'}]);
assert.deepEqual(db.braveEnrichmentJobs,[{id:'keep',state:'complete'}]);
assert.equal(db.bookAssignmentCorrectionLog[0].administrativeCorrection,true);
assert.equal(db.bookImportLoanActivityCounters['copy-1'],1);

db=directory();
const completedWrongLoan=preview(db,[row(0,'4711001')],[{id:'0:loan',action:'apply'}]);
assert.equal(completedWrongLoan.summary.readyToApply,true);
applyAssignmentPreview(db,completedWrongLoan,'admin',now);
assert.equal(db.books[0].status,'available');
assert.equal(db.books[0].borrowedBy,null);
assert.deepEqual(db.students[0].borrowedBooks,[]);
assert.equal(db.history.length,1);
assert.equal(db.readingRecords.length,1);
assert.equal(db.bookAssignmentCorrectionLog[0].after.type,'none');

db=directory();
const location=preview(db,[row(0,'4711002',{
  fixedLocation:{status:'resolved',label:'Klas A'},
  studentLoan:null,
})]);
assert.equal(location.differences.length,1);
assert.equal(location.differences[0].kind,'location');
assert.equal(location.differences[0].after,'Klas A');
const locationApprove=preview(db,[row(0,'4711002',{
  fixedLocation:{status:'resolved',label:'Klas A'},
})],[{id:'0:location',action:'apply'}]);
applyAssignmentPreview(db,locationApprove,'admin',now);
assert.equal(db.books[1].fixedLocation,'Klas A');
const emptyLocation=preview(db,[row(0,'4711002')]);
assert.equal(emptyLocation.differences.length,1);
assert.equal(emptyLocation.differences[0].blankSource,true);
assert.equal(emptyLocation.summary.readyToApply,false);
assert.equal(db.books[1].fixedLocation,'Klas A');
const implicitClass=preview(db,[row(0,'4711002',{classContext:['Klas A']})]);
assert.equal(implicitClass.differences[0].kind,'issue');
assert.equal(implicitClass.differences[0].reason,'class_context_requires_classification');

db=directory();
const classChange=preview(db,[row(0,'4711001',classLoan('b','Klas B'))],
  [{id:'0:loan',action:'apply'}]);
applyAssignmentPreview(db,classChange,'admin',now);
assert.equal(db.books[0].borrowedByClassId,'b');
assert.equal(db.books[0].borrowedBy,null);
assert.equal(db.students[0].borrowedBooks.length,0);

db=directory();
const unknown=preview(db,[row(0,'not-in-library',loanTo('tim','Tim Leerling'))]);
assert.equal(unknown.differences[0].kind,'issue');
assert.equal(unknown.differences[0].reason,'physical_copy_not_found');
assert.equal(preview(db,[row(0,'not-in-library',loanTo('tim','Tim Leerling'))],
  [{id:'0:issue',action:'apply'}]).ok,false);
const ambiguous=preview(db,[row(0,'',loanTo('tim','Tim Leerling'))]);
assert.equal(ambiguous.differences[0].reason,'ambiguous_physical_copy');
const duplicate=preview(db,[row(0,'4711001',loanTo('tim','Tim Leerling')),
  row(1,'4711001',loanTo('tim','Tim Leerling'))]);
assert.equal(duplicate.differences.every(x=>x.kind==='issue'),true);
assert.equal(preview(db,[row(0,'4711001')],
  [{id:'15:loan',action:'keep'}]).error,'stale_assignment_choice');

db=directory();
const twoToTim=preview(db,[
  row(0,'4711001',loanTo('tim','Tim Leerling')),
  row(1,'4711002',loanTo('tim','Tim Leerling')),
],[{id:'0:loan',action:'apply'},{id:'1:loan',action:'apply'}]);
assert.equal(twoToTim.error,'duplicate_corrected_student_edition');
const sameEditionAlreadyHeld=directory();
sameEditionAlreadyHeld.students[1].borrowedBooks.push({bookId:'copy-2'});
sameEditionAlreadyHeld.books[1].borrowedBy='tim';
sameEditionAlreadyHeld.books[1].status='borrowed';
const conflict=preview(sameEditionAlreadyHeld,
  [row(0,'4711001',loanTo('tim','Tim Leerling'))],
  [{id:'0:loan',action:'keep'}]);
assert.equal(conflict.differences[0].reason,'student_already_borrowed_edition');
assert.equal(preview(sameEditionAlreadyHeld,
  [row(0,'4711001',loanTo('tim','Tim Leerling'))],
  [{id:'0:loan',action:'apply'}]).error,'unsafe_assignment_choice');

assert.equal(preview(directory(),[]).summary.readyToApply,false);
assert.equal(preview(directory(),[row(0,'4711002')]).summary.differences,0);
console.log('Administrative assignment reconciliation: choices, metadata retention, identity and zero implicit deletions passed');
