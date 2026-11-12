'use strict';

const assert=require('node:assert/strict');
const {
  addJob,getJobPlan,approveJob,claimNext,finishClaim,currentUsage,
  MAX_REQUESTS_PER_WORK,
}=require('../book-brave-core');
const {
  parseBookPage,parseMonthlyRemaining,matchTitleAuthor,queryFor,
  robotsAllowed,discoverPages,selectImageResult,
}=require('../book-brave-fetch');
const {createBraveWorker,updateFromPages}=require('../book-brave-worker');

function book(id,title='De brief voor de koning'){
  return {id,title,author:'Tonke Dragt',metadataIsbn:'9789083316642',
    description:'',coverUrl:'',localCoverUrl:'',tags:[],pageCount:150};
}
const now=new Date('2026-11-12T09:00:00Z');
const environment={BOEKENBAAI_BRAVE_MONTHLY_CAP:'6'};
const db={books:[book('a'),book('copy-a'),book('b','De geheime opdracht'),
  book('c','Verhalen uit het bos')],students:[{id:'pupil'}],history:[]};
const job=addJob(db,db.books.map(b=>b.id),{id:'batch-1',fileName:'lijst.xlsx'});
assert.equal(job.bookIds.length,4);
assert.equal(addJob(db,db.books.map(b=>b.id),{id:'batch-1'}),null,
  'Applying an import twice must not duplicate a paid search job');
assert.equal(getJobPlan(db,job,{easyCbEnabled:true,braveConfigured:true,now,env:environment}).state,'awaiting_free');
let p=getJobPlan(db,job,{easyCbEnabled:false,braveConfigured:true,now,env:environment});
assert.equal(p.uniqueWorks,3,'Multiple copies share one lookup');
assert.equal(p.needsBrave,3);
assert.equal(p.estimatedMaxRequests,9);
assert.equal(p.possibleWorks,2,'Only a full-book reservation fits into a six-query cap');
assert.equal(p.possibleMaxRequests,6);
assert.equal(approveJob(db,job.id,{confirmed:false,expectedRequests:6,expectedMonth:'2026-11',
  braveConfigured:true,now,env:environment}).error,'confirmation_required');
assert.equal(approveJob(db,job.id,{confirmed:true,expectedRequests:5,expectedMonth:'2026-11',
  braveConfigured:true,now,env:environment}).error,'stale_budget');
assert.equal(approveJob(db,job.id,{confirmed:true,expectedRequests:6,expectedMonth:'2026-11',
  braveConfigured:true,now,env:environment}).ok,true);
assert.equal(db.braveUsage.reserved || 0,0,'Permission alone must not debit the paid API');
assert.equal(getJobPlan(db,job,{braveConfigured:true,now,env:environment}).state,'running');
assert.equal(approveJob(db,job.id,{confirmed:true,expectedRequests:6,expectedMonth:'2026-11',
  braveConfigured:true,now,env:environment}).error,'another_job_running');
let claimed=0;
for(let k=0;k<9;k++){
  const claim=claimNext(db,{now,env:environment});
  if(!claim)break;
  claimed++;
  assert.equal(db.braveUsage.reserved,claimed,'Reserve on disk before issuing a request');
  finishClaim(db,claim,{providerRemaining:40});
  const restored=JSON.parse(JSON.stringify(db));
  assert.equal(restored.braveUsage.reserved,claimed,'Quota survives process restart');
}
assert.equal(claimed,6,'Do not exceed approved max or monthly cap');
assert.equal(currentUsage(db,now,environment).available,0);
assert.equal(job.state,'awaiting_approval');
assert.equal(job.completedKeys.length,2);
p=getJobPlan(db,job,{braveConfigured:true,now,env:environment});
assert.equal(p.needsBrave,1);
assert.equal(p.possibleWorks,0);
const december=new Date('2026-12-01T10:00:00Z');
p=getJobPlan(db,job,{braveConfigured:true,now:december,env:environment});
assert.equal(p.possibleWorks,1);
assert.equal(approveJob(db,job.id,{confirmed:true,expectedRequests:3,expectedMonth:'2026-12',
  braveConfigured:true,now:december,env:environment}).ok,true);
assert.equal(db.braveUsage.reserved,6,"Consent alone does not touch the old month's ledger");
assert.equal(claimNext(db,{now:december,env:environment}).step,0);
assert.equal(db.braveUsage.month,'2026-12');
assert.equal(db.braveUsage.reserved,1);
assert.equal(MAX_REQUESTS_PER_WORK,3);
finishClaim(db,{id:job.id,key:job.inFlight.key,step:job.inFlight.step});
assert.equal(claimNext(db,{now:new Date('2027-01-01T09:00:00Z'),env:environment}),null);
assert.equal(job.state,'paused','Changing free-credit month requires another approval');
assert.equal(job.completedKeys.length,2,'Earlier works remain marked completed on a month change');

const html=`<html><head>
<meta property="og:title" content="De brief voor de koning | Uitgeverij"/>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Book","name":"De brief voor de koning",
"author":{"@type":"Person","name":"Tonke Dragt"},"isbn":"9789083316642",
"description":"Dit is een uitgebreide en inhoudelijke beschrijving van het boek. Een jonge held maakt een gevaarlijke reis en leert wie hij kan vertrouwen, ondanks alle uitdagingen die hij onderweg tegenkomt.",
"keywords":"avontuur, geheimen, vriendschap",
"image":"https://www.uitgeverijvoorbeeld.nl/images/debrief-voorkant.jpg"}
</script></head><body><h1>De brief voor de koning</h1></body></html>`;
const target={title:'De brief voor de koning',author:'Tonke Dragt',isbn:'9789083316642'};
const found=parseBookPage(html,target,'https://www.uitgeverijvoorbeeld.nl/boeken/de-brief');
assert.equal(found.confidence,'isbn');
assert.match(found.description,/gevaarlijke reis/);
assert.deepEqual(found.tags,['avontuur','geheimen','vriendschap']);
assert.equal(found.coverUrl,'https://www.uitgeverijvoorbeeld.nl/images/debrief-voorkant.jpg');
const sourceWithoutImage=html.replace(
  /,\s*"image":"https:\/\/www\.uitgeverijvoorbeeld\.nl\/images\/debrief-voorkant\.jpg"/, '');
assert.equal(parseBookPage(sourceWithoutImage,target,
  'https://www.uitgeverijvoorbeeld.nl/boeken/de-brief')?.coverUrl,'',
  'A book page without image metadata must not become its own cover');
const manual={...book('manual'),description:'Eigen omschrijving door docent',
  tags:['Zelf ingevoerd'],coverUrl:'https://example.org/eigen-omslag.jpg',
  importProvenance:{fieldSources:{
    description:{sourceType:'manual'},tags:{sourceType:'manual'},
    coverUrl:{sourceType:'manual'}}}};
const oldWithoutProvenance={...book('old'),description:'Eerder handmatig aangepast'};
const mergeDb={books:[manual,oldWithoutProvenance]};
updateFromPages(mergeDb,{key:JSON.stringify([target.isbn,
  target.title.toLowerCase(),target.author.toLowerCase()])},[
  {...found,description:found.description.repeat(4)},
],{imageUrl:found.coverUrl,failedCovers:new Set([manual.coverUrl])});
assert.equal(manual.description,'Eigen omschrijving door docent',
  'Background enrichment may not replace teacher text');
assert.deepEqual(manual.tags,['Zelf ingevoerd']);
assert.equal(manual.coverUrl,'https://example.org/eigen-omslag.jpg',
  'Teacher cover choices are protected even after a download problem');
assert.equal(oldWithoutProvenance.description,'Eerder handmatig aangepast',
  'Legacy descriptions with missing provenance are protected');

assert.equal(parseBookPage(html,{...target,title:'Verkeerd boek',isbn:'9789025869977'},
  'https://www.uitgeverijvoorbeeld.nl/boeken/de-brief'),null);
assert.equal(parseBookPage(html,target,'http://localhost/book'),null);
assert.equal(matchTitleAuthor(target,{title:'De brief voor de koning',author:'Tonke Dragt'}),true);
assert.equal(matchTitleAuthor(target,{title:'De brief voor de koning',author:'Anders'}),false);
assert.match(queryFor(1,target),/kaft/);
assert.equal(parseMonthlyRemaining({headers:{get(k){
  return k==='x-ratelimit-policy'?'2;w=1, 1200;w=2592000':'1, 734';
}}}),734);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /boeken\nAllow: /open','/boeken/tekst'),false);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /boeken','/over'),true);
assert.equal(selectImageResult([{title:'De brief voor de koning Tonke Dragt',
  imageUrl:'https://files.uitgeverijvoorbeeld.nl/debrief.jpg',width:300,height:430}],target),
  'https://files.uitgeverijvoorbeeld.nl/debrief.jpg');
assert.equal(selectImageResult([{title:'Onbekend boek',
  imageUrl:'https://files.uitgeverijvoorbeeld.nl/unknown.jpg',width:300,height:430}],target),'');

async function run(){
  let pageCalls=0;
  const pages=await discoverPages({pages:[
    {title:'De brief voor de koning',url:'https://www.uitgeverijvoorbeeld.nl/boek'},
    {title:'Gelijknamige titel',url:'https://www.verkeerde.nl/boek'},
  ]},target,{fetchPage:async url=>{
    pageCalls++;
    if(url.endsWith('robots.txt'))return {body:'User-agent: *\nAllow: /'};
    return {body:html};
  }});
  assert.equal(pages.length,1,'Only a verified original book page can be used');
  assert.equal(pageCalls,2,'Robots and page fetched, irrelevant site skipped');
  const blocked=await discoverPages({pages:[
    {title:'De brief voor de koning',url:'https://www.uitgeverijvoorbeeld.nl/boek'},
  ]},target,{fetchPage:async url=>url.endsWith('/robots.txt')
    ?{error:'request_error'}:{body:html}});
  assert.equal(blocked.length,0,
    'If robots.txt is unreachable, page crawling is not authorized');
  const db2={books:[book('x')],braveEnrichmentJobs:[],braveUsage:null};
  const j=addJob(db2,['x'],{id:'import1'});
  assert.equal(approveJob(db2,j.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  let calls=0,cover=0;
  const worker=createBraveWorker({
    apiKey:'test-only-key',loadDb:()=>db2,
    commit:async fn=>fn(db2),onNewCover:()=>cover++,delayMs:50,
    fetchSearch:async (step)=>{
      calls++;
      assert.equal(step,0);
      return {pages:[{title:target.title,url:'https://www.uitgeverijvoorbeeld.nl/boek'}],
        providerRemaining:990};
    },
    findPages:async ()=>[{...found,description:found.description.repeat(3)}],
  });
  worker.schedule();
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal(db2.braveEnrichmentJobs[0].state,'complete');
  assert.equal(calls,1,'Remaining external requests skipped when sources filled gaps');
  assert.equal(db2.braveUsage.reserved,1);
  assert.equal(db2.books[0].coverUrl,found.coverUrl);
  assert.deepEqual(db2.books[0].tags,found.tags);
  assert.match(db2.books[0].description,/gevaarlijke reis/);
  assert.equal(cover,1);
  assert.deepEqual(db2.students,undefined,'Worker does not modify students');
  worker.stop();

  // Another edition's cover can be recovered from a verified source page
  // even when the image-search result title itself lacks the author's name.
  const db3={books:[{...book('y'),description:'Lange beschrijving. '.repeat(24),
    tags:['Avontuur','Geheimen','Vriendschap']}],braveEnrichmentJobs:[]};
  const coverJob=addJob(db3,['y'],{id:'cover-job'});
  assert.equal(approveJob(db3,coverJob.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const steps=[];
  let sourcePageRequests=0;
  const coverWorker=createBraveWorker({
    apiKey:'test-only-key',loadDb:()=>db3,commit:async fn=>fn(db3),delayMs:50,
    fetchSearch:async step=>{
      steps.push(step);
      if(step===0)return {pages:[]};
      if(step===1)return {images:[{title:target.title,
        pageUrl:'https://www.uitgeverijvoorbeeld.nl/boek',imageUrl:'',width:0,height:0}]};
      throw Error('Third Brave request was not needed');
    },
    findPages:async result=>{
      if(!result.pages?.length)return [];
      sourcePageRequests++;
      return [found];
    },
  });
  coverWorker.schedule();
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.deepEqual(steps,[0,1]);
  assert.equal(sourcePageRequests,1);
  assert.equal(db3.books[0].coverUrl,found.coverUrl);
  assert.equal(db3.braveUsage.reserved,2);
  coverWorker.stop();

  // A failed provider request never continues silently. Another approval
  // is required and all past debits remain in the persistent ledger.
  const db4={books:[book('z')],braveEnrichmentJobs:[]};
  const paused=addJob(db4,['z'],{id:'paused'});
  assert.equal(approveJob(db4,paused.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const firstClaim=claimNext(db4,{now,env:environment});
  assert.equal(claimNext(db4,{now,env:environment}),null,
    'A persistent in-flight lease prevents parallel requests');
  finishClaim(db4,firstClaim,{error:'rate_limited'});
  assert.equal(paused.state,'paused');
  assert.equal(db4.braveUsage.reserved,1);
  assert.equal(getJobPlan(db4,paused,{braveConfigured:true,now,env:environment}).canApprove,true);
  assert.equal(approveJob(db4,paused.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  assert.equal(db4.braveUsage.reserved,1,'A second approval cannot erase spent requests');
  const db5={books:[book('credential')],braveEnrichmentJobs:[]};
  const denied=addJob(db5,['credential'],{id:'access-denied'});
  assert.equal(approveJob(db5,denied.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const attempted=claimNext(db5,{now,env:environment});
  finishClaim(db5,attempted,{error:'unauthorized'});
  assert.equal(denied.state,'paused');
  assert.equal(getJobPlan(db5,denied,{braveConfigured:true,now,env:environment}).canApprove,true,
    'The administrator can explicitly retry after fixing the API key');
  assert.equal(approveJob(db5,denied.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  assert.equal(db5.braveUsage.reserved,1,
    'Reapproval cannot erase the previously reserved API request');
  console.log('Brave deferred consent, persistent budget, verifiable scraping and worker passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
