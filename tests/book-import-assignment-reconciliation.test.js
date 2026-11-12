'use strict';
const assert=require('node:assert/strict');
const {
  buildAssignmentPreview,applyAssignmentPreview,normalizeResolutions,
}=require('../book-import-assignment-reconciliation');
const ISBN1='9780306406157', ISBN2='9780140328721', ISBN3='9780439554930';
const db={
  books:[
    {id:'a',barcode:'10001',title:'Eerste boek',author:'Auteur A',
      editionIsbn:ISBN1,status:'borrowed',borrowedBy:'s1',
      borrowedByClassId:null,borrowedAt:'2026-11-01T10:00:00Z',
      dueDate:'2026-12-01',description:'Geverifieerde beschrijving',
      localCoverUrl:'/api/covers/'+'a'.repeat(64)+'.jpg'},
    {id:'b',barcode:'10002',title:'Tweede boek',author:'Auteur B',
      editionIsbn:ISBN2,status:'available',fixedLocation:'Klas A'},
    {id:'c',barcode:'10003',title:'Derde boek',author:'Auteur C',
      editionIsbn:ISBN3,status:'borrowed',borrowedBy:'s1',borrowedByClassId:null},
  ],
  students:[
    {id:'s1',name:'Lisa',borrowedBooks:[{bookId:'a',borrowedAt:'2026-11-01T10:00:00Z',dueDate:'2026-12-01'},
      {bookId:'c',borrowedAt:null}],active:true},
    {id:'s2',name:'Tim',borrowedBooks:[],active:true},
  ],
  classes:[{id:'cl1',name:'Klas A'},{id:'cl2',name:'Klas B'}],
  history:[],readingRecords:[{id:'r1',subjectType:'student',subjectId:'s1',
    bookId:'other-copy',finished:true}],
};
const row=(index,book,context={})=>({index,sourceRowNumber:index+2,status:'ready',
  book:{quantity:{valid:true,value:1},...book},context});
const rows=[
  row(0,{editionIsbn:ISBN1,barcode:'10001',title:'Eerste boek',author:'Auteur A'},
    {studentLoan:{status:'matched',id:'s2',name:'Tim'}}),
  row(1,{editionIsbn:ISBN2,barcode:'10002',title:'Tweede boek',author:'Auteur B'},
    {fixedLocation:{status:'resolved',label:'Klas B'}}),
  row(2,{editionIsbn:ISBN3,barcode:'10003',title:'Derde boek',author:'Auteur C'}),
];
const analysis={ok:true,rows};
let plan=buildAssignmentPreview(analysis,db);
assert.equal(plan.ok,true);
assert.equal(plan.summary.differences,3);
assert.equal(plan.summary.pending,3);
assert.equal(plan.summary.readyToApply,false,
  'Nothing is changed until the administrator decides for each difference');
assert.equal(plan.differences.find(x=>x.id==='2:loan').blankSource,true,
  'An empty borrower is ambiguous, not proof of a return');
const before=JSON.stringify(db);
assert.equal(JSON.stringify(db),before,'Preview is read-only');
assert.equal(normalizeResolutions([{id:'0:loan',action:'delete'}]).ok,false);
assert.equal(buildAssignmentPreview(analysis,db,[{id:'88:loan',action:'apply'}]).ok,false,
  'Forged choices cannot authorize changes');
const selections=[
  {id:'0:loan',action:'apply'},
  {id:'1:location',action:'apply'},
  {id:'2:loan',action:'keep'},
];
plan=buildAssignmentPreview(analysis,db,selections);
assert.equal(plan.summary.readyToApply,true);
assert.equal(plan.summary.apply,2);
const change=applyAssignmentPreview(db,plan,'admin','2026-11-12T10:00:00Z','batch1');
assert.equal(change.loans,1);
assert.equal(change.locations,1);
assert.equal(change.applied,2);
assert.equal(db.books[0].borrowedBy,'s2');
assert.equal(db.books[0].status,'borrowed');
assert.equal(db.books[0].borrowedAt,'2026-11-01T10:00:00Z',
  'Correcting an administrative mistake does not fabricate a new loan date');
assert.equal(db.students[0].borrowedBooks.some(x=>x.bookId==='a'),false);
assert.equal(db.students[1].borrowedBooks.some(x=>x.bookId==='a'),true);
assert.equal(db.books[1].fixedLocation,'Klas B');
assert.equal(db.books[2].borrowedBy,'s1',
  'A blank Excel cell must preserve the existing loan without explicit approval');
assert.equal(db.books[0].description,'Geverifieerde beschrijving');
assert.equal(db.books[0].localCoverUrl,'/api/covers/'+'a'.repeat(64)+'.jpg');
assert.equal(db.readingRecords.length,1);
assert.equal(db.history.length,0,
  'No check-in or reading completion is fabricated by administrative repair');
assert.equal(db.bookAssignmentCorrectionLog.length,2);
assert.equal(db.bookImportLoanReceipts.length,2,
  'Historical and corrected borrower combinations get durable receipts');
const repeat=buildAssignmentPreview(analysis,db);
assert.equal(repeat.differences.filter(x=>x.id==='0:loan').length,0);
assert.equal(repeat.differences.filter(x=>x.id==='1:location').length,0);
assert.equal(repeat.differences.filter(x=>x.id==='2:loan').length,1);
const clearing=buildAssignmentPreview({ok:true,rows:[rows[2]]},db,
  [{id:'2:loan',action:'apply'}]);
assert.equal(clearing.summary.readyToApply,true);
applyAssignmentPreview(db,clearing,'admin','2026-11-12T12:00:00Z','batch2');
assert.equal(db.books[2].status,'available');
assert.equal(db.books[2].borrowedBy,null);
assert.equal(db.students[0].borrowedBooks.length,0);
assert.equal(db.readingRecords.length,1,'No reading answer recorded on a correction');
const ambiguousDb={...db,books:[
  {...db.books[0],id:'copy1',barcode:ISBN1},
  {...db.books[0],id:'copy2',barcode:ISBN1},
]};
const ambiguous=buildAssignmentPreview({ok:true,rows:[row(0,{
  editionIsbn:ISBN1,barcode:ISBN1,title:'Eerste boek',author:'Auteur A',
},{studentLoan:{status:'matched',id:'s2',name:'Tim'}})]},ambiguousDb);
assert.equal(ambiguous.differences[0].kind,'issue');
assert.equal(ambiguous.differences[0].reason,'ambiguous_physical_copy');
assert.equal(buildAssignmentPreview({ok:true,rows:[
  rows[0],{...rows[0],index:3,sourceRowNumber:5},
]},db).differences.some(x=>x.reason==='duplicate_copy_rows'),true,
  'Multiple rows for the same physical copy are never silently applied');
const vagueClass=buildAssignmentPreview({ok:true,rows:[row(1,{
  editionIsbn:ISBN2,barcode:'10002',title:'Tweede boek',author:'Auteur B',
},{classContext:['Klas A']})]},db);
assert.equal(vagueClass.differences[0].reason,'class_context_requires_classification',
  'A generic class column must not silently become a permanent shelf location');

const borrowedAt='2026-11-01T10:00:00Z';
const examBook={id:'exam-copy',title:'Examenboek',author:'Auteur Exam',
  editionIsbn:ISBN1,metadataIsbn:ISBN1,barcode:'20001',status:'borrowed',
  borrowedBy:'s1',borrowedByClassId:null,borrowedAt,
  suitableForExamList:true};
const examDb={books:[examBook],
  students:[
    {id:'s1',name:'Lisa',active:true,classIds:['bb'],
      borrowedBooks:[{bookId:examBook.id,borrowedAt}]},
    {id:'s2',name:'Tim',active:true,classIds:['bb'],borrowedBooks:[]},
  ],
  classes:[{id:'bb',name:'Bovenbouw structuur',studentIds:['s1','s2']}],
  examReadingLists:[{id:'old-entry',studentId:'s1',
    editionKey:'isbn13||'+ISBN1,bookId:examBook.id,
    title:'Examenboek',author:'Auteur Exam',manualStatus:'aan_het_lezen',
    autoCurrentLoan:true,autoLoanBookId:examBook.id,autoLoanBorrowedAt:borrowedAt,
    addedAt:borrowedAt,updatedAt:borrowedAt}],
  readingRecords:[],
};
const examRow=row(0,{editionIsbn:ISBN1,barcode:'20001',
  title:'Examenboek',author:'Auteur Exam'},
  {studentLoan:{status:'matched',id:'s2',name:'Tim'}});
const examPlan=buildAssignmentPreview({ok:true,rows:[examRow]},examDb,
  [{id:'0:loan',action:'apply'}]);
assert.equal(examPlan.summary.readyToApply,true);
applyAssignmentPreview(examDb,examPlan,'admin','2026-11-12T12:00:00Z','exam-correction');
assert.equal(examDb.examReadingLists.find(x=>x.studentId==='s1').manualStatus,'nog_lezen');
assert.equal(examDb.examReadingLists.find(x=>x.studentId==='s1').autoCurrentLoan,false);
assert.equal(examDb.examReadingLists.find(x=>x.studentId==='s2').manualStatus,'aan_het_lezen');
assert.equal(examDb.examReadingLists.find(x=>x.studentId==='s2').autoLoanBookId,examBook.id);
assert.equal(examDb.readingRecords.length,0,'Correcting exam loans must not create read records');

console.log('Opt-in assignment reconciliation, safety, empty cells and audit: OK');
