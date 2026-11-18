'use strict';
const assert=require('node:assert/strict');
const {buildTaskPreflight}=require('../task-preflight');
const isbn='9780306406157';
const physical=(id, overrides={})=>({id,batchId:'import-1',worksheetRow:7,title:'Voorbeeldboek',author:'Auteur',editionIsbn:isbn,excelIdentifier:isbn,status:'open',...overrides});
const copy=(id, overrides={})=>({id,title:'Voorbeeldboek',author:'Auteur',editionIsbn:isbn,status:'available',...overrides});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
let db={books:[copy('a'),copy('b')],bookImportDeferredBookChecks:[physical('t1'),physical('t2',{batchId:'import-2'})]};
const before=JSON.stringify(db);const preview=buildTaskPreflight(freeze(db));
assert.equal(JSON.stringify(db),before);
assert.equal(preview.summary.automatic_candidate,0,'Two imports with one ISBN do not identify one copy');
assert.equal(preview.summary.proposal,2);
assert.equal(preview.tasks[0].current.matchingEditionCount,2);
assert.equal(preview.writesAllowed,false);
assert.equal(preview.summary.automaticallyResolved,0);
db={books:[copy('a')],bookImportDeferredBookChecks:[
  physical('t1',{bookId:'a'}),physical('t2',{bookId:'a'})]};
assert.equal(buildTaskPreflight(db).tasks[1].duplicateOf,'t1');
assert.equal(buildTaskPreflight(db).summary.automatic_candidate,1);
for(const change of [{worksheetRow:8},{editionIsbn:'9789025873974'},{author:'Andere auteur'},{sourceEvidence:{issues:[{code:'conflict'}]}},{batchId:null},{bookId:'different-copy'},{barcode:'physical-2'}]){
  db.bookImportDeferredBookChecks=[physical('t1'),physical('t2',change)];
  assert.equal(buildTaskPreflight(db).summary.automatic_candidate,0,JSON.stringify(change));
}
db.bookImportDeferredBookChecks=[physical('same'),physical('same')];
assert.equal(buildTaskPreflight(db).summary.automatic_candidate,0,'Ambiguous task IDs cannot be auto-closed');
db.bookImportDeferredBookChecks=[physical('t1',{editionIsbn:'9789001561330'})];
assert.equal(buildTaskPreflight(db).tasks[0].category,'attention','Invalid checksum is not repaired by guessing');
db={books:[copy('a',{metadataIsbn:'9789025873974'})],bookImportDeferredBookChecks:[physical('t1')]};
assert.equal(buildTaskPreflight(db).tasks[0].category,'attention','Contradictory edition identities are not evidence');
db={books:[copy('a')],bookImportAssignmentTasks:[{...physical('admin1'),kind:'issue',reason:'source_conflict',reportId:'r',differenceId:'d',bookId:null}]};
assert.equal(buildTaskPreflight(db).tasks[0].rule,'edition_found_copy_unproven','Existing title does not resolve a source conflict');
const location={...physical('loc'),kind:'location',reportId:'r',differenceId:'d',bookId:'a',original:{after:'Klas A',circulationRevision:0}};
db={books:[copy('a',{fixedLocation:'Klas A'})],bookImportAssignmentTasks:[location]};
assert.equal(buildTaskPreflight(db).tasks[0].rule,'location_target_present');
const hash=buildTaskPreflight(db).fingerprint;
db.bookImportLoanActivityCounters={a:1};
assert.equal(buildTaskPreflight(db).tasks[0].rule,'later_circulation_activity');
assert.notEqual(buildTaskPreflight(db).fingerprint,hash);
db.books=[];
assert.equal(buildTaskPreflight(db).tasks[0].rule,'missing_or_ambiguous_copy');
db={studentExitTasks:[{id:'s',status:'open'}],teacherExitTasks:[{id:'t',status:'open'}],bookImportFollowups:[{id:'c',status:'admin_review'}]};
assert.equal(buildTaskPreflight(db).summary.attention,3);
assert.ok(buildTaskPreflight(db).tasks.every(t=>t.requiresSeparateConfirmation));
db={bookImportDeferredBookChecks:Array.from({length:1600},(_,i)=>physical('t'+i,{worksheetRow:i+1}))};
assert.equal(buildTaskPreflight(db).summary.open,1600,'All historical open tasks are assessed');
console.log('Task preflight: immutable input, duplicate events, distinct copies, stale circulation and uncertain evidence OK');

const done=physical('done',{bookId:'a',status:'completed',resolution:'manual_done',completedBy:'admin',completedAt:'2026-11-17T00:00:00Z'});
db={books:[copy('a')],bookImportDeferredBookChecks:[done,physical('open',{bookId:'a'})],bookImportDeferredBookTaskHistory:[{taskId:'done',action:'manual_done',actorId:'admin',timestamp:done.completedAt}]};
assert.equal(buildTaskPreflight(db).tasks[0].rule,'source_event_already_reviewed');
db.bookImportDeferredBookTaskHistory=[];
assert.equal(buildTaskPreflight(db).summary.automatic_candidate,0,'Completion without audit proof is insufficient');

const {retainDeferredBookChecks}=require('../book-import-deferred-book-tasks');
db={bookImportDeferredBookChecks:Array.from({length:1500},(_,i)=>physical('old'+i,{worksheetRow:i+1}))};
retainDeferredBookChecks(db,[physical('new',{batchId:'new-import'})]);
assert.equal(db.bookImportDeferredBookChecks.length,1501,'Persisting new tasks preserves older records');
retainDeferredBookChecks(db,[physical('repeated-emission',{batchId:'new-import'})]);
assert.equal(db.bookImportDeferredBookChecks.length,1501,'Repeated event is suppressed');
retainDeferredBookChecks(db,[physical('different-copy',{batchId:'new-import',bookId:'copy-2'})]);
assert.equal(db.bookImportDeferredBookChecks.length,1502,'Different physical identity is retained');

// Large backlog: catalog normalization must be linear, not tasks × books.
let reads=0;
const manyBooks=Array.from({length:2000},(_,i)=>({id:'copy-'+i,
  get title(){reads++;return 'Titel '+i;},author:'Auteur',editionIsbn:ISBN_FOR_SCALE()}));
function ISBN_FOR_SCALE(){return '9780306406157';}
const large={books:manyBooks,bookImportDeferredBookChecks:Array.from({length:1600},(_,i)=>physical('large-'+i,{title:'Titel '+i,worksheetRow:i+1}))};
const started=performance.now();const largeResult=buildTaskPreflight(large);
assert.equal(largeResult.summary.open,1600);
assert.ok(reads<=manyBooks.length*3,'Catalog fields must not be revisited for every task');
console.log('Preflight scale: 1600 tasks / 2000 books in '+Math.round(performance.now()-started)+' ms; '+reads+' title reads');
const commonEdition={books:Array.from({length:2000},(_,i)=>copy('same-'+i)),bookImportDeferredBookChecks:[physical('common')]};
const commonResult=buildTaskPreflight(commonEdition).tasks[0];
assert.equal(commonResult.current.matchingEditionCount,2000);
assert.equal(commonResult.current.matchingBookIds.length,20);
assert.equal(commonResult.current.candidateListTruncated,true);

// Postponed book-import rows have no physical copy ID yet. They still
// represent a single source event and repeated notices can be deduplicated.
const postponed={books:[copy('a')],bookImportDeferredBookChecks:[
  physical('source-a'),physical('source-b')]};
const sameRow=buildTaskPreflight(postponed);
assert.equal(sameRow.summary.automatic_candidate,1,
  'Exactly the same batch, worksheet row and content may deduplicate its notification');
assert.equal(sameRow.tasks[1].rule,'duplicate_source_event');
postponed.bookImportDeferredBookChecks[1].batchId=null;
const uncertain=buildTaskPreflight(postponed);
assert.equal(uncertain.summary.automatic_candidate,0,
  'Missing import identity cannot authorize safe notification closure');
