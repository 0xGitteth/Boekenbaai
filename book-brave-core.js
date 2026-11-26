'use strict';

// Durable, zero-automatic-spend Brave search planning.
// Monthly cap is deliberately lower than $5/1000-request free credit.
// This only measures THIS application's requests; the Brave account must
// independently disallow paid usage / auto recharge.
const crypto = require('node:crypto');
const {workKey, isbnOf, isMissing, nextCandidate} = require('./book-free-metadata');
const {projectTrial,preview:trialPreview,releaseTrialCheckpoints}=require('./book-brave-trial');

const MAX_REQUESTS_PER_WORK = 3;
const MAX_TRIAL_REQUESTS = 15;
const TRANSIENT_API_ERRORS=new Set(['timeout','request_error','provider_temporary']);
const HARD_MONTHLY_CAP = 900;
const MAX_JOBS = 45;

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}
function monthlyCap(env = process.env) {
  const requested = Number(env.BOEKENBAAI_BRAVE_MONTHLY_CAP);
  return Number.isSafeInteger(requested) && requested >= 1
    ? Math.min(HARD_MONTHLY_CAP, requested) : HARD_MONTHLY_CAP;
}
function ensureJobs(db) {
  if (!Array.isArray(db.braveEnrichmentJobs)) db.braveEnrichmentJobs = [];
  if (!db.braveUsage || typeof db.braveUsage !== 'object') db.braveUsage = {};
}
function usageForMonth(db, now = new Date()) {
  ensureJobs(db);
  const month = monthKey(now);
  if (db.braveUsage.month !== month) {
    db.braveUsage = {month, reserved:0, providerRemaining:null};
  }
  db.braveUsage.reserved = Math.max(0, Number(db.braveUsage.reserved) || 0);
  return db.braveUsage;
}
function currentUsage(db, now = new Date(), env = process.env) {
  const month = monthKey(now);
  const usage = db.braveUsage?.month === month ? db.braveUsage : {reserved:0,providerRemaining:null};
  const cap = monthlyCap(env);
  const reserved = Math.max(0, Number(usage.reserved) || 0);
  // Older versions guessed a monthly value from the last response header.
  // Their stored zeros are not reliable evidence that the month is exhausted.
  // Only trust values explicitly parsed from a labelled monthly window.
  const providerRemaining = usage.providerRemainingVerified === true
    && Number.isSafeInteger(usage.providerRemaining)
    && usage.providerRemaining >= 0 ? usage.providerRemaining : null;
  const legacyProviderRemaining = usage.providerRemainingVerified !== true
    && Number.isSafeInteger(usage.providerRemaining)
    ? usage.providerRemaining : null;
  return {month, cap, reserved, available:Math.max(0,Math.min(cap - reserved,
    providerRemaining === null ? Infinity : providerRemaining)),
    providerRemaining, legacyProviderRemaining,
    canReconcileLegacyZero:providerRemaining===0&&!usage.providerEvidenceVersion&&!usage.legacyReconciliation&&reserved<cap,
    legacyReconciledAt:usage.legacyReconciliation?.at||null,
    providerEvidenceAt:usage.providerEvidenceAt||null};
}
// A legacy zero marked verified before the positive-quota parser fix
// cannot be independently checked. Only an administrator who has checked
// the current provider dashboard can discard it, once per UTC month.
function reconcileLegacyBudget(db,{confirmed=false,expectedMonth,expectedReserved,now=new Date(),env=process.env}={}){
  const usage=currentUsage(db,now,env);
  const stored=db.braveUsage;
  if(!confirmed)return {ok:false,error:'confirmation_required'};
  if(expectedMonth!==usage.month||expectedReserved!==usage.reserved)return {ok:false,error:'stale_budget'};
  if((db.braveEnrichmentJobs||[]).some(job=>job.state==='running'||job.inFlight))
    return {ok:false,error:'another_job_running'};
  if(!usage.canReconcileLegacyZero)return {ok:false,error:'not_eligible'};
  stored.legacyReconciliation={at:now.toISOString(),month:usage.month,previousRemaining:stored.providerRemaining,
    previousVerified:stored.providerRemainingVerified,reserved:usage.reserved,reason:'admin_verified_provider_dashboard'};
  stored.providerRemaining=null;stored.providerRemainingVerified=false;
  return {ok:true,usage:currentUsage(db,now,env)};
}
function bookWorks(db, job) {
  const ids = new Set(Array.isArray(job?.bookIds) ? job.bookIds : []);
  const grouped = new Map();
  for (const book of db.books || []) {
    if (book.personalLoanOnly===true || !ids.has(book.id) || !String(book.title || '').trim() || !String(book.author || '').trim()) continue;
    const key = workKey(book);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(book);
  }
  return grouped;
}
function needsExtra(book,failedCovers=new Set()) {
  const description = String(book?.description || '').replace(/<[^>]*>/g,'').trim();
  const tagCount = new Set([...(Array.isArray(book?.tags)?book.tags:[]),
    ...(Array.isArray(book?.enrichmentTags)?book.enrichmentTags:[])]
    .filter(tag=>typeof tag==='string'&&tag.trim())
    .map(tag=>tag.trim().toLocaleLowerCase('nl-NL'))).size;
  const cover = Boolean(book?.coverUrl || book?.localCoverUrl);
  const broken=Boolean(book?.coverUrl&&!book?.localCoverUrl&&failedCovers.has(book.coverUrl));
  return {cover:!cover||broken, description:description.length < 280, topics:tagCount < 3,
    any:!cover || broken || description.length < 280 || tagCount < 3};
}
function needsExtraWork(books,failedCovers=new Set()) {
  return books.some(book => needsExtra(book,failedCovers).any);
}
function freePending(book, now = Date.now()) {
  return Boolean(isbnOf(book) && nextCandidate([book], now));
}
function pendingFreeWorks(db, job, easyCbEnabled, now = Date.now()) {
  if (!easyCbEnabled||job.source==='trial') return 0;
  return [...bookWorks(db,job).values()].filter(books => books.some(book => freePending(book,now))).length;
}
// Durable per-copy, per-edition, per-source search checkpoints. A changed
// ISBN/title/author creates a new identity; old results cannot suppress it.
function checkKey(bookId,key) { return JSON.stringify([bookId,key]); }
function getBraveCheck(db,bookId,key,step) {
  return db.bookEnrichmentChecks?.[checkKey(bookId,key)]?.brave?.[step];
}
function recordBraveCheck(db,job,claim,{status,error=null,added=0,evidenceByBook=null,sourceFailures=[],now=new Date()}={}) {
  if(!db.bookEnrichmentChecks||typeof db.bookEnrichmentChecks!=='object'
    ||Array.isArray(db.bookEnrichmentChecks))db.bookEnrichmentChecks={};
  const ids=new Set(claim.bookIds||job.bookIds||[]);
  for(const book of db.books||[]){
    if(!ids.has(book.id)||workKey(book)!==claim.key)continue;
    const key=checkKey(book.id,claim.key);
    const entry=db.bookEnrichmentChecks[key]||={};
    const steps=entry.brave||={};
    const previous=steps[claim.step];
    const evidence=Array.isArray(evidenceByBook?.[book.id])?evidenceByBook[book.id]:[];
    const combined=new Map([...(Array.isArray(previous?.evidence)?previous.evidence:[]),...evidence]
      .map(item=>[JSON.stringify([item.field,item.url,item.confidence]),item]));
    steps[claim.step]={jobId:job.id,status,error,added,checkedAt:now.toISOString(),
      trialPending:job.source==='trial'&&status==='found',
      ...(job.source==='trial'?{trialBookId:book.id}:{}) ,
      sourceFailures:(Array.isArray(sourceFailures)?sourceFailures:[]).slice(0,12).map(f=>({code:'source_unavailable',url:String(f.url||'').slice(0,1600),stage:f.stage==='robots'?'robots':'page',reason:String(f.reason||'unknown').slice(0,80)})),
      evidence:[...combined.values()].slice(-60)};
  }
}
function checkedStep(db,job,key,books,step) {
  return books.length>0&&books.every(book=>{
    const check=getBraveCheck(db,book.id,key,step);
    return ['found','no_result','checked','source_partial'].includes(check?.status)
      &&(!check.trialPending||check.jobId===job.id)
      &&(!job.repeatChecked||check.jobId===job.id);
  });
}
function remainingSteps(db,job,key,books) {
  return Array.from({length:MAX_REQUESTS_PER_WORK},(_,step)=>step)
    .filter(step=>!checkedStep(db,job,key,books,step));
}
function claimIsCurrent(db,claim){
  const job=db.braveEnrichmentJobs?.find(j=>j.id===claim?.id);
  const flight=job?.inFlight;
  return Boolean(job?.state==='running'&&flight&&flight.key===claim.key
    &&flight.step===claim.step&&(!claim.reservationId||flight.reservationId===claim.reservationId));
}
function addJob(db, bookIds, {id = crypto.randomUUID(), source = 'import', fileName = '', repeatChecked=false} = {}) {
  ensureJobs(db);
  const known = new Set((db.books || []).map(book => book.id));
  const ids = [...new Set((Array.isArray(bookIds) ? bookIds : []).filter(id =>
    typeof id === 'string' && known.has(id)))];
  if (!ids.length) return null;
  if (db.braveEnrichmentJobs.some(job => job.id === id)) return null;
  const now = new Date().toISOString();
  const job = {id,createdAt:now,updatedAt:now,source,
    fileName:String(fileName).slice(0,180),bookIds:ids,repeatChecked:repeatChecked===true,
    state:'awaiting_free',approvedKeys:[],completedKeys:[],cursor:0,step:0,
    approval:null,requestsReserved:0,lastError:null};
  if(source==='trial')job.trialBudget={limit:Math.min(MAX_TRIAL_REQUESTS,bookWorks(db,job).size*MAX_REQUESTS_PER_WORK),used:0,legacy:false};
  db.braveEnrichmentJobs.push(job);
  // Do not discard unapproved jobs or work merely because they are old.
  // Completed records alone may be compacted to bound database size.
  const completed = db.braveEnrichmentJobs.filter(item=>item.state==='complete'&&(item.source!=='trial'||item.trialReviewedAt));
  if (db.braveEnrichmentJobs.length > MAX_JOBS && completed.length) {
    const removable = new Set(completed.slice(0,db.braveEnrichmentJobs.length - MAX_JOBS).map(j=>j.id));
    db.braveEnrichmentJobs = db.braveEnrichmentJobs.filter(j=>!removable.has(j.id));
  }
  return job;
}
function effectiveBooks(db,job,books,failedCovers){
  return job.source==='trial'?projectTrial(db,job,books,failedCovers).books:books;
}
function remainingWorks(db,job,failedCovers=new Set()) {
  const completed = new Set(Array.isArray(job.completedKeys)?job.completedKeys:[]);
  const active = new Set(job.state==='running' ? job.approvedKeys || []:[]);
  return [...bookWorks(db,job)].filter(([key,books])=>{
    const effective=effectiveBooks(db,job,books,failedCovers);
    return !completed.has(key)&&!active.has(key)&&needsExtraWork(effective,failedCovers)
      &&remainingSteps(db,job,key,books).some(step=>shouldQueryStep(step,effective,failedCovers));
  }).map(([key])=>key);
}
function getJobPlan(db,job,{
  easyCbEnabled=false, braveConfigured=false, now = new Date(), env = process.env,
  failedCovers=new Set(),legacyRemainingLimit=null,
}={}) {
  const groups=bookWorks(db,job);
  const remaining=remainingWorks(db,job,failedCovers);
  const waitingFree=pendingFreeWorks(db,job,easyCbEnabled,now.getTime());
  const usage=currentUsage(db,now,env);
  const costs=remaining.map(key=>remainingSteps(db,job,key,groups.get(key)).length);
  const estimatedMaxRequests=costs.reduce((total,cost)=>total+cost,0);
  const trial=job.source==='trial';
  const budget=job.trialBudget;
  // Earlier builds reset requestsReserved at every approval; it is not a
  // lifetime counter. Require an explicit remaining cap for those jobs.
  const legacyMax=trial&&!budget?Math.max(0,MAX_TRIAL_REQUESTS-Math.max(0,Number(job.requestsReserved)||0)):null;
  const trialRemaining=trial?(budget?Math.max(0,budget.limit-budget.used)
    :Number.isSafeInteger(legacyRemainingLimit)?Math.min(legacyMax,Math.max(0,legacyRemainingLimit)):legacyMax):null;
  const available=trial?Math.min(usage.available,trialRemaining):usage.available;
  let possible=0,possibleMaxRequests=0;
  for(const cost of costs){
    const left=available-possibleMaxRequests;
    if(left<=0||(!trial&&cost>left))break;
    possible++;possibleMaxRequests+=Math.min(cost,left);
  }
  let state=job.state;
  if (state==='awaiting_free' || state==='awaiting_approval') {
    state=waitingFree>0?'awaiting_free':remaining.length?'awaiting_approval':'complete';
  }
  if(state==='paused'&&!waitingFree&&!remaining.length)state='complete';
  // When the worker encountered a provider limit, its next step must still
  // require explicit approval. There is never an automatic new-month retry.
  const resumable=state==='paused' && waitingFree===0 && remaining.length>0;
  // Reapproval is explicit even after invalid credentials. Updating the
  // server's API key does not itself resume requests.
  return {
    id:job.id,source:job.source,fileName:job.fileName,createdAt:job.createdAt,
    state,books:job.bookIds?.length||0,uniqueWorks:groups.size,
    completedWorks:job.completedKeys?.length||0,waitingFree,
    needsBrave:remaining.length,estimatedMaxRequests,
    canApprove:braveConfigured && (state==='awaiting_approval'||resumable) && possible>0,
    possibleWorks:possible,possibleMaxRequests,
    deferredWorks:Math.max(0,remaining.length-possible),
    approvedWorks:job.approvedKeys?.length||0,processedApproved:job.cursor||0,
    approvedMaxRequests:job.approval?.maxRequests||0,
    approvedMonth:job.approval?.month||null,
    reservedRequests:job.requestsReserved||0,
    lastError:job.lastError||null,lastFailure:job.lastFailure||null,
    trialBudget:trial&&budget?{limit:budget.limit,used:budget.used,remaining:trialRemaining,legacy:budget.legacy===true}:null,
    legacyBudgetRequired:trial&&!budget,legacyMaxAdditional:legacyMax,
    deferredInApproval:job.deferredKeys?.length||0,
    withoutCover:[...groups.values()].filter(books=>books.every(b=>needsExtra(b,failedCovers).cover)).length,
    limitedDescriptions:[...groups.values()].filter(books=>books.some(b=>needsExtra(b,failedCovers).description)).length,
    incompleteIdentity:(job.bookIds||[]).filter(id=>{
      const b=(db.books||[]).find(x=>x.id===id);
      return b&&(!String(b.title||'').trim()||!String(b.author||'').trim());
    }).length,
  };
}
function approveJob(db,id,{confirmed=false,expectedRequests,expectedMonth,easyCbEnabled=false,
  braveConfigured=false,now=new Date(),env=process.env,failedCovers=new Set(),legacyRemainingLimit=null}={}) {
  ensureJobs(db);
  if (!confirmed) return {ok:false,error:'confirmation_required'};
  if (!braveConfigured) return {ok:false,error:'api_key_missing'};
  if (db.braveEnrichmentJobs.some(job => job.state==='running')) return {ok:false,error:'another_job_running'};
  const job=db.braveEnrichmentJobs.find(j=>j.id===id);
  if (!job) return {ok:false,error:'job_missing'};
  const trial=job.source==='trial';
  if(trial&&!job.trialBudget&&(!Number.isSafeInteger(legacyRemainingLimit)||legacyRemainingLimit<1
    ||legacyRemainingLimit>Math.max(0,MAX_TRIAL_REQUESTS-Math.max(0,Number(job.requestsReserved)||0))))
    return {ok:false,error:'trial_budget_required'};
  const plan=getJobPlan(db,job,{easyCbEnabled,braveConfigured,now,env,failedCovers,legacyRemainingLimit});
  if (!plan.canApprove || !plan.possibleWorks)
    return {ok:false,error:'not_ready'};
  if (expectedMonth!==monthKey(now) || !Number.isSafeInteger(expectedRequests)
    || (trial?(expectedRequests<1||expectedRequests>plan.possibleMaxRequests):expectedRequests!==plan.possibleMaxRequests))
    return {ok:false,error:'stale_budget'};
  if(trial&&!job.trialBudget)job.trialBudget={limit:legacyRemainingLimit,used:0,legacy:true};
  const groups=bookWorks(db,job),keys=[];
  let capacity=expectedRequests;
  for(const key of remainingWorks(db,job,failedCovers)){
    if(capacity<=0||keys.length>=plan.possibleWorks)break;
    keys.push(key);capacity-=remainingSteps(db,job,key,groups.get(key)).length;
  }
  job.state='running';job.approvedKeys=keys;job.cursor=0;job.step=0;
  job.approval={month:monthKey(now),maxRequests:expectedRequests,
    approvedAt:now.toISOString()};
  job.deferredKeys=[];job.consecutiveApiErrors=0;
  job.requestsReserved=0;job.lastError=null;job.updatedAt=now.toISOString();
  return {ok:true,approvedWorks:keys.length,maxRequests:job.approval.maxRequests};
}
function shouldQueryStep(step,books,failedCovers=new Set()) {
  if (step===0) return true; // web: find publisher / edition page
  if (step===1) return books.some(b=>needsExtra(b,failedCovers).cover); // image fallback
  if (step===2) return books.some(b=>needsExtra(b).description||needsExtra(b).topics);
  return false;
}
function finishApprovedChunk(db,job,failedCovers=new Set()) {
  const done=new Set(job.completedKeys||[]);
  const deferred=new Set(job.deferredKeys||[]);
  for (const key of job.approvedKeys||[])if(!deferred.has(key))done.add(key);
  job.completedKeys=[...done];
  job.approvedKeys=[];job.cursor=0;job.step=0;job.approval=null;
  job.state=remainingWorks(db,job,failedCovers).length?(deferred.size?'paused':'awaiting_approval'):'complete';
  if(job.source==='trial'&&job.state==='complete'&&!(db.books||[]).some(b=>trialPreview(db,job,b,failedCovers)?.changes.length)){
    job.trialReviewedAt=new Date().toISOString();releaseTrialCheckpoints(db,job);
  }
  job.updatedAt=new Date().toISOString();
}
function pauseActiveChunk(job,reason) {
  // Keep fully processed works; partially processed works may be reconsidered
  // only after a new explicit approval. Every previously claimed request
  // remains debited in the durable monthly ledger.
  const done=new Set(job.completedKeys||[]);
  const deferred=new Set(job.deferredKeys||[]);
  for(const key of (job.approvedKeys||[]).slice(0,job.cursor||0))if(!deferred.has(key))done.add(key);
  job.completedKeys=[...done];
  job.approvedKeys=[];job.cursor=0;job.step=0;job.approval=null;job.inFlight=null;
  job.state='paused';job.lastError=reason;job.updatedAt=new Date().toISOString();
}
function claimNext(db,{now=new Date(),env=process.env,failedCovers=new Set()}={}) {
  ensureJobs(db);
  const job=db.braveEnrichmentJobs.find(j=>j.state==='running');
  if (!job) return null;
  if (job.inFlight) {
    // Shared persistent volume may be served by more than one Node process.
    // Do not issue another request while another worker holds this claim.
    // An expired claim is not a successful search. Pause and require fresh
    // consent rather than silently skipping it or billing an automatic retry.
    const claimedAt=Date.parse(job.inFlight.reservedAt||'');
    if (Number.isFinite(claimedAt) && now.getTime()-claimedAt < 120000) return null;
    recordBraveCheck(db,job,job.inFlight,{status:'error',error:'interrupted',now});
    pauseActiveChunk(job,'interrupted');return null;
  }
  if (job.approval?.month!==monthKey(now)) {
    pauseActiveChunk(job,'month_changed');return null;
  }
  if(job.source==='trial'&&!job.trialBudget){
    pauseActiveChunk(job,'trial_budget_required');return null;
  }
  const usage=usageForMonth(db,now),cap=monthlyCap(env);
  const groups=bookWorks(db,job);
  for (;;) {
    if (job.cursor >= job.approvedKeys.length) {
      finishApprovedChunk(db,job,failedCovers);return null;
    }
    const key=job.approvedKeys[job.cursor],books=groups.get(key)||[];
    const effective=effectiveBooks(db,job,books,failedCovers);
    if (job.step>=MAX_REQUESTS_PER_WORK || !books.length || !needsExtraWork(effective,failedCovers)) {
      job.cursor++;job.step=0;continue;
    }
    if (checkedStep(db,job,key,books,job.step)||!shouldQueryStep(job.step,effective,failedCovers)) {job.step++;continue;}
    if (job.requestsReserved >= job.approval.maxRequests || usage.reserved >= cap
      || (job.source==='trial'&&job.trialBudget.used>=job.trialBudget.limit)
      || (usage.providerRemainingVerified === true
        && Number.isSafeInteger(usage.providerRemaining)&&usage.providerRemaining<=0)) {
      pauseActiveChunk(job,'budget_exhausted');return null;
    }
    const step=job.step++;
    // Reserve BEFORE a network call. On a crash this reservation remains used;
    // an expired claim requires a new explicit approval before it is retried.
    usage.reserved++;
    if(usage.providerRemainingVerified===true
      && Number.isSafeInteger(usage.providerRemaining)&&usage.providerRemaining>0)
      usage.providerRemaining--;
    job.requestsReserved++;
    if(job.source==='trial')job.trialBudget.used++;
    job.updatedAt=now.toISOString();
    const representative=books[0];
    const reservationId=crypto.randomUUID();
    job.inFlight={key,step,reservationId,bookIds:books.map(book=>book.id),reservedAt:now.toISOString()};
    // Consent applies to the exact imported book IDs, not later books that
    // happen to share the same ISBN, title and author.
    return {id:job.id,key,step,reservationId,source:job.source,bookIds:books.map(book=>book.id),
      title:representative.title,author:representative.author,
      isbn:isbnOf(representative),publisher:representative.imprint||representative.publisher||''};
  }
}
function finishClaim(db,claim,{
  providerRemaining=null, providerRemainingConfirmed=false, error=null, status='checked', added=0,evidenceByBook=null,sourceFailures=[],
}={}) {
  ensureJobs(db);
  const job=db.braveEnrichmentJobs.find(j=>j.id===claim?.id);
  if (!job||!claimIsCurrent(db,claim)) return;
  recordBraveCheck(db,job,claim,{status:error?'error':status,error,added,evidenceByBook,sourceFailures});
  job.inFlight=null;
  if (providerRemainingConfirmed===true
      && Number.isSafeInteger(providerRemaining) && providerRemaining>=0
      && db.braveUsage?.month===job.approval?.month) {
    // Never carry forward an unverified value from an older deployment.
    // Once verified, only lower the trusted monthly balance.
    db.braveUsage.providerRemaining=Math.min(
      db.braveUsage.providerRemainingVerified===true
        && Number.isSafeInteger(db.braveUsage.providerRemaining)
        ? db.braveUsage.providerRemaining : Infinity,
      providerRemaining);
    db.braveUsage.providerRemainingVerified=true;
    db.braveUsage.providerEvidenceVersion=2;
    db.braveUsage.providerEvidenceAt=new Date().toISOString();
  }
  if(error||sourceFailures.length){
    job.lastFailure={at:new Date().toISOString(),title:String(claim.title||'').slice(0,250),
      step:claim.step,stage:error?'brave':sourceFailures[0]?.stage||'page',
      code:error||'source_unavailable'};
  }
  if (error) {
    job.lastError=error;
    job.consecutiveApiErrors=(job.consecutiveApiErrors||0)+1;
    // An isolated transient failure defers this title, not the whole job.
    // Two consecutive API failures stop the batch to protect the credits.
    // Never retry an unsuccessful search automatically or mark it complete.
    if(TRANSIENT_API_ERRORS.has(error)&&job.consecutiveApiErrors<2
      &&job.cursor+1<job.approvedKeys.length){
      job.deferredKeys=[...new Set([...(job.deferredKeys||[]),claim.key])];
      job.cursor++;job.step=0;
    }else pauseActiveChunk(job,error);
  }else job.consecutiveApiErrors=0;
  job.updatedAt=new Date().toISOString();
}
module.exports={MAX_REQUESTS_PER_WORK,HARD_MONTHLY_CAP,monthKey,monthlyCap,
  currentUsage,reconcileLegacyBudget,ensureJobs,bookWorks,needsExtra,needsExtraWork,pendingFreeWorks,
  addJob,remainingWorks,getJobPlan,approveJob,claimNext,finishClaim,claimIsCurrent,getBraveCheck};
