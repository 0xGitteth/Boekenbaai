'use strict';
const assert=require('node:assert/strict');
const {buildTaskPreflight}=require('../task-preflight');
const {applySafeTaskClosures,MAX_BATCH}=require('../task-auto-closure');
const isbn='9780306406157';
const actor={id:'admin',role:'admin'};
const other={id:'teacher',role:'teacher'};
const book=(id='book-a')=>({id,title:'Voorbeeldboek',author:'Auteur',
  editionIsbn:isbn,status:'available',fixedLocation:'Kast A'});
const task=(id,options={})=>({
  id,batchId:'import-1',worksheetRow:8,title:'Voorbeeldboek',
  author:'Auteur',editionIsbn:isbn,excelIdentifier:isbn,bookId:'book-a',
  status:'open',revision:1,...options,
});
const uuid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const db=()=>({books:[book()],students:[{id:'s1',borrowedBooks:[]}],
  classes:[{id:'c1'}],bookImportDeferredBookChecks:[task('a'),task('b')]});
const payload=(data,ids,number=1)=>({
  scope:'verified_source_notification_duplicate',confirm:true,
  confirmation:'close_verified_duplicate_notifications',
  fingerprint:buildTaskPreflight(data).fingerprint,taskIds:ids,
  revisions:ids.map(id=>({id,revision:1})),operationId:uuid(number),
});
let data=db();
let preview=buildTaskPreflight(data);
assert.equal(preview.summary.automatic_candidate,1);
assert.equal(preview.tasks.find(t=>t.id==='b').duplicateOf,'a');
const request=payload(data,['b']);
const bookBefore=JSON.stringify(data.books);
const peopleBefore=JSON.stringify(data.students);
const classesBefore=JSON.stringify(data.classes);
const result=applySafeTaskClosures(data,actor,request,'2026-11-17T12:00:00Z');
assert.equal(result.ok,true);
assert.equal(result.closed,1);
assert.equal(data.bookImportDeferredBookChecks[0].status,'open');
assert.equal(data.bookImportDeferredBookChecks[1].status,'completed');
assert.equal(data.bookImportDeferredBookChecks[1].resolution,'auto_duplicate_notification');
assert.equal(data.bookImportDeferredBookChecks[1].revision,2);
assert.equal(data.taskAutoClosureHistory.length,1);
assert.equal(data.taskAutoClosureHistory[0].retainedTaskId,'a');
assert.equal(JSON.stringify(data.books),bookBefore);
assert.equal(JSON.stringify(data.students),peopleBefore);
assert.equal(JSON.stringify(data.classes),classesBefore);
assert.equal(buildTaskPreflight(data).summary.automaticallyResolved,1);
assert.equal(buildTaskPreflight(data).recentAutoResolutions.length,1);
const first=JSON.stringify(data);
assert.equal(applySafeTaskClosures(data,actor,request).replayed,true);
assert.equal(JSON.stringify(data),first,'Idempotent retry must not alter the DB');
assert.equal(applySafeTaskClosures(data,actor,{...request,taskIds:['a'],
  revisions:[{id:'a',revision:1}]}).error,'operation_id_reused');
assert.equal(applySafeTaskClosures(data,actor,{
  ...request,operationId:uuid(2),
}).error,'stale_preflight');

for(const item of [
  {name:'teacher',role:'teacher',payload:request,expected:'forbidden'},
  {name:'no confirmation',role:'admin',payload:{...request,confirm:false},
    expected:'invalid_confirmation'},
  {name:'wrong scope',role:'admin',payload:{...request,scope:'all_tasks'},
    expected:'invalid_confirmation'},
  {name:'duplicate IDs',role:'admin',payload:{...request,taskIds:['b','b']},
    expected:'invalid_confirmation'},
  {name:'unbound revision',role:'admin',payload:{...request,revisions:[{id:'a',revision:1}]},
    expected:'missing_revision'},
]){
  const fresh=db();
  const body={...item.payload, fingerprint:buildTaskPreflight(fresh).fingerprint,
    operationId:uuid(3)};
  const before=JSON.stringify(fresh);
  const out=applySafeTaskClosures(fresh,{id:'admin',role:item.role},body);
  assert.equal(out.error,item.expected,item.name);
  assert.equal(JSON.stringify(fresh),before,item.name+' must not mutate');
}
data=db();
let correct=payload(data,['b']);
correct.revisions[0].revision=2;
assert.equal(applySafeTaskClosures(data,actor,correct).error,'stale_task_revision');
assert.equal(data.taskAutoClosureHistory,undefined);
data=db();
correct=payload(data,['b']);correct.taskIds=['b','nonexistent'];
correct.revisions.push({id:'nonexistent',revision:1});
assert.equal(applySafeTaskClosures(data,actor,correct).error,'not_proven_safe');
assert.equal(data.taskAutoClosureHistory,undefined,'A failed batch must not partially close tasks');
// Real import-deferred book checks are created before a copy ID exists.
// Exact same source event may close only the redundant notification.
data=db();
data.bookImportDeferredBookChecks[0].bookId=null;
data.bookImportDeferredBookChecks[1].bookId=null;
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,1,
  'A repeated skipped-row notification does not require a physical copy ID');
// Real imports did not store a revision; the API preview normalizes it to 1.
delete data.bookImportDeferredBookChecks[0].revision;
delete data.bookImportDeferredBookChecks[1].revision;
const sourceRequest=payload(data,['b'],5);
const untouchedBooks=JSON.stringify(data.books);
assert.equal(applySafeTaskClosures(data,actor,sourceRequest).ok,true);
assert.equal(data.bookImportDeferredBookChecks[1].revision,2,
  'A missing stored revision is normalized before incrementing');
assert.equal(data.bookImportDeferredBookChecks[0].status,'open');
assert.equal(JSON.stringify(data.books),untouchedBooks);
data=db();
data.bookImportDeferredBookChecks[1].bookId='';
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,0,
  'A task with a different physical reference is a distinct source event');
data=db();
data.books.push(book('book-b'));
data.bookImportDeferredBookChecks[1].bookId='book-b';
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,0,
  'Different physical copies cannot be closed as duplicates');
data=db();
data.bookImportDeferredBookChecks[1].batchId='import-2';
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,0,
  'Different imports cannot be silently merged');
data=db();
data.books=[];
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,0,
  'Missing physical copy cannot be silently resolved');
data=db();
data.books.push(book('book-a'));
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,0,
  'Ambiguous duplicate physical IDs cannot be silently resolved');

const completed=task('finished',{status:'completed',resolution:'manual_done',
  completedBy:'admin',completedAt:'2026-11-16T10:00:00Z'});
data={books:[book()],bookImportDeferredBookChecks:[completed,task('outdated')],
  bookImportDeferredBookTaskHistory:[{
    taskId:'finished',action:'manual_done',timestamp:completed.completedAt,actorId:'admin',
  }]};
assert.equal(buildTaskPreflight(data).tasks[0].rule,'source_event_already_reviewed');
const oldPayload=payload(data,['outdated'],4);
assert.equal(applySafeTaskClosures(data,actor,oldPayload).ok,true);
assert.equal(data.bookImportDeferredBookChecks[1].resolution,
  'auto_already_reviewed_notification');
data={books:[book()],bookImportDeferredBookChecks:[completed,task('outdated')],
  bookImportDeferredBookTaskHistory:[]};
assert.equal(buildTaskPreflight(data).summary.automatic_candidate,0,
  'An unaudited old completion must not authorize a new closure');
assert.equal(MAX_BATCH,50);
data=db();
const tooMany=payload(data,['b']);
tooMany.taskIds=Array.from({length:51},(_,i)=>'id-'+i);
assert.equal(applySafeTaskClosures(data,actor,tooMany).error,'invalid_confirmation');
console.log('Safe task-only execution: proof, physical identity, atomic batch, audit, idempotence, approvals and no loan/person changes OK');
