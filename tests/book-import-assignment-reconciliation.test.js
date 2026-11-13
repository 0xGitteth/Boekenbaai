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
assert.equal(blank.differences.length,0,
  'A blank Excel borrower must never imply an administrative return');
assert.equal(blank.summary.readyToApply,false);
assert.equal(normalizeResolutions([{id:'0:loan',action:'delete'}]).ok,false);
assert.equal(preview(db,[row(0,'4711001')],[{id:'0:loan',action:'keep'}])
  .error,'stale_assignment_choice');
assert.equal(db.books[0].borrowedBy,'lisa');

db=directory();
const correction=preview(db,[row(0,'4711001',loanTo('tim','Tim Leerling'))]);
assert.equal(correction.summary.differences,1);
assert.equal(correction.differences[0].before.id,'lisa');
assert.equal(correction.differences[0].after.id,'tim');
assert.equal(correction.differences[0].choice,'apply',
  'An explicit unambiguous Excel borrower is proposed automatically');
assert.equal(correction.summary.automatic,1);
assert.equal(correction.summary.readyToApply,true);
assert.equal(preview(db,[row(0,'4711001',loanTo('tim','Tim Leerling'))],
  [{id:'0:loan',action:'keep'}]).differences[0].choice,'keep',
  'An administrator can still decline the Excel proposal');
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
const noReturn=preview(db,[row(0,'4711001')]);
assert.equal(noReturn.differences.length,0);
assert.equal(noReturn.summary.apply,0);
assert.equal(db.books[0].status,'borrowed');
assert.equal(db.books[0].borrowedBy,'lisa');
assert.equal(db.history.length,1);
assert.equal(db.readingRecords.length,1);

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
assert.equal(emptyLocation.differences.length,0,
  'An empty Excel location does not remove a saved classroom location');
assert.equal(emptyLocation.summary.readyToApply,false);
assert.equal(db.books[1].fixedLocation,'Klas A');
const implicitClass=preview(directory(),[row(0,'4711002',{classContext:['Klas A']})]);
assert.equal(implicitClass.differences[0].kind,'class_context');
assert.equal(implicitClass.differences[0].className,'Klas A');
assert.equal(implicitClass.differences[0].classId,'a');
assert.equal(implicitClass.summary.classQuestions,1);
assert.equal(implicitClass.summary.actualDifferences,0);
assert.equal(implicitClass.summary.readyToApply,false);
assert.equal(preview(directory(),[row(0,'4711002',{classContext:['Klas A']})],
  [{id:'0:class_context',action:'apply'}]).error,'unsafe_assignment_choice');

const classFixedDb=directory();
const fixedSource=row(0,'4711001',{classContext:['Klas A']});
// A vague class column must NOT return a copy currently lent to a pupil.
const fixedProposal=preview(classFixedDb,[fixedSource],
  [{id:'0:class_context',action:'class_fixed'}]);
assert.deepEqual(fixedProposal.differences.map(d=>d.kind),['class_context']);
assert.equal(fixedProposal.summary.apply,1);
const fixedHistoryBefore=JSON.stringify(classFixedDb.history);
const fixedRecordsBefore=JSON.stringify(classFixedDb.readingRecords);
const fixedResult=applyAssignmentPreview(classFixedDb,fixedProposal,'admin',now);
assert.equal(fixedResult.locations,1);
assert.equal(fixedResult.loans,0);
assert.equal(classFixedDb.books[0].fixedLocation,'Klas A');
assert.equal(classFixedDb.books[0].borrowedBy,'lisa');
assert.equal(classFixedDb.books[0].status,'borrowed');
assert.equal(JSON.stringify(classFixedDb.history),fixedHistoryBefore);
assert.equal(JSON.stringify(classFixedDb.readingRecords),fixedRecordsBefore);
assert.equal(preview(classFixedDb,[fixedSource]).summary.differences,0,
  'A matching registered fixed location must not remain a question');

const classLoanDb=directory();
const classLoanProposal=preview(classLoanDb,[
  row(0,'4711002',{classContext:['Klas A']}),
],[{id:'0:class_context',action:'class_loan'}]);
assert.equal(classLoanProposal.summary.apply,1);
const classLoanResult=applyAssignmentPreview(classLoanDb,classLoanProposal,'admin',now);
assert.equal(classLoanResult.loans,1);
assert.equal(classLoanDb.books[1].status,'borrowed');
assert.equal(classLoanDb.books[1].borrowedByClassId,'a');
assert.equal(classLoanDb.books[1].borrowedAt,null);
assert.equal(classLoanDb.books[1].fixedLocation,null,
  'Temporary class loan may not silently become a permanent location');
assert.equal(preview(classLoanDb,[row(0,'4711002',{classContext:['Klas A']})])
  .summary.differences,0, 'Matching registered class loan should not be flagged');

const notRelatedDb=directory();
const unmodifiedBooks=JSON.stringify(notRelatedDb.books);
const unrelated=preview(notRelatedDb,[
  row(0,'4711002',{classContext:['Klas A']}),
],[{id:'0:class_context',action:'class_unrelated'}]);
assert.equal(unrelated.summary.readyToApply,true);
assert.equal(unrelated.summary.apply,0);
assert.equal(applyAssignmentPreview(notRelatedDb,unrelated,'admin',now).applied,0);
assert.equal(JSON.stringify(notRelatedDb.books),unmodifiedBooks);

const unknownClassContext=preview(directory(),[
  row(0,'4711002',{classContext:['Onbekende klas']}),
]);
assert.equal(unknownClassContext.differences[0].classId,null);
assert.equal(preview(directory(),[
  row(0,'4711002',{classContext:['Onbekende klas']}),
],[{id:'0:class_context',action:'class_loan'}]).error,'unsafe_assignment_choice');
assert.equal(preview(directory(),[
  row(0,'4711002',{classContext:['Onbekende klas']}),
],[{id:'0:class_context',action:'class_fixed'}]).summary.apply,1);

const severalClasses=preview(directory(),[
  row(0,'4711002',{classContext:['Klas A','Klas B']}),
]);
assert.equal(severalClasses.differences[0].kind,'issue');
assert.equal(severalClasses.differences[0].reason,'multiple_class_contexts');
assert.equal(preview(directory(),[
  row(0,'4711002',{classContext:['Klas A','Klas B']}),
],[{id:'0:issue',action:'class_fixed'}]).error,'unsafe_assignment_choice');

db=directory();
const classChange=preview(db,[row(0,'4711001',classLoan('b','Klas B'))],
  [{id:'0:loan',action:'apply'}]);
applyAssignmentPreview(db,classChange,'admin',now);
assert.equal(db.books[0].borrowedByClassId,'b');
assert.equal(db.books[0].borrowedBy,null);
assert.equal(db.students[0].borrowedBooks.length,0);

db=directory();
const unknown=preview(db,[row(0,'99887711',loanTo('tim','Tim Leerling'))]);
assert.equal(unknown.differences[0].kind,'issue');
assert.equal(unknown.differences[0].reason,'physical_barcode_not_found');
assert.equal(preview(db,[row(0,'99887711',loanTo('tim','Tim Leerling'))],
  [{id:'0:issue',action:'apply'}]).ok,false);
const sharedIsbn=preview(db,[row(0,'',loanTo('tim','Tim Leerling'))]);
assert.equal(sharedIsbn.differences[0].kind,'loan');
assert.equal(sharedIsbn.differences[0].bookId,'copy-2',
  'Pick a free physical copy of a shared ISBN, not another pupil\'s loan');
const duplicate=preview(db,[row(0,'4711001',loanTo('tim','Tim Leerling')),
  row(1,'4711001',loanTo('tim','Tim Leerling'))]);
assert.equal(duplicate.differences[1].kind,'issue');
assert.equal(duplicate.differences[1].reason,'duplicate_physical_barcode');
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

// A fresh checkout and return can restore the same visible borrower state.
// The saved review must still be considered stale by its circulation revision.
const circulationDb=directory();
const reviewedCirculation=preview(circulationDb,[
  row(0,'4711001',loanTo('tim','Tim Leerling')),
],[{id:'0:loan',action:'apply'}]);
assert.equal(reviewedCirculation.differences[0].circulationRevision,0);
circulationDb.bookImportLoanActivityCounters={'copy-1':2};
const changedCirculation=preview(circulationDb,[
  row(0,'4711001',loanTo('tim','Tim Leerling')),
],[{id:'0:loan',action:'apply'}]);
assert.equal(changedCirculation.differences[0].circulationRevision,2);
assert.notDeepEqual(changedCirculation,reviewedCirculation,
  'A borrow/return cycle must invalidate an old administrative approval');

// Accent differences between spreadsheet author fields and stored
// metadata must not prevent a uniquely identified book from matching.
const accentDb = { ...directory(), books: [
  copy('accent-1', '9789086960088', {
    title:'Hittegolf', author:'Rene Appel',
    editionIsbn:'9789086960088', metadataIsbn:'9789086960088',
  }),
]};
const accentRow = {
  ...row(0,'',loanTo('tim','Tim Leerling')),
  book: {
    ...row(0,'').book,
    editionIsbn:'9789086960088', title:'Hittegolf',
    author:'René Appel',
  },
};
assert.equal(preview(accentDb,[accentRow]).differences[0].bookId,'accent-1');

// A legacy library record may store the edition ISBN only as its scan
// barcode. It must match uniquely, without guessing between two copies.
const legacyCopy = copy('legacy-1', ISBN, {
  editionIsbn:'', metadataIsbn:'', isbn13:'',
});
const legacyDb = { ...directory(), books:[legacyCopy] };
const legacyMatched=preview(legacyDb,[row(0,'',loanTo('tim','Tim Leerling'))]);
assert.equal(legacyMatched.differences.length,1);
assert.equal(legacyMatched.differences[0].kind,'loan');
assert.equal(legacyMatched.differences[0].bookId,'legacy-1');
const legacyAmbiguous = { ...directory(), books:[
  legacyCopy, copy('legacy-2', ISBN, {
    editionIsbn:'', metadataIsbn:'', isbn13:'',
  }),
]};
assert.equal(preview(legacyAmbiguous,[row(0,'',loanTo('tim','Tim Leerling'))])
  .differences[0].bookId,'legacy-1',
  'Duplicate ISBN scan codes identify an available copy, not a special barcode');
const arbitraryBarcodeOnly = { ...directory(), books:[
  copy('non-isbn', '4711001', {
    editionIsbn:'', metadataIsbn:'', isbn13:'',
  }),
]};
const needsStock=preview(arbitraryBarcodeOnly,[row(0,'',loanTo('tim','Tim Leerling'))]);
assert.equal(needsStock.differences.length,0);
assert.equal(needsStock.summary.notInCollection,1);
assert.equal(needsStock.notInCollection[0].editionIsbn,ISBN);

// A conflicting worksheet borrower is a source problem, not evidence that
// a book has disappeared from the collection.
const bothBorrowers=row(0,'4711001',{
  ...loanTo('tim','Tim Leerling'), ...classLoan('a','Klas A'),
});
bothBorrowers.status='conflict';
assert.equal(preview(directory(),[bothBorrowers]).differences[0].reason,
  'conflicting_excel_borrowers');

assert.equal(preview(directory(),[]).summary.readyToApply,false);
assert.equal(preview(directory(),[row(0,'4711002')]).summary.differences,0);

// Multiple rows of one ISBN can be distributed among physical copies without
// individual barcodes, exactly like the application's normal scan workflow.
const twoCopies=directory();
const distributed=preview(twoCopies,[
  row(0,'',loanTo('lisa','Lisa Leerling')),
  row(1,'',loanTo('tim','Tim Leerling')),
]);
assert.equal(distributed.differences.length,1);
assert.equal(distributed.differences[0].bookId,'copy-2');
assert.equal(distributed.differences[0].after.id,'tim');
assert.equal(distributed.summary.automatic,1);
applyAssignmentPreview(twoCopies,distributed,'admin',now);
assert.equal(twoCopies.books[0].borrowedBy,'lisa');
assert.equal(twoCopies.books[1].borrowedBy,'tim');
assert.equal(twoCopies.students[1].borrowedBooks[0].bookId,'copy-2');

// More Excel loan rows than physical stock must not overwrite an existing loan.
const overbooked=preview(directory(),[
  row(0,'',loanTo('lisa','Lisa Leerling')),
  row(1,'',loanTo('tim','Tim Leerling')),
  row(2,'',loanTo('sophie','Sophie Leerling')),
]);
assert.equal(overbooked.summary.notInCollection,1);
assert.equal(overbooked.summary.notInCollectionCopies,1);
assert.equal(overbooked.differences.length,1);
assert.equal(overbooked.differences[0].after.id,'tim');

// A blank ISBN row never steals a physical copy from an explicit borrower row.
const blankFirst=preview(directory(),[
  row(0,''),
  row(1,'',loanTo('tim','Tim Leerling')),
]);
assert.equal(blankFirst.differences.length,1);
assert.equal(blankFirst.differences[0].bookId,'copy-2');

// One ISBN and two distinct saved borrowers, with no copies available, is
// genuinely ambiguous when Excel names an unrelated third pupil.
const allLent=directory();
allLent.books[1].status='borrowed';
allLent.books[1].borrowedBy='sophie';
allLent.students[2].borrowedBooks=[{bookId:'copy-2'}];
assert.equal(preview(allLent,[row(0,'',loanTo('tim','Tim Leerling'))])
  .differences[0].reason,'ambiguous_physical_copy');

// A distinct physical barcode still identifies its exact individual copy.
assert.equal(preview(directory(),[row(0,'4711001',loanTo('tim','Tim Leerling'))])
  .differences[0].bookId,'copy-1');
console.log('Administrative assignment reconciliation: choices, metadata retention, identity and zero implicit deletions passed');
