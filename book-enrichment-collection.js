'use strict';
// An explicit collection run records research only. It never consumes Brave
// credit and never changes the catalogue until a separate bulk confirmation.
const {randomUUID,createHash}=require('node:crypto');
const {isbnOf,workKey}=require('./book-free-metadata');
const {keyOf,getCheck,recordCheck,shouldProbe}=require('./book-enrichment-trial');
const {comparison,applyComparison}=require('./book-enrichment-comparison');
const {SOURCE_ORDER}=require('./book-enrichment-sources');
const LEASE_MS=120000;
const terminal=new Set(['found','not_found','identity_mismatch']);
const nowIso=now=>new Date(now).toISOString();
function eligible(book){
  return book?.id&&isbnOf(book)&&String(book.title||'').trim()&&String(book.author||'').trim()
    &&book.personalLoanOnly!==true;
}
function editions(db){
  const groups=new Map();
  for(const book of db.books||[]){
    if(!eligible(book))continue;
    const key=keyOf(book);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(book);
  }
  return groups;
}
function startRun(db,sources,{repeat=false,now=Date.now(),id=randomUUID()}={}){
  if(['running','paused','ready','partial'].includes(db.freeEnrichmentRun?.state))
    return {ok:false,error:'run_exists'};
  const ids=SOURCE_ORDER.filter(s=>sources.includes(s));
  if(!ids.length)return {ok:false,error:'no_sources'};
  const targets=[...editions(db)].map(([key,books])=>({key,bookIds:books.map(b=>b.id),attempts:{}}));
  if(!targets.length)return {ok:false,error:'no_books'};
  db.freeEnrichmentRun={id,state:'running',sources:ids,targets,repeat:repeat===true,
    createdAt:nowIso(now),updatedAt:nowIso(now),inFlight:null};
  return {ok:true,id};
}
function pauseRun(db,{now=Date.now()}={}){
  const run=db.freeEnrichmentRun;
  if(run?.state!=='running')return {ok:false,error:'not_running'};
  if(run.inFlight)run.pauseRequested=true;
  else run.state='paused';
  run.updatedAt=nowIso(now);
  return {ok:true};
}
function resumeRun(db,{now=Date.now()}={}){
  const run=db.freeEnrichmentRun;
  if(!run||!['partial','paused'].includes(run.state)||run.inFlight)return {ok:false,error:'not_resumable'};
  for(const target of run.targets){
    for(const source of run.sources){
      const attempt=target.attempts[source];
      if(attempt&&!['found','not_found','identity_mismatch','cached','removed'].includes(attempt.status))
        delete target.attempts[source];
    }
  }
  run.state='running';run.pauseRequested=false;run.updatedAt=nowIso(now);
  return {ok:true,id:run.id};
}
function liveBooks(db,target){
  const ids=new Set(target.bookIds);
  return (db.books||[]).filter(b=>ids.has(b.id)&&eligible(b)&&keyOf(b)===target.key);
}
function chooseTask(db,{now=Date.now(),blocked=new Set()}={}){
  const run=db.freeEnrichmentRun;
  if(run?.state!=='running')return null;
  if(run.inFlight){
    if(Date.parse(run.inFlight.at)+LEASE_MS>now)return {wait:true};
    // A crash is not proof of a negative lookup; ask for explicit resume.
    const target=run.targets.find(t=>t.key===run.inFlight.key);
    if(target)target.attempts[run.inFlight.source]={status:'interrupted',at:nowIso(now)};
    run.inFlight=null;
  }
  if(run.pauseRequested){run.state='paused';run.pauseRequested=false;run.updatedAt=nowIso(now);return null;}
  let pending=false,failed=false;
  for(const target of run.targets){
    const book=liveBooks(db,target)[0];
    for(const source of run.sources){
      const attempt=target.attempts[source];
      if(attempt){
        if(!terminal.has(attempt.status)&&!['cached','removed'].includes(attempt.status))failed=true;
        continue;
      }
      if(!book){target.attempts[source]={status:'removed',at:nowIso(now)};continue;}
      if(!shouldProbe(db,book,run.repeat,source)){
        target.attempts[source]={status:'cached',at:nowIso(now)};continue;
      }
      pending=true;
      if(blocked.has(source))continue;
      const claim={runId:run.id,key:target.key,bookId:book.id,source,token:randomUUID(),at:nowIso(now)};
      run.inFlight=claim;run.updatedAt=claim.at;
      return {...claim,book};
    }
  }
  if(pending)return {wait:true};
  run.state=failed?'partial':'ready';run.updatedAt=nowIso(now);
  return null;
}
function currentClaim(db,claim){
  const run=db.freeEnrichmentRun;
  return run?.state==='running'&&run.id===claim.runId&&run.inFlight?.token===claim.token;
}
function deferClaim(db,claim){
  if(!currentClaim(db,claim))return false;
  db.freeEnrichmentRun.inFlight=null;
  return true;
}
function finishTask(db,claim,result,{now=Date.now()}={}){
  if(!currentClaim(db,claim))return false;
  const run=db.freeEnrichmentRun,target=run.targets.find(t=>t.key===claim.key);
  const book=target&&liveBooks(db,target)[0];
  let status='removed';
  if(book){
    const check=recordCheck(db,book,result,{source:claim.source,now:new Date(now)});
    // A failed repeat can preserve an earlier successful record. It still
    // counts as a failed attempt in THIS run.
    status=check.lastAttemptAt===nowIso(now)?check.lastError:check.status;
  }
  if(target)target.attempts[claim.source]={status,at:nowIso(now)};
  run.inFlight=null;run.updatedAt=nowIso(now);
  if(run.pauseRequested){run.state='paused';run.pauseRequested=false;}
  return true;
}
function runStatus(db,failedCovers=new Set()){
  const run=db.freeEnrichmentRun;
  if(!run)return null;
  let completed=0,failed=0,skipped=0,proposed=0,conflicts=0;
  const revisions=[];
  for(const target of run.targets){
    for(const attempt of Object.values(target.attempts)){
      if(terminal.has(attempt.status)||attempt.status==='cached')completed++;
      else if(attempt.status==='removed')skipped++;
      else failed++;
    }
    if(['ready','partial'].includes(run.state)){
      for(const book of liveBooks(db,target)){
        const view=comparison(db,book,failedCovers);
        proposed+=view.changes.length;conflicts+=view.conflicts.length;
        revisions.push(view.revision);
      }
    }
  }
  return {id:run.id,state:run.state,editions:run.targets.length,sources:run.sources,
    total:run.targets.length*run.sources.length,completed,failed,skipped,proposed,conflicts,
    currentSource:run.inFlight?.source||null,updatedAt:run.updatedAt,applied:run.applied||null,
    pauseRequested:run.pauseRequested===true,
    reviewRevision:run.state==='ready'?createHash('sha256').update(JSON.stringify([run.id,revisions])).digest('hex'):null};
}
function applyRun(db,id,{revision,failedCovers=new Set(),now=Date.now()}={}){
  const run=db.freeEnrichmentRun;
  if(run?.id!==id||run.state!=='ready')return {ok:false,error:'not_ready'};
  if(!revision||runStatus(db,failedCovers).reviewRevision!==revision)return {ok:false,error:'stale_preview'};
  let updated=0,newCover=false,books=0,conflicts=0;
  for(const target of run.targets){
    for(const book of liveBooks(db,target)){
      const view=comparison(db,book,failedCovers);
      conflicts+=view.conflicts.length;
      if(!view.changes.length)continue;
      const outcome=applyComparison(db,book,view.revision,failedCovers,SOURCE_ORDER,new Date(now));
      if(outcome.ok){updated+=outcome.updated;books++;newCover||=outcome.newCover;}
    }
  }
  run.state='applied';run.updatedAt=nowIso(now);
  run.applied={updated,books,conflicts,newCover};
  return {ok:true,...run.applied};
}
module.exports={startRun,pauseRun,resumeRun,chooseTask,finishTask,deferClaim,runStatus,applyRun,LEASE_MS};
