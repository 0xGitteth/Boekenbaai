'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildTaskPreflight}=require('../task-preflight');
const {listDeferredBookTasks}=require('../book-import-deferred-book-tasks');
const {latestImportForTask,confirmedNewerImport,closeTasksProvenByImport}=
  require('../book-import-task-reconciliation');

const isbn='9780306406157';
const oldTask=(change={})=>({
  id:'old-task',status:'open',revision:1,batchId:'old-batch',
  fileName:'Keuzelijst bibliotheek (1).xlsx',
  worksheetRow:44,title:'Voorbeeldboek',author:'Auteur',
  editionIsbn:isbn,excelIdentifier:isbn,
  sourcePrintedBarcode:'10000086070',sourceQuantity:1,
  createdAt:'2026-11-16T10:00:00.000Z',...change,
});
const copy=(change={})=>({
  id:'copy-original',barcode:'10000086070',
  metadataIsbn:isbn,title:'Voorbeeldboek',author:'Auteur',
  status:'borrowed',borrowedBy:'student-1',...change,
});
const freshReport=(change={})=>({
  id:'new-batch',fileName:'Keuzelijst bibliotheek (2).xlsx',
  importedAt:'2026-11-19T10:00:00.000Z',
  rows:[{worksheetRow:60,title:'Voorbeeldboek',author:'Auteur',
    editionIsbn:isbn,sourceIdentifier:isbn,
    sourcePrintedBarcode:'10000086070',sourceQuantity:1,
    status:'unchanged',copies:0,bookIds:[]}],...change,
});
const makeDb=(changes={})=>({
  books:[copy()],bookImportDeferredBookChecks:[oldTask()],
  bookImportReports:[],students:[{id:'student-1',borrowedBooks:['copy-original']}],
  bookImportLoanActivityCounters:{'copy-original':3},...changes,
});
let db=makeDb();
const originalBooks=JSON.stringify(db.books);
const originalStudents=JSON.stringify(db.students);
const originalCounters=JSON.stringify(db.bookImportLoanActivityCounters);
const report=freshReport();
assert.equal(confirmedNewerImport(db,db.bookImportDeferredBookChecks[0],report)?.bookId,'copy-original');
let result=closeTasksProvenByImport(db,report,{actorId:'admin-1',now:'2026-11-19T10:01:00.000Z'});
assert.equal(result.closed,1,'A uniquely verified physical barcode + edition resolves the older notification');
assert.deepEqual(result.taskIds,['old-task']);
assert.equal(db.bookImportDeferredBookChecks[0].status,'completed');
assert.equal(db.bookImportDeferredBookChecks[0].resolution,'auto_newer_import_verified_copy');
assert.equal(db.bookImportDeferredBookChecks[0].revision,2);
assert.equal(db.bookImportDeferredBookTaskHistory[0].proof.bookId,'copy-original');
assert.equal(db.bookImportDeferredBookTaskHistory[0].actorId,'admin-1');
assert.equal(JSON.stringify(db.books),originalBooks);
assert.equal(JSON.stringify(db.students),originalStudents);
assert.equal(JSON.stringify(db.bookImportLoanActivityCounters),originalCounters);
assert.equal(closeTasksProvenByImport(db,report).closed,0,'The same import must not resolve twice');

function neverClose(name,change){
  const data=makeDb();
  const r=freshReport();
  change(data,r);
  const before=JSON.stringify(data);
  const result=closeTasksProvenByImport(data,r);
  assert.equal(result.closed,0,name);
  assert.equal(JSON.stringify(data),before,name+' must be read-only when unproven');
}
neverClose('A title+ISBN without a printed barcode is not a physical copy',db=>{
  db.bookImportDeferredBookChecks[0].sourcePrintedBarcode='';
});
neverClose('An old worksheet row with unknown quantity is not unique',db=>{
  db.bookImportDeferredBookChecks[0].sourceQuantity=null;
});
neverClose('A newer worksheet quantity of two cannot identify the original',(_,report)=>{
  report.rows[0].sourceQuantity=2;
});
neverClose('A duplicated barcode in newer Excel is not unique',(_,report)=>{
  report.rows.push({...report.rows[0],worksheetRow:61});
});
neverClose('More than one catalogue copy with a barcode is ambiguous',db=>{
  db.books.push(copy({id:'second-copy'}));
});
neverClose('Duplicated database ID is unsafe',db=>{
  db.books.push(copy({barcode:'other-code'}));
});
neverClose('A conflicting edition remains a separate physical item',db=>{
  db.books[0].metadataIsbn='9789025873974';
});
neverClose('Contradictory edition identifiers cannot be ignored',db=>{
  db.books[0].editionIsbn='9789025873974';
});
neverClose('No verified edition identifier cannot close a task',db=>{
  delete db.books[0].metadataIsbn;
});
neverClose('A different book title on the new source is not the same row',(_,report)=>{
  report.rows[0].title='Ander boek';
});
neverClose('A different author on the catalogue copy is not evidence',db=>{
  db.books[0].author='Andere auteur';
});
neverClose('A skipped later row is no evidence of a successful import',(_,report)=>{
  report.rows[0].status='skipped';
});
neverClose('A later report dated before the old task is not newer',(_,report)=>{
  report.importedAt='2026-11-14T10:00:00.000Z';
});
neverClose('Same import may not validate itself',db=>{
  db.bookImportDeferredBookChecks[0].batchId='new-batch';
});
neverClose('An old task tied to another physical ID must not be overridden',db=>{
  db.bookImportDeferredBookChecks[0].bookId='different-copy';
});
neverClose('Invalid Excel ISBN cannot be silently repaired by a new title',db=>{
  db.bookImportDeferredBookChecks[0].editionIsbn='';
});

// Legacy reports cannot by themselves authorize closure. But they can
// explain the chronology, preventing old tasks from appearing timeless.
db=makeDb({bookImportReports:[{
  id:'legacy-later',fileName:'Keuzelijst bibliotheek (1).xlsx',
  importedAt:'2026-11-17T10:00:00.000Z',
  rows:[{worksheetRow:44,title:'Voorbeeldboek',status:'unchanged'}],
}]});
assert.equal(latestImportForTask(db,db.bookImportDeferredBookChecks[0]).reportId,'legacy-later');
assert.equal(latestImportForTask(db,db.bookImportDeferredBookChecks[0]).authorConfirmed,false);
assert.equal(listDeferredBookTasks(db).tasks[0].newerImport.reportId,'legacy-later');
assert.equal(buildTaskPreflight(db).tasks[0].evidence.some(x=>x.type==='later_import_review'),true);
assert.equal(buildTaskPreflight(db).summary.automatic_candidate,0,
  'A newer but unverified report must not authorize task closure');

db=makeDb({bookImportReports:[freshReport({
  fileName:'Keuzelijst bibliotheek (1).xlsx',
  rows:[{...freshReport().rows[0],worksheetRow:44}],
})]});
assert.equal(latestImportForTask(db,db.bookImportDeferredBookChecks[0]).authorConfirmed,true);
assert.equal(latestImportForTask(db,db.bookImportDeferredBookChecks[0]).sourceIdentifierConfirmed,true);
assert.equal(buildTaskPreflight(db).tasks[0].rule,'newer_import_still_needs_copy_proof');
assert.equal(buildTaskPreflight(db).summary.automatic_candidate,0,
  'Preflight itself does not modify tasks until an import actually commits');
for(const status of ['created','copies_added','loan_restored']){
  const dbForStatus=makeDb();
  const reportForStatus=freshReport({
    rows:[{...freshReport().rows[0],status}],
  });
  assert.equal(closeTasksProvenByImport(dbForStatus,reportForStatus).closed,1,
    'A proven '+status+' row must also be considered completed');
}
const crossFile=makeDb({bookImportReports:[freshReport()]});
assert.equal(latestImportForTask(crossFile,
  crossFile.bookImportDeferredBookChecks[0]).exactEdition,true,
  'A later workbook with the same title and ISBN is relevant history, not copy proof');
const crossedWithoutIdentifiers=makeDb({bookImportReports:[freshReport({
  rows:[{worksheetRow:60,title:'Voorbeeldboek',editionIsbn:'',
    status:'unchanged',sourceIdentifier:'',sourcePrintedBarcode:''}],
})]});
assert.equal(latestImportForTask(crossedWithoutIdentifiers,
  crossedWithoutIdentifiers.bookImportDeferredBookChecks[0]),null,
  'A similar title on another workbook is not sufficient historical evidence');

// Check server wiring, including source proof persisted before a report is
// added, and the atomic closure before saveReviewedBookImportDb.
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert.match(server,/sourceQuantity:book\.quantity\?\.valid===true/);
assert.match(server,/sourcePrintedBarcode:String\(book\.barcode/);
assert.match(server,/report\.autoClosedEarlierBookChecks=closeTasksProvenByImport\(/);
assert.match(server,/report\.autoClosedEarlierBookChecks=[\s\S]*?saveReviewedBookImportDb\(database\)/);
console.log('Later imports recheck old notifications: unique physical evidence, uncertain history, no book/loan edits OK');

 // Index each retained report only once per assessment even for large
 // backlogs, so opening Tasks cannot freeze the server's event loop.
let rowReads=0;
const reports=Array.from({length:30},(_,n)=>({
  id:'batch-'+n,fileName:'Keuzelijst bibliotheek (1).xlsx',
  importedAt:'2026-11-17T10:00:00.000Z',
  rows:Array.from({length:2000},(_,i)=>({
    worksheetRow:i+1,
    get title(){rowReads++;return 'Onbekende titel '+i;},
    author:'Auteur',editionIsbn:'',status:'unchanged',
  })),
}));
const backlog=makeDb({
  bookImportReports:reports,
  bookImportDeferredBookChecks:Array.from({length:1600},(_,i)=>oldTask({
    id:'task-'+i,worksheetRow:i+1,title:'Onbekende titel '+i,
    sourcePrintedBarcode:'',editionIsbn:'',excelIdentifier:'',
  })),
});
const indexed=buildTaskPreflight(backlog);
assert.equal(indexed.summary.open,1600);
assert.ok(rowReads<=120000,
  'The lookup must not rescan every imported row for each old task');
console.log('Indexed historical import lookup: '+rowReads+' title reads over 60000 rows');
