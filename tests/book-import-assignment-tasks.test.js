'use strict';
const assert = require('node:assert/strict');
const {
  createDeferredAssignmentTasks, migrateLegacyDeferredTasks,
  listDeferredAssignmentTasks,
  findTask, resolveDeferredAssignmentTask,
} = require('../book-import-assignment-tasks');
const { buildAssignmentPreview } = require('../book-import-assignment-reconciliation');
const ISBN = '9780306406157';
const admin = {id:'admin',role:'admin'};
const teacher = {id:'teacher',role:'teacher'};
const today = '2026-11-12T20:00:00Z';
const initial = () => ({
  books:[{
    id:'copy-1',title:'Oorlogswinter',author:'Jan Terlouw',
    barcode:'4711001',editionIsbn:ISBN,metadataIsbn:ISBN,
    status:'borrowed',borrowedBy:'lisa',borrowedByClassId:null,
    borrowedAt:'2026-10-01T10:00:00Z',dueDate:'2026-10-25',
    fixedLocation:null,coverUrl:'cover.jpg',description:'Behouden metadata',
  }],
  students:[
    {id:'lisa',name:'Lisa Leerling',borrowedBooks:[{bookId:'copy-1'}]},
    {id:'tim',name:'Tim Leerling',borrowedBooks:[]},
  ],
  classes:[{id:'a',name:'Klas A'}],
  bookImportReports:[],bookImportAssignmentTasks:[],
  readingRecords:[{bookId:'copy-1',finished:true}],history:[{id:'original'}],
});
const row = context => ({
  index:0,sourceRowNumber:5,status:'ready',
  book:{title:'Oorlogswinter',author:'Jan Terlouw',editionIsbn:ISBN,
    barcode:'4711001',quantity:{valid:true,value:1}},
  context,
});
function defer(db, source, fileName='boeken.xlsx') {
  const plan=buildAssignmentPreview({ok:true,rows:[source]},db);
  assert.equal(plan.ok,true);
  assert.equal(plan.differences.length,1);
  const diff={...plan.differences[0],choice:'later'};
  const report={id:'report-'+(db.bookImportReports.length+1),
    mode:'assignment_reconcile',fileName,
    fullyReviewed:false,importedAt:today,
    deferredDifferences:[{
      id:diff.id,kind:diff.kind,bookId:diff.bookId,
      worksheetRow:diff.worksheetRow,reason:diff.reason||null,
      before:diff.before??null,after:diff.after??null,status:'open',
    }]};
  db.bookImportReports.push(report);
  return createDeferredAssignmentTasks(db,report,[source],[diff],today)[0];
}

let db=initial();
const loan=defer(db,row({studentLoan:{status:'matched',id:'tim',name:'Tim Leerling'}}));
assert.equal(listDeferredAssignmentTasks(db).summary.open,1);
assert.equal(listDeferredAssignmentTasks(db).tasks[0].canApply,true);
assert.equal(listDeferredAssignmentTasks(db).tasks[0].before.name,'Lisa Leerling');
const booksBefore=JSON.stringify(db.books);
assert.equal(resolveDeferredAssignmentTask(db,loan,teacher,
  {choice:'apply',revision:1,confirm:true}).ok,false);
assert.equal(resolveDeferredAssignmentTask(db,loan,admin,
  {choice:'apply',revision:1}).error,'confirmation_required');
assert.equal(JSON.stringify(db.books),booksBefore);
const applied=resolveDeferredAssignmentTask(db,loan,admin,
  {choice:'apply',revision:1,confirm:true});
assert.equal(applied.ok,true);
assert.equal(applied.corrected,1);
assert.equal(db.books[0].borrowedBy,'tim');
assert.equal(db.books[0].description,'Behouden metadata');
assert.equal(db.books[0].coverUrl,'cover.jpg');
assert.deepEqual(db.readingRecords,[{bookId:'copy-1',finished:true}]);
assert.equal(db.history.length,1);
assert.equal(db.bookImportReports[0].deferredDifferences[0].status,'completed');
assert.equal(db.bookImportReports[0].fullyReviewed,true);
assert.equal(db.bookImportAssignmentTasks[0].status,'completed');
assert.equal(listDeferredAssignmentTasks(db).summary.open,0);
assert.equal(resolveDeferredAssignmentTask(db,loan,admin,
  {choice:'apply',revision:1,confirm:true}).ok,false,'No duplicate correction');

db=initial();
const pending=defer(db,row({studentLoan:{status:'matched',id:'tim',name:'Tim Leerling'}}));
db.bookImportLoanActivityCounters={'copy-1':2};
assert.equal(resolveDeferredAssignmentTask(db,pending,admin,
  {choice:'apply',revision:1,confirm:true}).error,'review_no_longer_matches');
assert.equal(db.books[0].borrowedBy,'lisa');
assert.equal(pending.status,'open');

db=initial();
const classTask=defer(db,row({classContext:['Klas A']}));
assert.equal(classTask.kind,'class_context');
assert.equal(resolveDeferredAssignmentTask(db,classTask,admin,
  {choice:'class_fixed',revision:1,confirm:true}).ok,true);
assert.equal(db.books[0].fixedLocation,'Klas A');
assert.equal(db.books[0].borrowedBy,'lisa');
assert.equal(db.books[0].status,'borrowed');
assert.equal(db.students[0].borrowedBooks.length,1);
assert.equal(db.readingRecords.length,1);
assert.equal(db.history.length,1);

// A generic class note beside an explicit current borrower is only a
// location question. It MUST NOT offer a second class checkout.
db=initial();
const explicitClass=defer(db,row({
  classContext:['Klas A'],
  studentLoan:{status:'matched',id:'lisa',name:'Lisa Leerling'},
}));
assert.equal(explicitClass.kind,'class_context');
assert.equal(listDeferredAssignmentTasks(db).tasks[0].hasExplicitLoan,true);
assert.equal(resolveDeferredAssignmentTask(db,explicitClass,admin,
  {choice:'class_loan',revision:1,confirm:true}).ok,false);
assert.equal(db.books[0].borrowedBy,'lisa');
assert.equal(db.books[0].borrowedByClassId,null);

// Task stays independently accessible when the report retention limit trims
// its original report. Completion is still stored in the permanent task.
db=initial();
const oldTask=defer(db,row({classContext:['Klas A']}));
db.bookImportReports=[];
assert.equal(listDeferredAssignmentTasks(db).tasks[0].id,oldTask.id);
assert.equal(resolveDeferredAssignmentTask(db,oldTask,admin,
  {choice:'class_unrelated',revision:1}).ok,true);
assert.equal(db.books[0].fixedLocation,null);
assert.equal(db.bookImportAssignmentTaskHistory.length,1);
assert.equal(listDeferredAssignmentTasks(db).summary.open,0);

// A pre-upgrade report is still visible and can be closed without the
// original spreadsheet; unsafe automatic application is never allowed.
db=initial();
db.bookImportReports.push({
  id:'legacy-report',mode:'assignment_reconcile',fullyReviewed:false,
  importedAt:today,fileName:'oud.xlsx',
  deferredDifferences:[{
    id:'0:issue',status:'open',kind:'issue',reason:'source_row_requires_review',
    title:'Oorlogswinter',worksheetRow:5,bookId:null,
  }],
});
const oldList=listDeferredAssignmentTasks(db);
assert.equal(oldList.summary.open,1);
assert.equal(oldList.tasks[0].canApply,false);
const old=findTask(db,oldList.tasks[0].id);
assert.equal(resolveDeferredAssignmentTask(db,old,admin,
  {choice:'apply',revision:1,confirm:true}).ok,false);
assert.equal(resolveDeferredAssignmentTask(db,old,admin,
  {choice:'manual_done',revision:1}).ok,true);
assert.equal(db.bookImportReports[0].fullyReviewed,true);
assert.equal(listDeferredAssignmentTasks(db).summary.open,0);
// Opening a future database snapshot also migrates older report tasks.
// They survive once the old report is trimmed by the next 30 imports.
db=initial();
db.bookImportReports.push({
  id:'migration-report',mode:'assignment_reconcile',fullyReviewed:false,
  importedAt:today,fileName:'oude-import.xlsx',
  deferredDifferences:[{id:'0:issue',status:'open',kind:'issue',
    reason:'source_row_requires_review',title:'Oorlogswinter',worksheetRow:5}],
});
assert.equal(migrateLegacyDeferredTasks(db),1);
assert.equal(migrateLegacyDeferredTasks(db),0,'Migration must be idempotent');
const migrated = db.bookImportAssignmentTasks[0];
assert.equal(migrated.legacy,true);
db.bookImportReports=[];
assert.equal(listDeferredAssignmentTasks(db).summary.open,1);
assert.equal(resolveDeferredAssignmentTask(db,migrated,admin,
  {choice:'manual_done',revision:1}).ok,true);
assert.equal(migrated.status,'completed');
assert.equal(listDeferredAssignmentTasks(db).summary.open,0);

// Postponed shared-ISBN assignments must retain the physical ID allocated
// during the original multirow preview, not be remapped to the first free copy.
const shared=initial();
shared.books[0].status='available';
shared.books[0].borrowedBy=null;
shared.students[0].borrowedBooks=[];
shared.books.push({
  ...shared.books[0],id:'copy-2',barcode:'4711002',borrowedBy:null,
});
shared.students.push({id:'sophie',name:'Sophie Leerling',borrowedBooks:[]});
const sourceA={
  ...row({studentLoan:{status:'matched',id:'tim',name:'Tim Leerling'}}),
  index:0,book:{...row({}).book,barcode:''},
};
const sourceB={
  ...row({studentLoan:{status:'matched',id:'sophie',name:'Sophie Leerling'}}),
  index:1,sourceRowNumber:6,book:{...row({}).book,barcode:''},
};
const multiPlan=buildAssignmentPreview({ok:true,rows:[sourceA,sourceB]},shared,
  [{id:'0:loan',action:'later'},{id:'1:loan',action:'later'}]);
assert.equal(multiPlan.ok,true);
assert.equal(multiPlan.differences.length,2);
assert.equal(multiPlan.differences[0].bookId,'copy-1');
assert.equal(multiPlan.differences[1].bookId,'copy-2');
const multiReport={
  id:'multi-ISBN-report',mode:'assignment_reconcile',fileName:'dubbele-isbn.xlsx',
  fullyReviewed:false,importedAt:today,deferredDifferences:multiPlan.differences.map(d=>({
    id:d.id,kind:d.kind,bookId:d.bookId,worksheetRow:d.worksheetRow,
    before:d.before,after:d.after,status:'open',
  })),
};
shared.bookImportReports.push(multiReport);
const tasks=createDeferredAssignmentTasks(shared,multiReport,
  [sourceA,sourceB],multiPlan.differences,today);
const sophieTask=tasks.find(task=>task.bookId==='copy-2');
assert.ok(sophieTask,'The second allocated physical copy is persisted');
const appliedSophie=resolveDeferredAssignmentTask(shared,sophieTask,admin,
  {choice:'apply',revision:1,confirm:true});
assert.equal(appliedSophie.ok,true);
assert.equal(shared.books[0].borrowedBy,null);
assert.equal(shared.books[1].borrowedBy,'sophie');
const timTask=tasks.find(task=>task.bookId==='copy-1');
assert.equal(resolveDeferredAssignmentTask(shared,timTask,admin,
  {choice:'apply',revision:1,confirm:true}).ok,true);
assert.equal(shared.books[0].borrowedBy,'tim');
assert.equal(shared.students[1].borrowedBooks[0].bookId,'copy-1');
assert.equal(shared.students[2].borrowedBooks[0].bookId,'copy-2');

console.log('Deferred administrator tasks: security, persistent queue, safe resolution, stale loan and legacy records OK');
