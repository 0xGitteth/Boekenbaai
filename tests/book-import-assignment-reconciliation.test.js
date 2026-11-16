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
const {excelLoanReceiptKey}=require('../book-import-loan-migration');
const {withMissingExcelLoans}=require('../book-import-unified-sync');
{
  // Dex has three active books in Boekenbaai, but only two are present in
  // a complete new Excel. The extra book must be a question, not an
  // automatic return or an invented historical checkout.
  const isbn2='9780439554930',isbn3='9780061120084';
  const live={
    books:[
      copy('dex-1','47001',{metadataIsbn:ISBN,borrowedBy:'dex',status:'borrowed'}),
      copy('dex-2','47002',{metadataIsbn:isbn2,borrowedBy:'dex',status:'borrowed',
        title:'Tweede boek',author:'Auteur B'}),
      copy('dex-3','47003',{metadataIsbn:isbn3,borrowedBy:'dex',status:'borrowed',
        title:'Derde boek',author:'Auteur C'}),
    ],
    students:[{id:'dex',name:'Dex',borrowedBooks:[
      {bookId:'dex-1'},{bookId:'dex-2'},{bookId:'dex-3'},
    ]}],
    classes:[],history:[],
  };
  const source={ok:true,rows:[
    row(0,'47001',loanTo('dex','Dex')),
    row(1,'47002',loanTo('dex','Dex'),{
      editionIsbn:isbn2,title:'Tweede boek',author:'Auteur B',
    }),
  ]};
  const partial=withMissingExcelLoans(source,live,false);
  assert.equal(partial.rows.length,2,
    'A partial Excel is not authoritative over unlisted loans');
  const full=withMissingExcelLoans(source,live,true);
  assert.equal(full.rows.length,3);
  assert.equal(full.rows[2].missingFromExcel,true);
  assert.equal(full.preferredCopyByRow[2],'dex-3');
  const options={reviewMissingLoans:true,reviewAllBlankLoans:true,
    loanReceipts:[],preferredCopyByRow:full.preferredCopyByRow};
  const check=buildAssignmentPreview(full,live,[],options);
  assert.equal(check.ok,true);
  assert.equal(check.differences.length,1);
  assert.equal(check.differences[0].bookId,'dex-3');
  assert.equal(check.differences[0].missingFromSnapshot,true);
  assert.equal(check.differences[0].choice,'pending');
  assert.equal(live.books.filter(b=>b.status==='borrowed').length,3);
  const chosen=buildAssignmentPreview(full,live,[
    {id:check.differences[0].id,action:'apply'},
  ],options);
  assert.equal(chosen.ok,true);
  assert.equal(chosen.summary.readyToApply,true);
  applyAssignmentPreview(live,chosen,'admin',now,'dex-import',
    {loanHistoryMode:'correct'});
  assert.equal(live.books.filter(b=>b.status==='borrowed').length,2);
  assert.deepEqual(live.students[0].borrowedBooks.map(x=>x.bookId),
    ['dex-1','dex-2']);
  assert.equal(live.bookLoanPeriods?.length||0,0);
}
// Two copies sharing an ISBN require physical-barcode comparison; one
// present row does not prove every borrowed physical copy is present.
{
  const live={
    books:[
      copy('copy-a','4711001',{status:'borrowed',borrowedBy:'lisa'}),
      copy('copy-b','4711002',{status:'borrowed',borrowedBy:'tim'}),
    ],
    students:[
      {id:'lisa',name:'Lisa',borrowedBooks:[{bookId:'copy-a'}]},
      {id:'tim',name:'Tim',borrowedBooks:[{bookId:'copy-b'}]},
    ],
    classes:[],history:[],
  };
  const listed={ok:true,rows:[
    row(0,'4711001',loanTo('lisa','Lisa')),
  ]};
  const missing=withMissingExcelLoans(listed,live,true);
  assert.equal(missing.rows.length,2);
  assert.equal(missing.preferredCopyByRow[1],'copy-b');
  const preview=buildAssignmentPreview(missing,live,[],{
    reviewAllBlankLoans:true,reviewMissingLoans:true,
    loanReceipts:[],preferredCopyByRow:missing.preferredCopyByRow,
  });
  assert.equal(preview.ok,true);
  assert.equal(preview.differences.length,1);
  assert.equal(preview.differences[0].bookId,'copy-b');
  assert.equal(preview.differences[0].choice,'pending');
}


// A previously imported Excel borrower disappearing from the next Excel
// must be shown as a decision, never treated as a silent return.
{
  const proof=excelLoanReceiptKey('copy-1',{type:'student',id:'lisa'});
  const source=row(0,'4711001');
  const opts={reviewMissingLoans:true,loanReceipts:[proof]};
  const newPreview=()=>buildAssignmentPreview({ok:true,rows:[source]},
    directory(),[],opts);
  const pending=newPreview();
  assert.equal(pending.ok,true);
  assert.equal(pending.differences.length,1);
  assert.equal(pending.differences[0].kind,'loan');
  assert.equal(pending.differences[0].previouslyRecordedInExcel,true);
  assert.equal(pending.differences[0].choice,'pending');
  assert.equal(pending.summary.readyToApply,false);
  const noProof=buildAssignmentPreview({ok:true,rows:[source]},
    directory(),[],{reviewMissingLoans:true,loanReceipts:[]});
  assert.equal(noProof.differences.length,0,
    'A blank field without a prior confirmed Excel loan is not a return');
  const correction=buildAssignmentPreview({ok:true,rows:[source]},
    directory(),[{id:'0:loan',action:'apply'}],opts);
  const correctionDb=directory();
  applyAssignmentPreview(correctionDb,correction,'admin',now,'import-1',
    {loanHistoryMode:'correct'});
  assert.equal(correctionDb.books[0].status,'available');
  assert.equal(correctionDb.students[0].borrowedBooks.length,0);
  assert.equal(correctionDb.bookLoanPeriods?.length||0,0);
  const historyDb=directory();
  applyAssignmentPreview(historyDb,correction,'admin',now,'import-2',
    {loanHistoryMode:'preserve'});
  assert.equal(historyDb.bookLoanPeriods.length,1);
  assert.equal(historyDb.bookLoanPeriods[0].studentId,'lisa');
  assert.equal(historyDb.bookLoanPeriods[0].source,'excel_reconciliation');
  assert.equal(historyDb.readingRecords[0].finished,true,
    'The import does not invent or alter a reading-completion answer');
}


// A source conflict must not fabricate a location comparison with two
// empty values. Preserve actual Excel context and defer the unsafe link.
{
  const unresolved=row(0,'4711002',{
    fixedLocation:{status:'resolved',label:'Klas A',raw:'StructuurBB'},
    studentLoan:{status:'unmatched',name:'Amelia'},
    studentClassHint:{label:'OndBKT'},
  });
  unresolved.status='conflict';
  unresolved.issues=[{code:'student_loan_unmatched',severity:'conflict'}];
  const blocked=preview(directory(),[unresolved]);
  assert.equal(blocked.ok,true);
  assert.equal(blocked.differences.length,1);
  assert.equal(blocked.differences[0].reason,'source_row_requires_review');
  assert.equal(blocked.differences[0].excelFixedLocation,'StructuurBB');
  assert.equal(blocked.differences[0].excelStudent,'Amelia');
  assert.equal(blocked.differences[0].excelClass,'OndBKT');
  assert.equal(blocked.differences[0].choice,'later');
  assert.equal(blocked.differences[0].autoDeferred,true);
  assert.equal(blocked.summary.pending,0);
  assert.equal(blocked.summary.apply,0);
  const before=JSON.stringify(directory().books);
  const after=directory();
  assert.equal(applyAssignmentPreview(after,blocked,'admin').applied,0);
  assert.equal(JSON.stringify(after.books),before);
  assert.equal(preview(directory(),[unresolved],
    [{id:'0:issue',action:'apply'}]).error,'unsafe_assignment_choice',
    'An unresolved borrower must never be applied');
}


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
const spellingOnly=preview(db,[row(0,'4711002',
  loanTo('tim','Tim Leerling'),{
    title:'Oorlogs-winter',author:'Jan Térlouw',
  })]);
assert.equal(spellingOnly.ok,true);
assert.equal(spellingOnly.summary.pending,0,
  'An exact physical barcode and ISBN must accept safe orthographic author/title variants');
assert.equal(spellingOnly.differences[0]?.kind,'loan');

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

const separateClassesDb=directory();
separateClassesDb.classes=[
  {id:'c12',name:'Klas 1-2'},{id:'cother',name:'Klas 12'},
];
separateClassesDb.books[1].fixedLocation='Klas 1-2';
const differentClass=preview(separateClassesDb,[
  row(0,'4711002',{classContext:['Klas 12']}),
]);
assert.equal(differentClass.differences[0]?.kind,'class_context',
  'Punctuation/spacing must not merge two distinct registered class identities');
assert.equal(differentClass.differences[0]?.classId,'cother');

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

// A location must never cause an unrelated borrower's occupied copy to be
// reassigned when another identical edition is available for the new reader.
const sharedFixed=directory();
sharedFixed.books[0].fixedLocation='Klas A';
const safeLocationLoan=preview(sharedFixed,[
  row(0,'',{
    ...loanTo('tim','Tim Leerling'),
    fixedLocation:{status:'resolved',label:'Klas A'},
  }),
]);
assert.equal(safeLocationLoan.ok,true);
assert.equal(safeLocationLoan.differences.find(d=>d.kind==='loan')?.bookId,'copy-2');
applyAssignmentPreview(sharedFixed,safeLocationLoan,'admin',now);
assert.equal(sharedFixed.books[0].borrowedBy,'lisa');
assert.equal(sharedFixed.books[1].borrowedBy,'tim');

// A uniquely barcoded Excel row must reserve its exact copy first, regardless
// of the preceding worksheet order of an otherwise identical ISBN-only row.
const twoFreeCopies=directory();
twoFreeCopies.books[0].status='available';
twoFreeCopies.books[0].borrowedBy=null;
twoFreeCopies.students[0].borrowedBooks=[];
const physicalPriority=preview(twoFreeCopies,[
  row(0,'',loanTo('tim','Tim Leerling')),
  row(1,'4711001',loanTo('sophie','Sophie Leerling')),
]);
assert.equal(physicalPriority.differences.length,2);
assert.equal(physicalPriority.differences[0].bookId,'copy-2');
assert.equal(physicalPriority.differences[1].bookId,'copy-1');
assert.equal(physicalPriority.summary.automatic,2);

// Two proposals of the same ISBN to one pupil must not reject the whole
// import on upload. Present both rows for explicit choice instead.
const duplicateSuggestion=preview(twoFreeCopies,[
  row(0,'',loanTo('tim','Tim Leerling')),
  row(1,'',loanTo('tim','Tim Leerling')),
]);
assert.equal(duplicateSuggestion.ok,true);
assert.equal(duplicateSuggestion.summary.pending,2);
assert.equal(duplicateSuggestion.summary.automatic,0);
assert.equal(duplicateSuggestion.differences.every(d=>
  d.needsChoice==='duplicate_excel_student_edition'),true);
const resolvedDuplicate=preview(twoFreeCopies,[
  row(0,'',loanTo('tim','Tim Leerling')),
  row(1,'',loanTo('tim','Tim Leerling')),
],[{id:'0:loan',action:'apply'},{id:'1:loan',action:'keep'}]);
assert.equal(resolvedDuplicate.ok,true);
assert.equal(resolvedDuplicate.summary.readyToApply,true);

// Bad source rows cannot pre-empt a physical copy needed by a valid borrower.
const unrecognizedFirst=preview(twoFreeCopies,[
  row(0,'',{studentLoan:{status:'unmatched',name:'Onbekende leerling'}}),
  row(1,'',loanTo('tim','Tim Leerling')),
]);
assert.equal(unrecognizedFirst.differences.find(d=>d.rowIndex===0)?.reason,
  'borrower_not_uniquely_matched');
assert.equal(unrecognizedFirst.differences.find(d=>d.rowIndex===1)?.bookId,'copy-1');


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

// A corrected complete workbook swaps students between actual physical books.
// The import must move the two links, not append two extra loans.
{
  const live=directory();
  live.books[1].status='borrowed';
  live.books[1].borrowedBy='tim';
  live.students[1].borrowedBooks=[{bookId:'copy-2'}];
  const corrected=[
    row(0,'4711001',loanTo('tim','Tim Leerling')),
    row(1,'4711002',loanTo('lisa','Lisa Leerling')),
  ];
  const plan=preview(live,corrected);
  assert.equal(plan.ok,true);
  assert.equal(plan.differences.length,2);
  assert.equal(plan.differences.every(d=>d.kind==='loan'&&d.choice==='apply'),true);
  applyAssignmentPreview(live,plan,'admin',now,'swapped-loans',
    {loanHistoryMode:'correct'});
  assert.equal(live.books[0].borrowedBy,'tim');
  assert.equal(live.books[1].borrowedBy,'lisa');
  assert.deepEqual(live.students[0].borrowedBooks.map(x=>x.bookId),['copy-2']);
  assert.deepEqual(live.students[1].borrowedBooks.map(x=>x.bookId),['copy-1']);
  assert.equal(live.bookLoanPeriods?.length||0,0);
  assert.equal(live.history.length,1,'No fictitious checkout or check-in');
}
// An explicit permanent class location can replace an incorrect class
// checkout only when the administrator confirms a complete loan snapshot.
{
  const live=directory();
  live.books[0].status='borrowed';
  live.books[0].borrowedBy=null;
  live.books[0].borrowedByClassId='a';
  live.students[0].borrowedBooks=[];
  const rows=[row(0,'4711001',{fixedLocation:{status:'resolved',label:'Klas A'}})];
  const partial=buildAssignmentPreview({ok:true,rows},live,[],{
    reviewMissingLoans:true,loanReceipts:[],
  });
  assert.equal(partial.differences.some(x=>x.kind==='loan'),false);
  const full=buildAssignmentPreview({ok:true,rows},live,[],{
    reviewMissingLoans:true,reviewAllBlankLoans:true,
  });
  assert.equal(full.differences.length,2);
  assert.equal(full.differences.every(x=>x.choice==='pending'),true);
  assert.equal(full.differences.find(x=>x.kind==='loan').classLoanToFixed,true);
  const decisions=full.differences.map(x=>({id:x.id,action:'apply'}));
  const corrected=buildAssignmentPreview({ok:true,rows},live,decisions,{
    reviewMissingLoans:true,reviewAllBlankLoans:true,
  });
  assert.equal(corrected.ok,true);
  applyAssignmentPreview(live,corrected,'admin',now,'fixed-in-class',
    {loanHistoryMode:'correct'});
  assert.equal(live.books[0].status,'available');
  assert.equal(live.books[0].borrowedByClassId,null);
  assert.equal(live.books[0].fixedLocation,'Klas A');
  assert.equal(live.bookLoanPeriods?.length||0,0);
}
// Conversely a class loan may replace an erroneously permanent location,
// without automatically clearing the location on an incomplete workbook.
{
  const live=directory();
  live.books[1].fixedLocation='Klas A';
  const rows=[row(0,'4711002',classLoan('a','Klas A'))];
  const partial=buildAssignmentPreview({ok:true,rows},live,[]);
  assert.equal(partial.differences.filter(x=>x.kind==='location').length,0);
  const full=buildAssignmentPreview({ok:true,rows},live,[],{
    reviewMissingLoans:true,reviewAllBlankLoans:true,
  });
  const toRemove=full.differences.find(x=>x.kind==='location');
  assert.equal(toRemove?.classFixedToLoan,true);
  assert.equal(toRemove.choice,'pending');
  const confirmed=buildAssignmentPreview({ok:true,rows},live,[
    {id:toRemove.id,action:'apply'},
  ],{reviewMissingLoans:true,reviewAllBlankLoans:true});
  assert.equal(confirmed.ok,true);
  applyAssignmentPreview(live,confirmed,'admin',now,'class-borrowing',
    {loanHistoryMode:'correct'});
  assert.equal(live.books[1].status,'borrowed');
  assert.equal(live.books[1].borrowedByClassId,'a');
  assert.equal(live.books[1].fixedLocation,null);
}

console.log('Administrative assignment reconciliation: choices, metadata retention, identity and zero implicit deletions passed');
