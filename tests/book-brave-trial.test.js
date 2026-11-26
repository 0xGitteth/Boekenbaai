'use strict';
const assert=require('node:assert/strict');
const {addJob,getJobPlan,approveJob,claimNext,finishClaim,getBraveCheck}=require('../book-brave-core');
const {selectTrialBooks,storeTrialResult,projectTrial,preview,applyPreview}=require('../book-brave-trial');
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
assert.equal(applyPreview(db,job,book,preview(db,job,book).revision).error,'running');
// The manual short description still counts as missing in current Brave
// planning. Remaining requests are bounded by the approved maximum.
let next;
while((next=claimNext(db,{now,env})))finishClaim(db,next,{status:'no_result'});
assert.equal(job.state,'complete');
const first=preview(db,job,book);
assert.ok(first.changes.some(c=>c.field==='description'));
assert.equal(applyPreview(db,job,book,'invalid').ok,false);
assert.equal(applyPreview(db,job,book,first.revision).ok,true);
assert.equal(book.description,page.description);
assert.equal(other.description,'Docenttekst');
const second=preview(db,job,other);
assert.ok(!second.changes.some(c=>c.field==='description'));
assert.equal(applyPreview(db,job,other,second.revision).ok,true);
assert.equal(other.coverUrl,page.coverUrl);
assert.equal(db.books[2].coverUrl,'');
assert.deepEqual(db.students,[{id:'p'}]);
assert.deepEqual(db.history,[{id:'loan'}]);
assert.ok(job.trialReviewedAt);
assert.equal(preview(db,job,book).changes.length,0);
async function run(){
  const fresh={id:'worker',metadataIsbn:isbn,title:book.title,author:book.author,tags:[],description:'',coverUrl:''};
  const live={books:[fresh]};
  const pilot=addJob(live,['worker'],{source:'trial'});
  const current=new Date();
  const month=current.toISOString().slice(0,7);
  assert.equal(approveJob(live,pilot.id,{confirmed:true,expectedRequests:3,expectedMonth:month,braveConfigured:true,now:current,env}).ok,true);
  let calls=0;
  const worker=createBraveWorker({apiKey:'mock',loadDb:()=>live,commit:async fn=>fn(live),delayMs:50,
    fetchSearch:async()=>{calls++;return {pages:[]};},findPages:async()=>[page]});
  worker.schedule(50);
  await new Promise(resolve=>setTimeout(resolve,350));
  worker.stop();
  assert.equal(calls,1,'A complete virtual result avoids further paid requests');
  assert.equal(pilot.state,'complete');
  assert.equal(fresh.coverUrl,'');
  assert.equal(fresh.description,'');
  assert.ok(preview(live,pilot,fresh).changes.length);
  console.log('Brave trial selection, approved request limits, dry-run projection and separate review passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
