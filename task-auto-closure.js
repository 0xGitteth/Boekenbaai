'use strict';

// Pure, synchronous decision made against the CURRENT database snapshot.
// The caller must hold the shared database write lock while invoking this.
// Never edits books, loans, class links or people.
const {buildTaskPreflight}=require('./task-preflight');

const MAX_BATCH=50;
const allowedRules=new Set(['duplicate_source_event','source_event_already_reviewed']);
const validId=value=>typeof value==='string'&&/^[a-z0-9-]{1,100}$/i.test(value);
const uniqueIds=value=>Array.isArray(value)&&value.length>=1&&value.length<=MAX_BATCH
  &&value.every(validId)&&new Set(value).size===value.length;
const hexHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const operationIdValid=value=>typeof value==='string'
  &&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const comparable=value=>JSON.stringify(value);

function applySafeTaskClosures(db,actor,payload,now=new Date().toISOString()) {
  if(actor?.role!=='admin'||!actor.id)return {ok:false,error:'forbidden'};
  if(!payload||payload.confirm!==true
    ||payload.scope!=='verified_source_notification_duplicate'
    ||payload.confirmation!=='close_verified_duplicate_notifications'
    ||!uniqueIds(payload.taskIds)||!hexHash(payload.fingerprint)
    ||!operationIdValid(payload.operationId)
    ||!Array.isArray(payload.revisions)
    ||payload.revisions.length!==payload.taskIds.length
    ||payload.revisions.some(x=>!x||!validId(x.id)
      ||!Number.isSafeInteger(x.revision)||x.revision<1))
    return {ok:false,error:'invalid_confirmation'};

  const orderedIds=[...payload.taskIds].sort();
  const revisions=new Map();
  for(const value of payload.revisions) {
    if(revisions.has(value.id))return {ok:false,error:'duplicate_revision'};
    revisions.set(value.id,value.revision);
  }
  if(orderedIds.some(id=>!revisions.has(id)))
    return {ok:false,error:'missing_revision'};

  const operations=Array.isArray(db.taskAutoClosureOperations)
    ?db.taskAutoClosureOperations:[];
  const previous=operations.find(item=>item.id===payload.operationId);
  if(previous){
    if(previous.actorId!==actor.id||previous.fingerprint!==payload.fingerprint
      ||comparable(previous.taskIds)!==comparable(orderedIds)
      ||comparable(previous.revisions)!==comparable(
        orderedIds.map(id=>({id,revision:revisions.get(id)}))))
      return {ok:false,error:'operation_id_reused'};
    return {ok:true,replayed:true,closed:previous.taskIds.length,
      taskIds:[...previous.taskIds],operationId:payload.operationId};
  }

  // Reassess all evidence and outstanding revisions under the same DB lock.
  const assessment=buildTaskPreflight(db);
  if(assessment.fingerprint!==payload.fingerprint)
    return {ok:false,error:'stale_preflight'};
  const selected=new Map(assessment.tasks
    .filter(t=>t.family==='physical'&&t.category==='automatic_candidate'
      &&allowedRules.has(t.rule)).map(t=>[t.id,t]));
  const physical=Array.isArray(db.bookImportDeferredBookChecks)
    ?db.bookImportDeferredBookChecks:[];
  const closures=[];
  for(const id of orderedIds){
    const plan=selected.get(id);
    const records=physical.filter(task=>task.id===id&&task.status==='open');
    if(!plan||records.length!==1)return {ok:false,error:'not_proven_safe',taskId:id};
    const task=records[0];
    const storedRevision=Number.isSafeInteger(task.revision)&&task.revision>=1
      ?task.revision:1;
    if(plan.revision!==revisions.get(id)||storedRevision!==revisions.get(id))
      return {ok:false,error:'stale_task_revision',taskId:id};
    // These are duplicate *notifications* for a postponed Excel source row,
    // not proof that physical books are equal. An imported skipped row may
    // have no copy ID yet. Require the same import, row and full source
    // fingerprint; where a copy ID exists it must remain unique in storage.
    if(!task.batchId||!Number.isSafeInteger(task.worksheetRow)
      ||task.worksheetRow<1
      ||(task.bookId&&(db.books||[]).filter(book=>book.id===task.bookId).length!==1))
      return {ok:false,error:'source_notification_unproven',taskId:id};
    if(!plan.duplicateOf||plan.duplicateOf===id)
      return {ok:false,error:'missing_retained_event',taskId:id};
    if(plan.rule==='duplicate_source_event'){
      const retained=physical.filter(other=>other.id===plan.duplicateOf
        &&other.status==='open'&&other.batchId===task.batchId
        &&other.worksheetRow===task.worksheetRow
        &&(other.bookId||null)===(task.bookId||null)
        &&(other.barcode||null)===(task.barcode||null)
        &&(other.sourcePrintedBarcode||null)===(task.sourcePrintedBarcode||null)
        &&(other.sourceQuantity??null)===(task.sourceQuantity??null));
      if(retained.length!==1||orderedIds.includes(retained[0].id))
        return {ok:false,error:'retained_task_unavailable',taskId:id};
    }else{
      const retained=physical.filter(other=>other.id===plan.duplicateOf
        &&other.status==='completed'&&other.resolution==='manual_done'
        &&other.batchId===task.batchId
        &&other.worksheetRow===task.worksheetRow
        &&(other.bookId||null)===(task.bookId||null)
        &&(other.barcode||null)===(task.barcode||null)
        &&(other.sourcePrintedBarcode||null)===(task.sourcePrintedBarcode||null)
        &&(other.sourceQuantity??null)===(task.sourceQuantity??null));
      if(retained.length!==1)return {ok:false,error:'completed_source_unproven',taskId:id};
    }
    closures.push({task,plan,storedRevision});
  }

  // No mutation before every selected task has passed validation.
  if(!Array.isArray(db.taskAutoClosureHistory))db.taskAutoClosureHistory=[];
  if(!Array.isArray(db.taskAutoClosureOperations))db.taskAutoClosureOperations=[];
  for(const {task,plan,storedRevision} of closures){
    const priorRevision=storedRevision;
    task.status='completed';
    task.resolution=plan.rule==='duplicate_source_event'
      ?'auto_duplicate_notification':'auto_already_reviewed_notification';
    task.revision=priorRevision+1;
    task.completedAt=now;
    task.completedBy=actor.id;
    db.taskAutoClosureHistory.push({
      taskId:task.id,sourceReportId:task.batchId||task.reportId||null,
      bookId:task.bookId,retainedTaskId:plan.duplicateOf,rule:plan.rule,
      priorRevision,revision:task.revision,fingerprint:payload.fingerprint,
      actorId:actor.id,operationId:payload.operationId,at:now,
    });
  }
  db.taskAutoClosureOperations.push({
    id:payload.operationId,actorId:actor.id,at:now,
    fingerprint:payload.fingerprint,taskIds:orderedIds,
    revisions:orderedIds.map(id=>({id,revision:revisions.get(id)})),
    scope:payload.scope,
  });
  return {ok:true,replayed:false,closed:closures.length,
    taskIds:orderedIds,operationId:payload.operationId};
}

module.exports={applySafeTaskClosures,MAX_BATCH};
