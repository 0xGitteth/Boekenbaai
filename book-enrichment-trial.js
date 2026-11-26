'use strict';
const {isbnOf,workKey,usableFor}=require('./book-free-metadata');
const {safeCoverUrl}=require('./lib/cover-assets');
const {createHash}=require('node:crypto');

const SOURCE='boekenbase';
const FIELDS=['description','publisher','imprint','publishedYear','pageCount','language','nurCode','nurCategory','seriesTitle','seriesNumber','coverUrl','enrichmentTags'];
const TERMINAL=new Set(['found','not_found','identity_mismatch']);
const keyOf=book=>createHash('sha256').update(workKey(book)).digest('hex');
function getCheck(db,book,source=SOURCE){
  return db.bookEnrichmentSourceChecks?.[keyOf(book)]?.[source]||null;
}
function attemptSummary(status,checkedAt,metadata){
  return {status,checkedAt,fields:metadata?Object.keys(metadata).filter(key=>
    ['description','publisher','imprint','publishedYear','pageCount','language','nurCode','nurCategory','seriesTitle','seriesNumber','coverUrl','tags'].includes(key)
    &&present(metadata[key])):[],
    sourceUrl:typeof metadata?.sourceUrl==='string'&&metadata.sourceUrl.startsWith('https://')?metadata.sourceUrl.slice(0,1500):null,
    matchLevel:typeof metadata?.matchLevel==='string'?metadata.matchLevel.slice(0,40):null};
}
function recordCheck(db,book,result,{now=new Date(),source=SOURCE}={}){
  if(!db.bookEnrichmentSourceChecks||typeof db.bookEnrichmentSourceChecks!=='object'
    ||Array.isArray(db.bookEnrichmentSourceChecks))db.bookEnrichmentSourceChecks={};
  const key=keyOf(book);
  const entry=db.bookEnrichmentSourceChecks[key]||={};
  const verified=result?.status==='found'&&usableFor(book,result.metadata)&&Boolean(result.metadata.author);
  const status=result?.status==='found'&&!verified?'identity_mismatch':String(result?.status||'invalid_response');
  const prior=entry[source];
  // A forced retry that fails must not destroy a previous usable result.
  const previous=Array.isArray(prior?.attemptHistory)?prior.attemptHistory
    :prior?[attemptSummary(prior.status,prior.checkedAt,prior.metadata)]:[];
  const attemptHistory=[...previous,attemptSummary(status,now.toISOString(),verified?result.metadata:null)].slice(-20);
  const current={status,checkedAt:now.toISOString(),metadata:verified?result.metadata:null,attemptHistory,
    ...(prior?.appliedCopies?{appliedCopies:prior.appliedCopies}:{})};
  if(!TERMINAL.has(status)&&TERMINAL.has(prior?.status)){
    entry[source]={...prior,lastError:status,lastAttemptAt:current.checkedAt,attemptHistory};
  }else{
    entry[source]=current;
  }
  return entry[source];
}
function shouldProbe(db,book,repeat=false,source=SOURCE){
  return Boolean(isbnOf(book)&&book.title&&book.author&&(repeat||!TERMINAL.has(getCheck(db,book,source)?.status)));
}
function present(value){
  return Array.isArray(value)?value.length>0:value!==null&&value!==undefined&&value!==''&&value!==0;
}
function cleanCover(value){
  if(typeof value!=='string'||!value)return '';
  try{const u=safeCoverUrl(value);return u.protocol==='https:'?u.href:'';}catch{return '';}
}
function proposedChanges(book,check,failedCovers=new Set(),source=SOURCE){
  const metadata=check?.status==='found'&&usableFor(book,check.metadata)?check.metadata:null;
  if(!metadata)return [];
  const changes=[];
  for(const field of FIELDS){
    if(book.importProvenance?.fieldSources?.[field]?.sourceType==='manual')continue;
    const before=book[field];
    let after=metadata[field];
    if(field==='enrichmentTags'){
      if(book.themesCleared===true)continue;
      const old=Array.isArray(before)?before:[];
      const tags=new Map(old.filter(t=>typeof t==='string'&&t.trim()).map(t=>[t.trim().toLocaleLowerCase('nl-NL'),t]));
      for(const tag of Array.isArray(metadata.tags)?metadata.tags:[]){
        if(typeof tag!=='string'||!tag.trim()||tags.size>=30)continue;
        const normalized=tag.trim().toLocaleLowerCase('nl-NL');
        if(!tags.has(normalized))tags.set(normalized,tag.trim());
      }
      after=[...tags.values()];
      if(after.length===old.length)continue;
    }else if(field==='coverUrl'){
      after=cleanCover(after);
      if(book.localCoverUrl||!after||after===before||failedCovers.has(after))continue;
      // A proven invalid legacy file is not a populated, usable cover.
      // Explicit manual provenance above still protects the teacher's choice.
      if(present(before)&&!(failedCovers.has(before)
        &&(book.rejectedCoverSource===before||book.importProvenance?.fieldSources?.coverUrl?.sourceType==='metadata')))continue;
    }else{
      // Do not silently replace any existing information, even if another
      // source offers a longer description or a conflicting year.
      if(present(before)||!present(after))continue;
      if(field==='publishedYear'&&(!Number.isInteger(after)||after<1||after>2100))continue;
      if(field==='pageCount'&&(!Number.isInteger(after)||after<1||after>20000))continue;
      if(!['pageCount','publishedYear'].includes(field)&&typeof after!=='string')continue;
    }
    changes.push({field,before:before??null,after,source});
  }
  return changes;
}
function trialView(db,book,failedCovers=new Set()){
  const check=getCheck(db,book);
  const changes=proposedChanges(book,check,failedCovers);
  const snapshot={bookId:book.id,identity:keyOf(book),checkedAt:check?.checkedAt||null,changes};
  const revision=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return {...snapshot,revision,title:book.title,author:book.author,isbn:isbnOf(book),
    sourceDetails:check?.status==='found'?{
      publisher:check.metadata?.publisher||'',imprint:check.metadata?.imprint||'',
      nurCategory:check.metadata?.nurCategory||'',nurCode:check.metadata?.nurCode||'',
      keywordCount:Array.isArray(check.metadata?.tags)?check.metadata.tags.length:0,
    }:null,
    status:check?.status||'not_checked',lastError:check?.lastError||null,
    appliedAt:check?.appliedCopies?.[createHash('sha256').update(String(book.id)).digest('hex')]||null};
}
function applyTrial(db,book,revision,failedCovers=new Set(),now=new Date()){
  const view=trialView(db,book,failedCovers);
  if(view.revision!==revision)return {ok:false,error:'stale_preview'};
  if(view.status!=='found')return {ok:false,error:'no_verified_result'};
  for(const change of view.changes){
    book[change.field]=change.after;
    if(change.field==='coverUrl'){book.localCoverUrl='';book.coverCrop=null;}
    if(!book.importProvenance||typeof book.importProvenance!=='object')book.importProvenance={};
    if(!book.importProvenance.fieldSources)book.importProvenance.fieldSources={};
    book.importProvenance.fieldSources[change.field]={sourceType:'metadata',sourceDetail:SOURCE};
  }
  const check=getCheck(db,book);
  const copyKey=createHash('sha256').update(String(book.id)).digest('hex');
  const appliedCopies=check.appliedCopies||={};
  appliedCopies[copyKey]=now.toISOString();
  return {ok:true,updated:view.changes.length,newCover:view.changes.some(c=>c.field==='coverUrl')};
}
function catalogue(db){
  const unique=new Map();
  for(const book of db.books||[]){
    if(!book.id||book.personalLoanOnly===true||!isbnOf(book)||!book.title||!book.author)continue;
    const key=keyOf(book);
    if(!unique.has(key))unique.set(key,[]);
    unique.get(key).push(book);
  }
  return [...unique.values()].map(copies=>{
    const book=copies[0],check=getCheck(db,book);
    return {id:book.id,title:book.title,author:book.author,isbn:isbnOf(book),
      copies:copies.length,status:check?.status||'not_checked',checkedAt:check?.checkedAt||null,
      pendingCopies:copies.filter(b=>proposedChanges(b,check).length).length};
  }).sort((a,b)=>a.title.localeCompare(b.title,'nl'));
}
function editionViews(db,book,failedCovers=new Set()){
  return (db.books||[]).filter(b=>b.personalLoanOnly!==true&&workKey(b)===workKey(book)).map(b=>trialView(db,b,failedCovers));
}
module.exports={keyOf,getCheck,recordCheck,shouldProbe,proposedChanges,trialView,applyTrial,catalogue,editionViews};
