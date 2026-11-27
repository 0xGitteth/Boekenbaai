'use strict';
const assert=require('node:assert/strict');
const {addJob,getJobPlan,approveJob,claimNext,finishClaim,getBraveCheck}=require('../book-brave-core');
const {selectTrialBooks,storeTrialResult,projectTrial,preview,applyPreview,pendingTrialReview,dismissTrial}=require('../book-brave-trial');
const {recordCheck}=require('../book-enrichment-trial');
const {workKey}=require('../book-free-metadata');
const {createBraveWorker}=require('../book-brave-worker');
const isbn='9789086960088',now=new Date('2026-11-26T10:00:00Z');
const book={id:'a',metadataIsbn:isbn,title:'Testtitel',author:'Test Auteur',tags:[],description:'',coverUrl:''};
const other={...book,id:'b',description:'Docenttekst',importProvenance:{fieldSources:{description:{sourceType:'manual'}}}};
const db={books:[book,other,{...book,id:'personal',personalLoanOnly:true}],students:[{id:'p'}],history:[{id:'loan'}]};
assert.equal(selectTrialBooks(db,['a'],{sources:['boekenbase']}).error,'free_research_pending');
recordCheck(db,book,{status:'not_found',metadata:null},{source:'boekenbase',now});
assert.deepEqual(selectTrialBooks(db,['a'],{sources:['boekenbase']}).bookIds,['a','b']);
assert.equal(selectTrialBooks(db,['personal']).ok,false);
assert.deepEqual(selectTrialBooks(db,['a','deleted'],{sources:['boekenbase'],expand:false}).bookIds,['a']);
const job=addJob(db,['a','b'],{source:'trial',id:'test-trial'});
const env={BOEKENBAAI_BRAVE_MONTHLY_CAP:'15'};
assert.equal(getJobPlan(db,job,{braveConfigured:true,easyCbEnabled:true,now,env}).possibleMaxRequests,3);
assert.equal(approveJob(db,job.id,{confirmed:false,expectedRequests:3,expectedMonth:'2026-11',braveConfigured:true,now,env}).ok,false);
assert.equal(approveJob(db,job.id,{confirmed:true,expectedRequests:3,expectedMonth:'2026-11',braveConfigured:true,now,env}).ok,true);
const claim=claimNext(db,{now,env});
assert.equal(claim.source,'trial');
const page={isbn,title:book.title,author:book.author,confidence:'isbn',
  description:'Een uitvoerige beschrijving van een verhaal over paarden, vriendschap en avontuur. '.repeat(5),
  tags:['Paarden','Vriendschap','Avontuur'],coverUrl:'https://example.org/cover.jpg',pageCount:128,
  sourceUrl:'https://example.org/book'};
storeTrialResult(job,claim,[page]);
const projected=projectTrial(db,job,[book,other]);
assert.equal(book.description,'');
assert.equal(book.coverUrl,'');
assert.equal(projected.books[0].coverUrl,page.coverUrl);
assert.equal(projected.books[1].description,'Docenttekst');
finishClaim(db,claim,{status:'found',added:1,evidenceByBook:projected.evidenceByBook});
assert.equal(getBraveCheck(db,'a',workKey(book),0).status,'found');
assert.equal(getBraveCheck(db,'a',workKey(book),0).trialPending,true);
assert.equal(pendingTrialReview(db),true);
assert.equal(applyPreview(db,job,book,preview(db,job,book).revision).error,'running');
// The manual short description still counts as missing in current Brave
// planning. Remaining requests are bounded by the approved maximum.
let next;
while((next=claimNext(db,{now,env})))finishClaim(db,next,{status:'no_result'});
assert.equal(job.state,'complete');
const reportView=require('../book-enrichment-report').details(db,'a');
assert.ok(reportView[0].braveProposals.some(c=>c.field==='description'),'Verified but unapplied Brave evidence appears separately in the report');
assert.ok(!reportView[0].changes.some(c=>c.field==='description'),'Brave evidence is not a free-source proposal');
const first=preview(db,job,book);
assert.ok(first.changes.some(c=>c.field==='description'));
assert.equal(applyPreview(db,job,book,'invalid').ok,false);
assert.equal(applyPreview(db,job,book,first.revision).ok,true);
assert.equal(book.description,page.description.trim());
assert.equal(other.description,'Docenttekst');
const second=preview(db,job,other);
assert.ok(!second.changes.some(c=>c.field==='description'));
assert.equal(applyPreview(db,job,other,second.revision).ok,true);
assert.equal(other.coverUrl,page.coverUrl);
assert.equal(db.books[2].coverUrl,'');
assert.deepEqual(db.students,[{id:'p'}]);
assert.deepEqual(db.history,[{id:'loan'}]);
assert.ok(job.trialReviewedAt);
assert.equal(getBraveCheck(db,'a',workKey(book),0).trialPending,false);
assert.equal(pendingTrialReview(db),false);
assert.equal(preview(db,job,book).changes.length,0);
// A legacy pilot has no reliable lifetime ledger. A verified remaining
// cap must be explicitly set once; subsequent approvals cannot reset it.
const legacyDb={books:[{...book,id:'old',description:'',coverUrl:'',tags:[],enrichmentTags:[]}]};
const legacy=addJob(legacyDb,['old'],{id:'legacy',source:'trial'});
delete legacy.trialBudget;legacy.requestsReserved=1;legacy.state='paused';
const approveLegacy=(count,limit)=>approveJob(legacyDb,legacy.id,{confirmed:true,expectedRequests:count,expectedMonth:'2026-11',braveConfigured:true,now,env,legacyRemainingLimit:limit});
assert.equal(approveLegacy(2).error,'trial_budget_required');
assert.equal(approveLegacy(2,2).ok,true);
const firstLegacy=claimNext(legacyDb,{now,env});
finishClaim(legacyDb,firstLegacy,{error:'timeout'});
assert.equal(legacy.trialBudget.used,1);
assert.equal(approveLegacy(2,15).ok,false,'Cannot exceed remaining lifetime cap');
assert.equal(approveLegacy(1,15).ok,true);
const secondLegacy=claimNext(legacyDb,{now,env});
finishClaim(legacyDb,secondLegacy,{error:'timeout'});
assert.equal(legacy.trialBudget.used,2);
assert.equal(getJobPlan(legacyDb,legacy,{now,env,braveConfigured:true}).canApprove,false);
assert.equal(approveLegacy(1,15).ok,false);
assert.equal(legacyDb.braveUsage.reserved,2);
assert.equal(JSON.parse(JSON.stringify(legacyDb)).braveEnrichmentJobs[0].trialBudget.used,2);
async function run(){
  const fresh={id:'worker',metadataIsbn:isbn,title:book.title,author:book.author,tags:[],description:'',coverUrl:''};
  const live={books:[fresh]};
  const pilot=addJob(live,['worker'],{source:'trial'});
  const current=new Date();
  const month=current.toISOString().slice(0,7);
  assert.equal(approveJob(live,pilot.id,{confirmed:true,expectedRequests:3,expectedMonth:month,braveConfigured:true,now:current,env}).ok,true);
  let calls=0;
  const fixtureHtml='<script type="application/ld+json">'+JSON.stringify({'@type':'Book',name:fresh.title,author:{name:fresh.author},isbn:page.isbn,description:page.description,keywords:page.tags,image:page.coverUrl,numberOfPages:page.pageCount})+'</script>';
  const worker=createBraveWorker({apiKey:'mock',loadDb:()=>live,commit:async fn=>fn(live),delayMs:50,
    fetchSearch:async()=>{calls++;return {pages:[{title:fresh.title,url:'https://offline.example/book'},{title:fresh.title,url:page.sourceUrl}]};},
    findPages:(result,claim,options)=>require('../book-brave-fetch').discoverPages(result,claim,{...options,fetchPage:async url=>url.endsWith('/robots.txt')?{body:'User-agent: *\\nAllow: /'}:url.includes('offline.example')?{error:'request_error',phase:'dns',errorCode:'ENOTFOUND'}:{body:fixtureHtml}})});
  worker.schedule(50);
  await new Promise(resolve=>setTimeout(resolve,350));
  worker.stop();
  assert.equal(calls,1,'A complete virtual result avoids further paid requests');
  assert.equal(pilot.state,'complete');
  assert.equal(fresh.coverUrl,'');
  assert.equal(fresh.description,'');
  assert.ok(preview(live,pilot,fresh).changes.length);
  assert.ok(preview(live,pilot,fresh).changes.some(change=>change.field==='description'));
  assert.equal(pilot.lastDiagnostic.verifiedPages,1);
  assert.equal(pilot.lastDiagnostic.apiOk,true);
  assert.equal(pilot.lastFailure.sourceFailures[0].phase,'dns');
  assert.equal(pendingTrialReview(live),true);
  assert.equal(dismissTrial(live,pilot).ok,true);
  assert.equal(getBraveCheck(live,'worker',workKey(fresh),0).trialPending,false);
  assert.equal(pendingTrialReview(live),false);
  assert.equal(fresh.coverUrl,'');
  console.log('Brave trial selection, approved request limits, dry-run projection and separate review passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
