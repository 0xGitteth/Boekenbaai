'use strict';

const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {
  addJob,getJobPlan,approveJob,claimNext,finishClaim,currentUsage,
  MAX_REQUESTS_PER_WORK,getBraveCheck,claimIsCurrent,
}=require('../book-brave-core');
const {
  parseBookPage,parseMonthlyRemaining,matchTitleAuthor,sameWorkTitle,queryFor,fetchBrave,
  robotsAllowed,discoverPages,selectImageResult,fetchHtml,rankPublisherCandidates,
}=require('../book-brave-fetch');
const {createBraveWorker,updateFromPages}=require('../book-brave-worker');
const {narrativeDescription}=require('../book-brave-description');
assert.equal(narrativeDescription('Bas Nijhuis. Niet zeiken, voetballen! (ISBN 9789048846757) direct en eenvoudig te bestellen bij Boekhandel De Slegte. Uniek aanbod tweedehands boeken.'),'');
const narrative='Lilly wil graag leren dansen. Samen met haar vriendinnen ontdekt ze hoe moeilijk het is om voor het eerst op een groot podium te staan.';
assert.equal(narrativeDescription(narrative+' Bestel nu online bij onze winkel.'),narrative);
const dotted='Daar ontmoeten zij J.K. Rowling en bezoeken zij voorbeeld.nl tijdens hun reis naar een onbekende stad waar zij samen een raadsel proberen op te lossen.';
assert.equal(narrativeDescription(dotted),dotted);


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

// A partial run persists across restarts and across collection jobs.
const resumeEnv={BOEKENBAAI_BRAVE_MONTHLY_CAP:'12'};
let resumeDb={books:[book('resume')]};
const resumeJob=addJob(resumeDb,['resume'],{id:'resume-first'});
const resumeApproval=(db,id,count)=>approveJob(db,id,{confirmed:true,expectedRequests:count,
  expectedMonth:'2026-11',braveConfigured:true,now,env:resumeEnv});
assert.equal(resumeApproval(resumeDb,resumeJob.id,3).ok,true);
const successful=claimNext(resumeDb,{now,env:resumeEnv});
finishClaim(resumeDb,successful,{status:'found',added:1});
assert.equal(getBraveCheck(resumeDb,'resume',successful.key,0).status,'found');
const failed=claimNext(resumeDb,{now,env:resumeEnv});
assert.equal(failed.step,1);
finishClaim(resumeDb,failed,{error:'timeout'});
resumeDb=JSON.parse(JSON.stringify(resumeDb));
const resumed=resumeDb.braveEnrichmentJobs[0];
assert.equal(getJobPlan(resumeDb,resumed,{braveConfigured:true,now,env:resumeEnv}).possibleMaxRequests,2);
assert.equal(resumeApproval(resumeDb,resumed.id,2).ok,true);
const retry=claimNext(resumeDb,{now,env:resumeEnv});
assert.equal(retry.step,1,'Successful first step is not repeated after a restart');
assert.equal(claimIsCurrent(resumeDb,failed),false,'Late response cannot change the new claim');
finishClaim(resumeDb,failed,{error:'timeout'});
assert.equal(claimIsCurrent(resumeDb,retry),true);
finishClaim(resumeDb,retry,{status:'no_result'});
const last=claimNext(resumeDb,{now,env:resumeEnv});
assert.equal(last.step,2);
finishClaim(resumeDb,last,{status:'no_result'});
assert.equal(claimNext(resumeDb,{now,env:resumeEnv}),null);
const nextRound=addJob(resumeDb,['resume'],{id:'next-round',source:'collection'});
assert.equal(getJobPlan(resumeDb,nextRound,{braveConfigured:true,now,env:resumeEnv}).needsBrave,0,
  'A new collection round skips already researched steps even if fields remain missing');
const forced=addJob(resumeDb,['resume'],{id:'force-round',source:'collection',repeatChecked:true});
assert.equal(getJobPlan(resumeDb,forced,{braveConfigured:true,now,env:resumeEnv}).possibleMaxRequests,3);
assert.equal(resumeApproval(resumeDb,forced.id,3).ok,true);
const interrupted=claimNext(resumeDb,{now,env:resumeEnv});
assert.equal(interrupted.step,0);
assert.equal(claimNext(resumeDb,{now:new Date(now.getTime()+121000),env:resumeEnv}),null);
assert.equal(forced.state,'paused');
assert.equal(forced.lastError,'interrupted');
assert.equal(getBraveCheck(resumeDb,'resume',interrupted.key,0).status,'error');
assert.equal(claimIsCurrent(resumeDb,interrupted),false);

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
const notApproved={...book('not-approved')};
const mergeDb={books:[manual,oldWithoutProvenance,notApproved]};
updateFromPages(mergeDb,{key:JSON.stringify([target.isbn,
  target.title.toLowerCase(),target.author.toLowerCase()]),
  bookIds:['manual','old']},[
  {...found,description:found.description.repeat(4)},
],{imageUrl:found.coverUrl,failedCovers:new Set([manual.coverUrl])});
assert.equal(manual.description,'Eigen omschrijving door docent',
  'Background enrichment may not replace teacher text');
assert.deepEqual(manual.tags,['Zelf ingevoerd']);
assert.deepEqual(manual.enrichmentTags,found.tags,
  'Verified source keywords supplement manual labels without overwriting them');
assert.equal(manual.coverUrl,'https://example.org/eigen-omslag.jpg',
  'Teacher cover choices are protected even after a download problem');
assert.equal(oldWithoutProvenance.description,'Eerder handmatig aangepast',
  'Legacy descriptions with missing provenance are protected');
assert.equal(notApproved.enrichmentTags,undefined);
const clearedThemes={...book('cleared-themes'),themesCleared:true};
updateFromPages({books:[clearedThemes]},{key:JSON.stringify([target.isbn,
  target.title.toLowerCase(),target.author.toLowerCase()]),bookIds:['cleared-themes']},[found]);
assert.equal(clearedThemes.enrichmentTags,undefined,
  'Explicitly cleared themes must not receive background source keywords');
assert.equal(notApproved.coverUrl,'',
  'A new unrelated copy of the same work must not be enriched without approval');

// Imported records often use "unknown" for missing metadata. Those fields
// are eligible, while a deliberately cleared teacher field remains protected.
const emptyUnknown={...book('empty-unknown'),publisher:'',pageCount:0,
  importProvenance:{fieldSources:Object.fromEntries(
    ['description','publisher','pageCount','coverUrl','tags']
      .map(field=>[field,{sourceType:'unknown'}]))}};
const manuallyCleared={...book('manually-cleared'),description:'',
  importProvenance:{fieldSources:{description:{sourceType:'manual'}}}};
const unknownDb={books:[emptyUnknown,manuallyCleared]};
updateFromPages(unknownDb,{key:JSON.stringify([target.isbn,
  target.title.toLowerCase(),target.author.toLowerCase()]),
  bookIds:['empty-unknown','manually-cleared']},[
  {...found,description:found.description.repeat(4),publisher:'Uitgeverij',
    pageCount:360},
]);
assert.match(emptyUnknown.description,/gevaarlijke reis/);
assert.equal(emptyUnknown.coverUrl,found.coverUrl);
assert.deepEqual(emptyUnknown.tags,found.tags);
assert.equal(emptyUnknown.publisher,'Uitgeverij');
assert.equal(emptyUnknown.pageCount,360);
assert.equal(emptyUnknown.importProvenance.fieldSources.description.sourceType,'metadata');
assert.equal(manuallyCleared.description,'',
  'A teacher-cleared field must stay empty despite web results');

assert.equal(parseBookPage(html,{...target,title:'Verkeerd boek',isbn:'9789025869977'},
  'https://www.uitgeverijvoorbeeld.nl/boeken/de-brief'),null);
assert.equal(parseBookPage(html,target,'http://localhost/book'),null);
assert.equal(matchTitleAuthor(target,{title:'De brief voor de koning',author:'Tonke Dragt'}),true);
assert.equal(matchTitleAuthor(target,{title:'De brief voor de koning',author:'Anders'}),false);

assert.equal(sameWorkTitle('It','It','Stephen King'),true,
  'Two-letter titles are valid when they match exactly');
assert.equal(matchTitleAuthor({title:'It',author:'Stephen King'},
  {title:'It Stephen King'}),true);
assert.equal(selectImageResult([{title:'It Stephen King',imageUrl:'https://example.org/it.jpg',
  width:300,height:450}],{title:'It',author:'Stephen King',isbn:'9780306406157'}),
  'https://example.org/it.jpg');
const shortPage=`<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Book","name":"It",
"author":{"name":"Stephen King"},"isbn":"9780306406157"}</script>`;
assert.equal(parseBookPage(shortPage,{title:'It',author:'Stephen King',
  isbn:'9780306406157'},'https://example.org/it')?.confidence,'isbn');
assert.equal(sameWorkTitle('Dune','Dune Messiah','Frank Herbert'),false,
  'A sequel is a different work despite sharing the first word');
assert.equal(matchTitleAuthor({title:'Dune',author:'Frank Herbert'},
  {title:'Dune Messiah',author:'Frank Herbert'}),false);
assert.equal(matchTitleAuthor(target,
  {title:'De brief voor de koning Tonke Dragt'}),true);
assert.equal(sameWorkTitle(target.title,'De brief voor de koning | Uitgeverij'),true);
const sequelHtml=`<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Book","name":"Dune Messiah",
"author":{"name":"Frank Herbert"},"isbn":"9789025869977",
"description":"Dune appears here but this is its sequel.",
"image":"https://publisher.example/dune-messiah.jpg"}
</script></head></html>`;
assert.equal(parseBookPage(sequelHtml,{
  title:'Dune',author:'Frank Herbert',isbn:'9789025869977'},
  'https://publisher.example/dune-messiah'),null,
  'A matching ISBN must not override an explicitly different work title');
assert.match(queryFor(1,target),/kaft/);
assert.match(queryFor(1,target),/9789083316642/);
assert.equal(queryFor(0,{...target,publisher:'Uitgeverij Voorbeeld'}),target.isbn);
assert.equal(queryFor(0,{...target,isbn:''}),target.title+' '+target.author+' boek');
assert.equal(queryFor(2,target),target.title+' '+target.author+' beschrijving');
const ranked=rankPublisherCandidates([{title:target.title,url:'https://winkel.example/boek'},
  {title:target.title,url:'https://www.voorbeeld.nl/boek'}],{...target,publisher:'Uitgeverij Voorbeeld'});
assert.equal(ranked[0].url,'https://www.voorbeeld.nl/boek');
const differentEdition=parseBookPage(html.replaceAll(target.isbn,'9780306406157'),target,
  'https://www.uitgeverijvoorbeeld.nl/andere-druk');
assert.equal(differentEdition.confidence,'title_author');
const editionBook={...book('edition-safety'),pageCount:null,publisher:'',coverCrop:{x:0.1}};
const editionDb={books:[editionBook]};
const editionClaim={key:JSON.stringify([target.isbn,target.title.toLowerCase(),target.author.toLowerCase()]),
  bookIds:[editionBook.id]};
updateFromPages(editionDb,editionClaim,[{...differentEdition,publisher:'Andere uitgever',pageCount:123}],
  {imageUrl:differentEdition.coverUrl});
assert.match(editionBook.description,/gevaarlijke reis/);
assert.equal(editionBook.pageCount,null);
assert.equal(editionBook.publisher,'');
assert.equal(editionBook.coverUrl,'');
const editionUpdate=updateFromPages(editionDb,editionClaim,[{...found,publisher:'Juiste uitgever',pageCount:456}]);
assert.equal(editionBook.pageCount,456);
assert.equal(editionBook.publisher,'Juiste uitgever');
assert.equal(editionBook.coverUrl,found.coverUrl);
assert.equal(editionBook.coverCrop,null);
assert.ok(editionUpdate.evidenceByBook[editionBook.id].some(e=>e.field==='coverUrl'&&e.url===found.sourceUrl));
assert.equal(clearedThemes.tags.length,0,'Cleared themes also prevent legacy tag filling');
assert.equal(parseMonthlyRemaining({headers:{get(k){
  return k==='x-ratelimit-policy'?'2;w=1, 1200;w=2592000':'1, 734';
}}}),734);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /boeken\nAllow: /open','/boeken/tekst'),false);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /boeken','/over'),true);
assert.equal(robotsAllowed('User-agent: *\nUser-agent: OtherBot\nDisallow: /','/boek'),false,
  'Consecutive agents belong to the same disallow group');
assert.equal(robotsAllowed('User-agent: OtherBot\nDisallow: /\n\nUser-agent: *\nAllow: /','/boek'),true,
  'Unrelated agents cannot impose their restrictions on Boekenbaai');
assert.equal(robotsAllowed('User-agent: *\nDisallow: /boeken\nAllow: /boeken/toegestaan','/boeken/toegestaan'),true,
  'A more specific allow rule must override a broad disallow');
assert.equal(selectImageResult([{title:'De brief voor de koning Tonke Dragt',
  imageUrl:'https://files.uitgeverijvoorbeeld.nl/debrief.jpg',width:300,height:430}],target),
  'https://files.uitgeverijvoorbeeld.nl/debrief.jpg');
assert.equal(selectImageResult([{title:'Onbekend boek',
  imageUrl:'https://files.uitgeverijvoorbeeld.nl/unknown.jpg',width:300,height:430}],target),'');

async function run(){
  let requestCount=0;
  const searchResult=await fetchBrave(0,target,{apiKey:'fixture',fetchImpl:async url=>{
    requestCount++;
    const params=new URL(url).searchParams;
    assert.equal(params.get('q'),target.isbn);
    assert.equal(params.get('extra_snippets'),'true');
    assert.equal(params.get('text_decorations'),'false');
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({web:{results:[
      {title:'Webwinkel | Boeken',url:'https://uitgeverijvoorbeeld.nl/boek',description:'ISBN '+target.isbn,extra_snippets:['Een origineel fragment','<b>Een tweede fragment</b>']},
      {title:target.title,url:'https://andere.example/boek',description:'Bestel nu online'},
    ]}})};
  }});
  assert.equal(requestCount,1);
  assert.equal(searchResult.pages[0].snippets.length,3);
  assert.equal(searchResult.pages[0].snippets[2],'Een tweede fragment');
  const rankedSnippets=rankPublisherCandidates(searchResult.pages.slice().reverse(),target);
  assert.equal(rankedSnippets[0].url,'https://uitgeverijvoorbeeld.nl/boek');
  const {createSearchSession}=require('../book-brave-search-session');
  let clock=1000;
  const session=createSearchSession({now:()=>clock,ttlMs:1000});
  const snippetSessionClaim={...target,id:'test-session',key:'exact-edition',step:0,source:'trial'};
  session.remember(snippetSessionClaim,searchResult.pages);
  assert.equal(session.view('test-session','exact-edition')[0].candidates[0].snippets.length,3);
  assert.deepEqual(session.view('other-job','exact-edition'),[]);
  assert.deepEqual(session.view('test-session','different-edition'),[]);
  clock=2001;
  assert.deepEqual(session.view('test-session','exact-edition'),[]);
  let opened=false;
  const dnsTimeout=await fetchHtml('https://www.uitgeverijvoorbeeld.nl/boek',{timeoutMs:500,
    dnsLookup:()=>new Promise(()=>{}),httpsGet:()=>{opened=true;throw Error('Unexpected request');}});
  assert.equal(dnsTimeout.error,'timeout');
  assert.equal(dnsTimeout.phase,'dns');
  assert.equal(opened,false,'A DNS stall must not block the worker or open a late request');
  const splitTarget={title:'Bas Nijhuis. Niet zeiken, voetballen!',author:'Eddy L., van der Ley',isbn:'9789048846757'};
  const splitHtml='<script type="application/ld+json">'+JSON.stringify({'@type':'Book',name:'Bas Nijhuis',alternateName:'Niet zeiken, voetballen!',author:{name:'Eddy van der Ley'},isbn:splitTarget.isbn,description:'Een scheidsrechter vertelt over zijn ervaringen met spelers, trainers en wedstrijden in het Nederlandse voetbal. Het boek bevat persoonlijke verhalen over zijn loopbaan en de arbitrage.'})+'</script>';
  assert.equal(parseBookPage(splitHtml,splitTarget,'https://publisher.example/book').confidence,'isbn');
  assert.equal(parseBookPage(splitHtml.replace('Niet zeiken, voetballen!','Een ander boek'),splitTarget,'https://publisher.example/book'),null);
  const snippetDiscovered=await discoverPages({pages:[{title:'Webwinkel | Boeken',url:'https://publisher.example/book',snippets:['ISBN '+splitTarget.isbn]}]},splitTarget,{fetchPage:async url=>url.endsWith('/robots.txt')?{body:'User-agent: *\\nAllow: /'}:{body:splitHtml}});
  assert.equal(snippetDiscovered.length,1,'An exact ISBN in a snippet can find a verified original page');
  const unrelatedOriginal=await discoverPages({pages:[{title:'Webwinkel | Boeken',url:'https://publisher.example/book',snippets:['ISBN '+splitTarget.isbn]}]},splitTarget,{fetchPage:async url=>url.endsWith('/robots.txt')?{body:'User-agent: *\\nAllow: /'}:{body:splitHtml.replace('Niet zeiken, voetballen!','Een ander boek')}});
  assert.equal(unrelatedOriginal.length,0,'Search snippets never override mismatched original page identity');
  const splitFailures=[];
  const splitPages=await discoverPages({pages:[
    {title:'Bas Nijhuis | Eerste bron',url:'https://first.example/book?private=omit'},
    {title:'Bas Nijhuis | Uitgever',url:'https://publisher.example/book'},
  ]},splitTarget,{fetchPage:async url=>url.endsWith('/robots.txt')?{body:'User-agent: *\\nAllow: /'}:url.includes('first.example')?{error:'request_error',phase:'dns',errorCode:'ENOTFOUND'}:{body:splitHtml},onFailure:(code,detail)=>splitFailures.push(detail)});
  assert.equal(splitPages.length,1);
  assert.equal(splitPages[0].isbn,splitTarget.isbn);
  assert.equal(splitFailures[0].phase,'dns');
  assert.equal(splitFailures[0].errorCode,'ENOTFOUND');
  assert.ok(Number.isSafeInteger(splitFailures[0].elapsedMs));
  // Late stream errors after a 404 response must not crash Node: the
  // IncomingMessage handler must be registered before resume() is called.
  const lateHttpResult=await fetchHtml('https://www.uitgeverijvoorbeeld.nl/boek',{
    dnsLookup:async()=>[{address:'8.8.8.8'}],
    httpsGet:(_url,_options,onResponse)=>{
      const request=new EventEmitter();
      const response=new EventEmitter();
      response.statusCode=404;
      response.headers={};
      response.resume=()=>setImmediate(()=>response.emit('error',new Error('late remote stream failure')));
      onResponse(response);
      return request;
    },
  });
  assert.equal(lateHttpResult.status,404);
  await new Promise(resolve=>setTimeout(resolve,25));
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
  const discoveryFailures=[];
  const blocked=await discoverPages({pages:[
    {title:'De brief voor de koning',url:'https://www.uitgeverijvoorbeeld.nl/boek'},
  ]},target,{fetchPage:async url=>url.endsWith('/robots.txt')
    ?{error:'request_error'}:{body:html},onFailure:error=>discoveryFailures.push(error)});
  assert.deepEqual(discoveryFailures,['source_unavailable']);
  assert.equal(blocked.length,0,
    'If robots.txt is unreachable, page crawling is not authorized');

  // The remote request must never reach a disallowed redirect target.
  const attemptedPages=[];
  const robotsRedirect=await discoverPages({pages:[
    {title:target.title,url:'https://www.uitgeverijvoorbeeld.nl/open'},
  ]},target,{fetchPage:async(url,opts={})=>{
    if(url.endsWith('/robots.txt'))return {body:'User-agent: *\nDisallow: /blocked\nAllow: /open'};
    return fetchHtml(url,{
      ...opts,dnsLookup:async()=>[{address:'8.8.8.8'}],
      httpsGet:(location,_opts,respond)=>{
        attemptedPages.push(location.pathname);
        const request=new EventEmitter(),response=new EventEmitter();
        response.statusCode=302;
        response.headers={location:'/blocked/book'};
        response.resume=()=>{};
        respond(response);
        return request;
      },
    });
  }});
  assert.equal(robotsRedirect.length,0);
  assert.deepEqual(attemptedPages,['/open'],
    'Never fetch a redirect landing in a robots-disallowed path');

  const otherHostRequests=[];
  const crossHost=await discoverPages({pages:[
    {title:target.title,url:'https://www.uitgeverijvoorbeeld.nl/open'},
  ]},target,{fetchPage:async(url,opts={})=>{
    if(url.endsWith('/robots.txt')){
      return {body:url.includes('verkeerde.nl')
        ? 'User-agent: *\nDisallow: /' : 'User-agent: *\nAllow: /'};
    }
    return fetchHtml(url,{
      ...opts,dnsLookup:async()=>[{address:'8.8.8.8'}],
      httpsGet:(location,_opts,respond)=>{
        otherHostRequests.push(location.hostname);
        const request=new EventEmitter(),response=new EventEmitter();
        response.statusCode=302;
        response.headers={location:'https://www.verkeerde.nl/blocked/book'};
        response.resume=()=>{};
        respond(response);
        return request;
      },
    });
  }});
  assert.equal(crossHost.length,0);
  assert.deepEqual(otherHostRequests,['www.uitgeverijvoorbeeld.nl'],
    'Check the destination host robots.txt before following its redirect');

  // A redirected landing page can have image: "cover.jpg"; resolve it
  // against the actual response location rather than the original link.
  const relativePage=`<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Book",
"name":"De brief voor de koning","author":{"name":"Tonke Dragt"},
"image":"cover.jpg"}
</script>`;
  const redirectResult=await fetchHtml('https://www.uitgeverijvoorbeeld.nl/old-book',{
    dnsLookup:async()=>[{address:'8.8.8.8'}],
    httpsGet:(url,_opts,respond)=>{
      const request=new EventEmitter();
      const response=new EventEmitter();
      response.resume=()=>{};
      if(url.pathname==='/old-book'){
        response.statusCode=302;
        response.headers={location:'/books/current/'};
        respond(response);
      }else{
        assert.equal(url.pathname,'/books/current/');
        response.statusCode=200;
        response.headers={'content-type':'text/html'};
        respond(response);
        setImmediate(()=>{response.emit('data',Buffer.from(relativePage));response.emit('end');});
      }
      return request;
    },
  });
  assert.equal(redirectResult.finalUrl,
    'https://www.uitgeverijvoorbeeld.nl/books/current/');
  const redirected=await discoverPages({pages:[
    {title:target.title,url:'https://www.uitgeverijvoorbeeld.nl/old-book'},
  ]},target,{fetchPage:async url=>url.endsWith('/robots.txt')
    ?{body:'User-agent: *\nAllow: /'}:redirectResult});
  assert.equal(redirected[0]?.coverUrl,
    'https://www.uitgeverijvoorbeeld.nl/books/current/cover.jpg');
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
  assert.ok(getBraveCheck(db2,'x',JSON.stringify([target.isbn,target.title.toLowerCase(),target.author.toLowerCase()]),0).evidence.some(e=>e.field==='coverUrl'&&e.url===found.sourceUrl));
  assert.equal(db2.books[0].coverUrl,found.coverUrl);
  assert.deepEqual(db2.books[0].tags,found.tags);
  assert.match(db2.books[0].description,/gevaarlijke reis/);
  assert.equal(cover,1);
  assert.deepEqual(db2.students,undefined,'Worker does not modify students');
  worker.stop();

  // The exact edition's cover can be recovered from a verified source page
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
  const tempDb={books:[book('transient')],braveEnrichmentJobs:[]};
  const transientJob=addJob(tempDb,['transient'],{id:'transient-error'});
  assert.equal(approveJob(tempDb,transientJob.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const transientClaim=claimNext(tempDb,{now,env:environment});
  finishClaim(tempDb,transientClaim,{error:'timeout'});
  assert.equal(transientJob.state,'paused');
  assert.equal(transientJob.completedKeys.length,0,
    'Three permitted searches must not mark a failed work complete');
  assert.equal(tempDb.braveUsage.reserved,1,'The failed request stays debited');
  assert.equal(getJobPlan(tempDb,transientJob,{braveConfigured:true,now,env:environment}).canApprove,true);

  const workerErrorDb={books:[book('worker-error')],braveEnrichmentJobs:[]};
  const workerErrorJob=addJob(workerErrorDb,['worker-error'],{id:'worker-error'});
  assert.equal(approveJob(workerErrorDb,workerErrorJob.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  let failedSearchCount=0;
  const failedWorker=createBraveWorker({
    apiKey:'test-only-key',loadDb:()=>workerErrorDb,
    commit:async(fn)=>fn(workerErrorDb),delayMs:50,
    fetchSearch:async()=>{failedSearchCount++;return {error:'request_error'};},
  });
  failedWorker.schedule();
  await new Promise(resolve=>setTimeout(resolve,320));
  assert.equal(failedSearchCount,1,'A transient outage must not spend the rest of the budget');
  assert.equal(workerErrorJob.state,'paused');
  assert.equal(workerErrorJob.completedKeys.length,0);
  failedWorker.stop();
  // A source website may fail while the API works. Log it without
  // freezing the rest of the already approved searches.
  const sourceErrorDb={books:[book('source-error'),book('next','De geheime opdracht')],braveEnrichmentJobs:[]};
  const sourceErrorJob=addJob(sourceErrorDb,['source-error','next'],{id:'source-error'});
  assert.equal(approveJob(sourceErrorDb,sourceErrorJob.id,{confirmed:true,expectedRequests:6,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const sourceErrorWorker=createBraveWorker({
    apiKey:'test-only-key',loadDb:()=>sourceErrorDb,
    commit:async fn=>fn(sourceErrorDb),delayMs:50,
    fetchSearch:async(step,claim)=>({pages:[{title:claim.title,url:'https://www.uitgeverijvoorbeeld.nl/boek'}],
      images:[{title:claim.title,pageUrl:'https://www.uitgeverijvoorbeeld.nl/boek'}]}),
    findPages:(result,claim,options)=>discoverPages(result,claim,{
      ...options,fetchPage:async url=>url.endsWith('/robots.txt')
        ?{body:'User-agent: *\nAllow: /'}:{error:'request_error'},
    }),
  });
  sourceErrorWorker.schedule(50);
  await new Promise(resolve=>setTimeout(resolve,900));
  sourceErrorWorker.stop();
  assert.equal(sourceErrorJob.state,'complete','Approved search steps finish even if a website is inaccessible');
  assert.equal(sourceErrorJob.completedKeys.length,2);
  assert.equal(sourceErrorDb.braveUsage.reserved,6);
  const warning=getBraveCheck(sourceErrorDb,'source-error',require('../book-free-metadata').workKey(sourceErrorDb.books[0]),0);
  assert.equal(warning.status,'source_partial');
  assert.equal(warning.sourceFailures[0].url,'https://www.uitgeverijvoorbeeld.nl/boek');
  assert.ok(Number.isSafeInteger(warning.sourceFailures[0].elapsedMs));
  assert.equal(warning.diagnostic.apiOk,true);
  assert.equal(warning.diagnostic.verifiedPages,0);
  assert.equal(sourceErrorJob.lastFailure.sourceFailures[0].url,'https://www.uitgeverijvoorbeeld.nl/boek');
  assert.equal(sourceErrorJob.lastDiagnostic.apiOk,true);
  const historical=JSON.parse(JSON.stringify(sourceErrorDb));
  delete historical.braveEnrichmentJobs[0].lastFailure.sourceFailures;
  assert.equal(getJobPlan(historical,historical.braveEnrichmentJobs[0],{now,env:environment}).lastFailure.sourceFailures[0].url,'https://www.uitgeverijvoorbeeld.nl/boek');
  // Exercise the actual asynchronous worker, not only the claim helpers.
  const recoveryDb={books:[book('slow'),book('healthy-worker','De geheime opdracht')],braveEnrichmentJobs:[]};
  const recoveryJob=addJob(recoveryDb,['slow','healthy-worker'],{id:'recovery-worker',source:'trial'});
  assert.equal(approveJob(recoveryDb,recoveryJob.id,{confirmed:true,expectedRequests:6,expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const visited=[];
  const recoveryWorker=createBraveWorker({apiKey:'test-only-key',loadDb:()=>recoveryDb,commit:async fn=>fn(recoveryDb),delayMs:50,transientDelayMs:50,
    fetchSearch:async(step,claim)=>{visited.push(claim.title);return visited.length===1?{error:'timeout'}:{pages:[]};},
    findPages:async()=>[],
  });
  recoveryWorker.schedule(50);
  await new Promise(resolve=>setTimeout(resolve,900));
  recoveryWorker.stop();
  assert.ok(visited.length>1,'The worker must continue beyond the first API timeout');
  assert.ok(visited.slice(1).every(title=>title!==visited[0]),'No automatic retry of the deferred title');
  assert.equal(recoveryJob.state,'paused');
  assert.equal(recoveryJob.completedKeys.length,1);
  assert.equal(recoveryDb.braveUsage.reserved,visited.length);
  // An isolated API timeout leaves that title unfinished but advances to
  // the next title; two consecutive failures stop the approved chunk.
  const mixed={books:[book('timeout'),book('healthy','De geheime opdracht')]};
  const mixedJob=addJob(mixed,['timeout','healthy'],{id:'mixed',source:'trial'});
  assert.equal(approveJob(mixed,mixedJob.id,{confirmed:true,expectedRequests:6,expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  const timed=claimNext(mixed,{now,env:environment});
  finishClaim(mixed,timed,{error:'timeout'});
  assert.equal(mixedJob.state,'running');
  assert.equal(mixedJob.lastFailure.title,timed.title);
  assert.equal(mixedJob.lastFailure.stage,'brave');
  let following=claimNext(mixed,{now,env:environment});
  assert.notEqual(following.key,timed.key);
  do{finishClaim(mixed,following,{status:'no_result'});}while((following=claimNext(mixed,{now,env:environment})));
  assert.equal(mixedJob.state,'paused');
  assert.equal(mixedJob.completedKeys.length,1);
  assert.ok(!mixedJob.completedKeys.includes(timed.key));
  assert.equal(mixedJob.trialBudget.used,4);
  assert.equal(getJobPlan(mixed,mixedJob,{now,env:environment,braveConfigured:true}).possibleMaxRequests,2);
  const outage={books:[book('a'),book('b','B'),book('c','C')]};
  const outageJob=addJob(outage,['a','b','c'],{source:'trial'});
  assert.equal(approveJob(outage,outageJob.id,{confirmed:true,expectedRequests:6,expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  finishClaim(outage,claimNext(outage,{now,env:environment}),{error:'timeout'});
  finishClaim(outage,claimNext(outage,{now,env:environment}),{error:'request_error'});
  assert.equal(outageJob.state,'paused');
  assert.equal(outageJob.completedKeys.length,0);
  assert.equal(outage.braveUsage.reserved,2);
  assert.equal(claimNext(outage,{now,env:environment}),null);
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

  // If an import begins during a Brave network fetch, the retrieved result
  // must wait in memory. Neither metadata nor the durable job checkpoint
  // may be written while that import is using the database.
  const pausedDb={books:[book('during-import')],braveEnrichmentJobs:[]};
  const pausedJob=addJob(pausedDb,['during-import'],{id:'during-import'});
  assert.equal(approveJob(pausedDb,pausedJob.id,{confirmed:true,expectedRequests:3,
    expectedMonth:'2026-11',braveConfigured:true,now,env:environment}).ok,true);
  let importActive=false;
  let pendingSearch=false;
  let claimedCommitCount=0;
  const concurrentWorker=createBraveWorker({
    apiKey:'test-only-key',loadDb:()=>pausedDb,
    isPaused:()=>importActive,delayMs:50,
    commit:async fn=>{
      claimedCommitCount++;
      return fn(pausedDb);
    },
    fetchSearch:async ()=>{
      importActive=true;
      pendingSearch=true;
      return {pages:[{title:target.title,url:'https://www.uitgeverijvoorbeeld.nl/boek'}]};
    },
    findPages:async ()=>[{...found,description:found.description.repeat(4)}],
  });
  concurrentWorker.schedule();
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(pendingSearch,true);
  assert.equal(claimedCommitCount,1,
    'No result commit while an import is active; only the initial claim is recorded');
  assert.equal(pausedDb.books[0].coverUrl,'');
  assert.equal(pausedJob.inFlight?.step,0,
    'The claim must survive while import blocks result persistence');
  importActive=false;
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(pausedDb.books[0].coverUrl,found.coverUrl,
    'The pending result must be applied after the import is complete');
  assert.equal(pausedJob.state,'complete');
  concurrentWorker.stop();
  console.log('Brave deferred consent, persistent budget, verifiable scraping and worker passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
