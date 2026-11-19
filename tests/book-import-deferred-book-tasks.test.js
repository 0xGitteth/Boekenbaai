'use strict';
const assert=require('node:assert/strict');
const {listDeferredBookTasks,resolveDeferredBookTask,
  listDeferredImportHistory}=require('../book-import-deferred-book-tasks');
const admin={role:'admin',id:'admin-1'};
const db={bookImportDeferredBookChecks:[
  {id:'first',batchId:'b1',fileName:'bibliotheek.xlsx',
    worksheetRow:75,title:'Het zwarte gat',author:'Donald Duck',
    excelIdentifier:'9789663058674',status:'open',
    createdAt:'2026-11-16T15:00:00Z'},
  {id:'second',batchId:'b1',fileName:'bibliotheek.xlsx',
    worksheetRow:248,title:'Julius zebra',author:'Gary Northfield',
    status:'open',createdAt:'2026-11-16T15:10:00Z'},
  {id:'old',status:'completed',createdAt:'2026-11-16T15:00:00Z'},
]};
assert.equal(listDeferredBookTasks(db).summary.open,2);
assert.equal(resolveDeferredBookTask(db,{role:'teacher',id:'t'},'first',1,'manual_done').ok,false);
assert.equal(resolveDeferredBookTask(db,admin,'first',2,'manual_done').ok,false);
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'keep_deferred').unchanged,true);
assert.equal(listDeferredBookTasks(db).summary.open,2);
// An administrative conclusion is not a physical observation. It requires
// an explicit catalogue copy, a current revision and written source evidence.
const reviewed={
  books:[{id:'book-1',title:'Matilda',author:'Roald Dahl',
    metadataIsbn:'9780582401983',barcode:'582401984'}],
  bookImportDeferredBookChecks:[{id:'admin-row',batchId:'batch-one',
    worksheetRow:61,title:'Matilda',author:'Roald Dahl',
    excelIdentifier:'582401984',status:'open',revision:1}],
};
const candidates=listDeferredBookTasks(reviewed).tasks[0].catalogCandidates;
assert.equal(candidates.length,1);
assert.equal(candidates[0].id,'book-1');
const evidence={bookId:'book-1',reason:'source_identifier_corrected',
  evidenceNote:'Excelrij 61 correspondeert met de unieke bewaarde barcode.',
  confirmed:true};
assert.equal(resolveDeferredBookTask(reviewed,admin,'admin-row',1,
  'administrative_done',undefined,{...evidence,confirmed:false}).ok,false);
assert.equal(resolveDeferredBookTask(reviewed,admin,'admin-row',1,
  'administrative_done',undefined,{...evidence,bookId:'wrong'}).ok,false);
assert.equal(resolveDeferredBookTask(reviewed,admin,'admin-row',1,
  'administrative_done',undefined,evidence).ok,true);
assert.equal(reviewed.bookImportDeferredBookChecks[0].resolution,'administrative_done');
assert.equal(reviewed.bookImportDeferredBookChecks[0].administrativeEvidence.bookId,'book-1');
assert.equal(reviewed.bookImportDeferredBookTaskHistory[0].action,'administrative_done');
assert.equal(reviewed.books[0].barcode,'582401984',
  'Administrative closure must never mutate an actual catalogue book');
const mismatch={
  books:[{id:'other-edition',title:'Het web',author:'Johan Heyink',
    metadataIsbn:'9789026997471'}],
  bookImportDeferredBookChecks:[{id:'conflict',title:'Het web',
    author:'Johan Heyink',editionIsbn:'9789001561383',
    status:'open',revision:1}],
};
assert.equal(listDeferredBookTasks(mismatch).tasks[0].catalogCandidates.length,0);
assert.equal(resolveDeferredBookTask(mismatch,admin,'conflict',1,
  'administrative_done',undefined,{...evidence,bookId:'other-edition'}).ok,false,
  'Known conflicting ISBN editions must not be closed as administratively verified');
const duplicateId={
  books:[{id:'duplicate-copy',title:'Matilda',author:'Roald Dahl'},
    {id:'duplicate-copy',title:'Matilda',author:'Roald Dahl'}],
  bookImportDeferredBookChecks:[{id:'source-copy',title:'Matilda',
    author:'Roald Dahl',status:'open',revision:1}],
};
assert.equal(resolveDeferredBookTask(duplicateId,admin,'source-copy',1,
  'administrative_done',undefined,{...evidence,bookId:'duplicate-copy'}).ok,false,
  'An ambiguous or duplicated physical ID must never be accepted');
const many={
  books:Array.from({length:23},(_,i)=>({
    id:'copy-'+i,title:'Matilda',author:'Roald Dahl',
    metadataIsbn:'9780582401983',
  })),
  bookImportDeferredBookChecks:[{id:'many',title:'Matilda',
    author:'Roald Dahl',excelIdentifier:'9780582401983',
    status:'open',revision:1}],
};
const manyTask=listDeferredBookTasks(many).tasks[0];
assert.equal(manyTask.catalogCandidateCount,23);
assert.equal(manyTask.catalogCandidates.length,20);
assert.equal(resolveDeferredBookTask(many,admin,'many',1,
  'administrative_done',undefined,{...evidence,bookId:'copy-22'}).ok,true,
  'A verified matching copy outside the preview page must be accepted by ID');
// Reproduce historic Excel identifiers used on the live book task cards.
// Exact metadata ISBN or the OLD source barcode is an administrative REVIEW
// candidate, not proof of extra physical copies.
const historic={
  books:[
    {id:'door-jou',title:'Door jou ben ik mij',author:'Andere bronvermelding',
      barcode:'9789043531788'},
    {id:'fantastic',title:'Fantastic Mr Fox',author:'Roald Dahl',
      barcode:'141318279'},
    {id:'matilda-excel',title:'Matilda',author:'Roald Dahl',
      barcode:'582401984',metadataIsbn:'9780582401983'},
    {id:'chocolate-typo',title:'The Chocolate ewar',author:'Robert Cormier',
      barcode:'9780275829871'},
    {id:'chocolate-edition',title:'The Chocolate war',author:'Robert Cormier',
      metadataIsbn:'9780375829871'},
    {id:'jessica',title:'Mijn broer heet Jessica',author:'John Boyne',
      barcode:'10000086070'},
    {id:'wrong-book',title:'Ander boek',author:'Hinke van Abbema',
      barcode:'9789043531788'},
  ],
  bookImportDeferredBookChecks:[
    {id:'door',title:'Door jou ben ik mij',author:'Hinke van Abbema',
      excelIdentifier:'9789043531788',status:'open',revision:1},
    {id:'fant',title:'Fantastic Mr Fox',author:'Roald Dahl',
      excelIdentifier:'141318279',status:'open',revision:1},
    {id:'mat',title:'Matilda',author:'Roald Dahl',
      excelIdentifier:'582401984',status:'open',revision:1},
    {id:'choc',title:'The Chocolate war',author:'Robert Cormier',
      excelIdentifier:'9780275829871',status:'open',revision:1},
    {id:'jess',title:'Mijn broer heet Jessica',author:'John Boyne',
      excelIdentifier:'9789022587546',status:'open',revision:1},
  ],
};
const historicTasks=listDeferredBookTasks(historic).tasks;
const candidate=id=>historicTasks.find(task=>task.id===id).catalogCandidates;
assert.deepEqual(candidate('door').map(book=>book.id),['door-jou'],
  'Exact ISBN may be shown for review even when old author metadata differs');
assert.equal(candidate('door')[0].authorMatches,false);
assert.deepEqual(candidate('fant').map(book=>book.id),['fantastic'],
  'A nine-digit Excel numeric barcode must match the stored raw barcode');
assert.deepEqual(candidate('mat').map(book=>book.id),['matilda-excel'],
  'A dropped leading zero must resolve to the same ISBN-10 and edition');
assert.deepEqual(candidate('choc').map(book=>book.id),['chocolate-typo'],
  'A raw mistyped source barcode is a candidate but not a verified edition');
assert.deepEqual(candidate('jess').map(book=>book.id),[],
  'A shared title cannot prove an unrelated school barcode belongs to the ISBN');
const historicalEvidence={
  bookId:'door-jou',reason:'catalog_registration_verified',
  evidenceNote:'The matching ISBN is independently recorded in the live catalogue.',
  confirmed:true,
};
assert.equal(resolveDeferredBookTask(historic,admin,'door',1,
  'administrative_done',undefined,historicalEvidence).ok,true);
assert.equal(historic.books[0].barcode,'9789043531788',
  'Resolving the task must not modify the stored barcode');
const history=listDeferredBookTasks(historic).recentResolutions;
assert.equal(history[0].bookId,'door-jou');
assert.equal(history[0].evidenceNote,historicalEvidence.evidenceNote);
assert.equal(history[0].resolution,'administrative_done');

const deferredUi=require('node:fs').readFileSync(
  require('node:path').join(__dirname,'../public/admin-deferred-book-tasks.js'),'utf8');
assert.match(deferredUi,/history\.open=historyExpanded/,
  'Previously opened resolution history must survive automatic refresh');
assert.match(deferredUi,/historyHost.append\(history\)/,
  'Administrative evidence must be visible after resolution');
assert.match(deferredUi,/pending=false;\s*await refresh\(\)/,
  'Action buttons must not be rebuilt in a disabled state after success');
assert.match(deferredUi,/administrativeDrafts=new Map\(\)/,
  'Administrative form drafts must survive polling');
assert.match(deferredUi,/note\.addEventListener\('input',saveDraft\)/);
assert.match(deferredUi,/adminDetails\.open=draft\.expanded===true/);
assert.match(deferredUi,/manualId\.addEventListener\('input',saveDraft\)/);
assert.match(deferredUi,/const bookId=\(manualId\?\.value/,
  'There must be a UI route to choose an overflow candidate by exact ID');
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'manual_done').ok,true);
assert.equal(listDeferredBookTasks(db).summary.open,1);
assert.equal(db.bookImportDeferredBookChecks[0].revision,2);
assert.equal(db.bookImportDeferredBookTaskHistory.length,1);
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'manual_done').ok,false);
// Old source rows must remain auditable after being marked complete,
// with separate CURRENT counts and the precise administrative evidence.
const auditDb={bookImportDeferredBookChecks:[
  {id:'open-1',status:'open',title:'Lucky Luke',
    fileName:'eerste.xlsx',worksheetRow:78,excelIdentifier:'631700264'},
  {id:'completed-1',status:'completed',resolution:'administrative_done',
    title:'Het zwarte gat',fileName:'eerste.xlsx',worksheetRow:75,
    excelIdentifier:'9789663058674',completedAt:'2026-11-19T12:30:00Z',
    administrativeEvidence:{bookId:'copy-1',evidenceNote:
      'Excelrij 75 verwijst naar de bestaande catalogusbarcode.'}},
  {id:'completed-2',status:'completed',resolution:'auto_newer_import_verified_copy',
    title:'Het web',fileName:'tweede.xlsx',worksheetRow:114,
    completedAt:'2026-11-19T14:00:00Z',newerImportEvidence:{
      reportId:'batch-later',bookId:'copy-2'}},
  {id:'completed-3',status:'completed',resolution:'manual_done',
    title:'Zat',completedAt:'2026-11-18T14:00:00Z'},
]};
const snapshot=JSON.stringify(auditDb);
const audit=listDeferredImportHistory(auditDb);
assert.equal(JSON.stringify(auditDb),snapshot,
  'Import history must be a read-only projection');
assert.equal(audit.count,1);
assert.equal(audit.resolvedCount,3);
assert.equal(audit.shown,1);
assert.equal(audit.resolvedShown,3);
assert.equal(audit.items[0].id,'open-1');
assert.deepEqual(audit.resolvedItems.map(item=>item.id),
  ['completed-2','completed-1','completed-3'],
  'Completed source rows are sorted newest first');
assert.equal(audit.resolvedItems[1].bookId,'copy-1');
assert.equal(audit.resolvedItems[1].evidenceNote,
  'Excelrij 75 verwijst naar de bestaande catalogusbarcode.');
assert.equal(audit.resolvedItems[0].proofReportId,'batch-later');
assert.equal(audit.resolvedItems[2].resolution,'manual_done');
const capped=listDeferredImportHistory(auditDb,1);
assert.equal(capped.count,1);
assert.equal(capped.resolvedCount,3);
assert.equal(capped.resolvedItems.length,1);
const uiSource=require('node:fs').readFileSync(
  require('node:path').join(__dirname,'../public/admin-book-import-review.js'),'utf8');
const tasksSource=require('node:fs').readFileSync(
  require('node:path').join(__dirname,'../public/admin-deferred-book-tasks.js'),'utf8');
const serverSource=require('node:fs').readFileSync(
  require('node:path').join(__dirname,'../server.js'),'utf8');
assert.match(serverSource,/listDeferredImportHistory\(getDb\(\)\)/);
assert.match(uiSource,/const resolvedItems=Array\.isArray\(data\.resolvedItems\)/);
assert.match(uiSource,/Historisch uitgesteld, later afgehandeld/);
assert.match(uiSource,/book-task-resolved/);
assert.doesNotMatch(uiSource,/Deze boeken zijn niet geïmporteerd\./,
  'A historical source warning must not assert a book is still missing');
assert.equal((tasksSource.match(/dispatchEvent\(new Event\('boekenbaai:book-task-resolved'\)\)/g)||[]).length,2,
  'Both real resolution actions notify the import history view');

console.log('Persistent postponed book tasks: OK');
