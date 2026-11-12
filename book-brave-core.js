'use strict';

// Durable, zero-automatic-spend Brave search planning.
// Monthly cap is deliberately lower than $5/1000-request free credit.
// This only measures THIS application's requests; the Brave account must
// independently disallow paid usage / auto recharge.
const crypto = require('node:crypto');
const {workKey, isbnOf, isMissing, nextCandidate} = require('./book-free-metadata');

const MAX_REQUESTS_PER_WORK = 3;
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
  const providerRemaining = Number.isSafeInteger(usage.providerRemaining)
    && usage.providerRemaining >= 0 ? usage.providerRemaining : null;
  return {month, cap, reserved, available:Math.max(0,Math.min(cap - reserved,
    providerRemaining === null ? Infinity : providerRemaining)),providerRemaining};
}
function bookWorks(db, job) {
  const ids = new Set(Array.isArray(job?.bookIds) ? job.bookIds : []);
  const grouped = new Map();
  for (const book of db.books || []) {
    if (!ids.has(book.id) || !String(book.title || '').trim() || !String(book.author || '').trim()) continue;
    const key = workKey(book);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(book);
  }
  return grouped;
}
function needsExtra(book,failedCovers=new Set()) {
  const description = String(book?.description || '').replace(/<[^>]*>/g,'').trim();
  const tagCount = Array.isArray(book?.tags) ? book.tags.filter(Boolean).length : 0;
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
  if (!easyCbEnabled) return 0;
  return [...bookWorks(db,job).values()].filter(books => books.some(book => freePending(book,now))).length;
}
function addJob(db, bookIds, {id = crypto.randomUUID(), source = 'import', fileName = ''} = {}) {
  ensureJobs(db);
  const known = new Set((db.books || []).map(book => book.id));
  const ids = [...new Set((Array.isArray(bookIds) ? bookIds : []).filter(id =>
    typeof id === 'string' && known.has(id)))];
  if (!ids.length) return null;
  if (db.braveEnrichmentJobs.some(job => job.id === id)) return null;
  const now = new Date().toISOString();
  const job = {id,createdAt:now,updatedAt:now,source,
    fileName:String(fileName).slice(0,180),bookIds:ids,
    state:'awaiting_free',approvedKeys:[],completedKeys:[],cursor:0,step:0,
    approval:null,requestsReserved:0,lastError:null};
  db.braveEnrichmentJobs.push(job);
  // Do not discard unapproved jobs or work merely because they are old.
  // Completed records alone may be compacted to bound database size.
  const completed = db.braveEnrichmentJobs.filter(item=>item.state==='complete');
  if (db.braveEnrichmentJobs.length > MAX_JOBS && completed.length) {
    const removable = new Set(completed.slice(0,db.braveEnrichmentJobs.length - MAX_JOBS).map(j=>j.id));
    db.braveEnrichmentJobs = db.braveEnrichmentJobs.filter(j=>!removable.has(j.id));
  }
  return job;
}
function remainingWorks(db,job,failedCovers=new Set()) {
  const completed = new Set(Array.isArray(job.completedKeys)?job.completedKeys:[]);
  const active = new Set(job.state==='running' ? job.approvedKeys || []:[]);
  return [...bookWorks(db,job)].filter(([key,books])=>
    !completed.has(key)&&!active.has(key)&&needsExtraWork(books,failedCovers)).map(([key])=>key);
}
function getJobPlan(db,job,{
  easyCbEnabled=false, braveConfigured=false, now = new Date(), env = process.env,
  failedCovers=new Set(),
}={}) {
  const groups=bookWorks(db,job);
  const remaining=remainingWorks(db,job,failedCovers);
  const waitingFree=pendingFreeWorks(db,job,easyCbEnabled,now.getTime());
  const usage=currentUsage(db,now,env);
  const safeBudget=Math.min(usage.available, Math.max(0,Math.floor(usage.available / MAX_REQUESTS_PER_WORK)
    * MAX_REQUESTS_PER_WORK));
  const possible=Math.min(remaining.length,Math.floor(safeBudget / MAX_REQUESTS_PER_WORK));
  let state=job.state;
  if (state==='awaiting_free' || state==='awaiting_approval') {
    state=waitingFree>0?'awaiting_free':remaining.length?'awaiting_approval':'complete';
  }
  // When the worker encountered a provider limit, its next step must still
  // require explicit approval. There is never an automatic new-month retry.
  const resumable=state==='paused' && waitingFree===0
    && remaining.length>0 && !['unauthorized','payment_required'].includes(job.lastError);
  return {
    id:job.id,source:job.source,fileName:job.fileName,createdAt:job.createdAt,
    state,books:job.bookIds?.length||0,uniqueWorks:groups.size,
    completedWorks:job.completedKeys?.length||0,waitingFree,
    needsBrave:remaining.length,estimatedMaxRequests:remaining.length*MAX_REQUESTS_PER_WORK,
    canApprove:braveConfigured && (state==='awaiting_approval'||resumable) && possible>0,
    possibleWorks:possible,possibleMaxRequests:possible*MAX_REQUESTS_PER_WORK,
    deferredWorks:Math.max(0,remaining.length-possible),
    approvedWorks:job.approvedKeys?.length||0,processedApproved:job.cursor||0,
    approvedMaxRequests:job.approval?.maxRequests||0,
    approvedMonth:job.approval?.month||null,
    reservedRequests:job.requestsReserved||0,
    lastError:job.lastError||null,
    withoutCover:[...groups.values()].filter(books=>books.every(b=>needsExtra(b,failedCovers).cover)).length,
    limitedDescriptions:[...groups.values()].filter(books=>books.some(b=>needsExtra(b,failedCovers).description)).length,
    incompleteIdentity:(job.bookIds||[]).filter(id=>{
      const b=(db.books||[]).find(x=>x.id===id);
      return b&&(!String(b.title||'').trim()||!String(b.author||'').trim());
    }).length,
  };
}
function approveJob(db,id,{confirmed=false,expectedRequests,expectedMonth,easyCbEnabled=false,
  braveConfigured=false,now=new Date(),env=process.env,failedCovers=new Set()}={}) {
  ensureJobs(db);
  if (!confirmed) return {ok:false,error:'confirmation_required'};
  if (!braveConfigured) return {ok:false,error:'api_key_missing'};
  if (db.braveEnrichmentJobs.some(job => job.state==='running')) return {ok:false,error:'another_job_running'};
  const job=db.braveEnrichmentJobs.find(j=>j.id===id);
  if (!job) return {ok:false,error:'job_missing'};
  const plan=getJobPlan(db,job,{easyCbEnabled,braveConfigured,now,env,failedCovers});
  if (!plan.canApprove || !plan.possibleWorks)
    return {ok:false,error:'not_ready'};
  if (expectedMonth!==monthKey(now) || !Number.isSafeInteger(expectedRequests)
    || expectedRequests!==plan.possibleMaxRequests)
    return {ok:false,error:'stale_budget'};
  const keys=remainingWorks(db,job,failedCovers).slice(0,plan.possibleWorks);
  job.state='running';job.approvedKeys=keys;job.cursor=0;job.step=0;
  job.approval={month:monthKey(now),maxRequests:keys.length*MAX_REQUESTS_PER_WORK,
    approvedAt:now.toISOString()};
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
  for (const key of job.approvedKeys||[]) done.add(key);
  job.completedKeys=[...done];
  job.approvedKeys=[];job.cursor=0;job.step=0;job.approval=null;
  job.state=remainingWorks(db,job,failedCovers).length?'awaiting_approval':'complete';
  job.updatedAt=new Date().toISOString();
}
function claimNext(db,{now=new Date(),env=process.env,failedCovers=new Set()}={}) {
  ensureJobs(db);
  const job=db.braveEnrichmentJobs.find(j=>j.state==='running');
  if (!job) return null;
  if (job.inFlight) {
    // Shared persistent volume may be served by more than one Node process.
    // Do not issue another request while another worker holds this claim.
    // A crashed claim is already debited and may be skipped after its lease.
    const claimedAt=Date.parse(job.inFlight.reservedAt||'');
    if (Number.isFinite(claimedAt) && now.getTime()-claimedAt < 120000) return null;
    job.inFlight=null;
  }
  if (job.approval?.month!==monthKey(now)) {
    job.state='paused';job.lastError='month_changed';return null;
  }
  const usage=usageForMonth(db,now),cap=monthlyCap(env);
  const groups=bookWorks(db,job);
  for (;;) {
    if (job.cursor >= job.approvedKeys.length) {
      finishApprovedChunk(db,job,failedCovers);return null;
    }
    const key=job.approvedKeys[job.cursor],books=groups.get(key)||[];
    if (job.step>=MAX_REQUESTS_PER_WORK || !books.length || !needsExtraWork(books,failedCovers)) {
      job.cursor++;job.step=0;continue;
    }
    if (!shouldQueryStep(job.step,books,failedCovers)) {job.step++;continue;}
    if (job.requestsReserved >= job.approval.maxRequests || usage.reserved >= cap
      || (Number.isSafeInteger(usage.providerRemaining)&&usage.providerRemaining<=0)) {
      job.state='paused';job.lastError='budget_exhausted';return null;
    }
    const step=job.step++;
    // Reserve BEFORE a network call. On a crash this reservation remains used;
    // a resumed worker skips that specific step instead of accidentally
    // issuing (and potentially billing) the same search twice.
    usage.reserved++;
    if(Number.isSafeInteger(usage.providerRemaining)&&usage.providerRemaining>0)
      usage.providerRemaining--;
    job.requestsReserved++;job.updatedAt=now.toISOString();
    const representative=books[0];
    job.inFlight={key,step,reservedAt:now.toISOString()};
    return {id:job.id,key,step,title:representative.title,author:representative.author,
      isbn:isbnOf(representative)};
  }
}
function finishClaim(db,claim,{providerRemaining=null,error=null}={}) {
  ensureJobs(db);
  const job=db.braveEnrichmentJobs.find(j=>j.id===claim?.id);
  if (!job) return;
  if (job.inFlight?.key===claim.key && job.inFlight?.step===claim.step) job.inFlight=null;
  if (Number.isSafeInteger(providerRemaining)&&providerRemaining>=0
      && db.braveUsage?.month===job.approval?.month) {
    // Provider monthly remaining is an additional emergency upper bound,
    // not a guarantee of remaining FREE monetary credit.
    db.braveUsage.providerRemaining=Math.min(
      Number.isSafeInteger(db.braveUsage.providerRemaining) ? db.braveUsage.providerRemaining : Infinity,
      providerRemaining);
  }
  if (error==='rate_limited'||error==='payment_required'||error==='unauthorized') {
    // Work already finished in the approved chunk stays finished even if a
    // later provider error pauses the rest. The partly searched work is
    // eligible for a new explicit approval, never an automatic debit.
    const done=new Set(job.completedKeys||[]);
    for (const key of (job.approvedKeys||[]).slice(0,job.cursor||0))done.add(key);
    job.completedKeys=[...done];
    job.approvedKeys=[];job.cursor=0;job.step=0;
    job.state='paused';job.lastError=error;job.approval=null;
  } else if (error) job.lastError=error;
  job.updatedAt=new Date().toISOString();
}
module.exports={MAX_REQUESTS_PER_WORK,HARD_MONTHLY_CAP,monthKey,monthlyCap,
  currentUsage,ensureJobs,bookWorks,needsExtra,needsExtraWork,pendingFreeWorks,
  addJob,remainingWorks,getJobPlan,approveJob,claimNext,finishClaim};
