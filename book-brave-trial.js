'use strict';
const {createHash}=require('node:crypto');
const {workKey,isbnOf}=require('./book-free-metadata');
const {getCheck}=require('./book-enrichment-trial');
const {comparison}=require('./book-enrichment-comparison');
const {updateFromPages}=require('./book-brave-page-apply');
const FIELDS=['description','publisher','pageCount','tags','enrichmentTags','coverUrl'];
function selectTrialBooks(db,ids,{sources=[],failedCovers=new Set(),expand=true}={}){
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'))return {ok:false,error:'invalid_selection'};
  const selected=[...new Set(ids)].map(id=>(db.books||[]).find(b=>b.id===id)).filter(b=>expand||b);
  if(!selected.length)return {ok:false,error:'invalid_selection'};
  if(selected.some(b=>!b||b.personalLoanOnly===true||!isbnOf(b)||!b.title||!b.author))
    return {ok:false,error:'invalid_selection'};
  const keys=new Set(selected.map(workKey));
  if(keys.size>5)return {ok:false,error:'too_many_editions'};
  const books=expand?(db.books||[]).filter(b=>b.personalLoanOnly!==true&&keys.has(workKey(b))):selected;
  for(const book of books){
    if(sources.some(source=>!['found','not_found','identity_mismatch'].includes(getCheck(db,book,source)?.status)))
      return {ok:false,error:'free_research_pending'};
    if(comparison(db,book,failedCovers).changes.length)return {ok:false,error:'free_proposals_pending'};
  }
  return {ok:true,bookIds:books.map(b=>b.id)};
}
function storeTrialResult(job,claim,pages,imageUrl=''){
  if(job.source!=='trial')return;
  const entries=job.trialResults||={};
  const byStep=entries[claim.key]||={};
  const previous=byStep[claim.step]||{};
  // Only verified ORIGINAL page metadata, not search result payloads.
  const unique=new Map();
  for(const page of [...(previous.pages||[]),...(pages||[])]){
    if(!page||!['isbn','title_author'].includes(page.confidence))continue;
    const safe={};
    for(const field of ['title','author','isbn','description','coverUrl','publisher','confidence','sourceUrl'])
      if(typeof page[field]==='string')safe[field]=page[field].slice(0,2500);
    safe.pageCount=Number.isSafeInteger(page.pageCount)&&page.pageCount>0&&page.pageCount<20000?page.pageCount:null;
    safe.tags=(Array.isArray(page.tags)?page.tags:[]).filter(t=>typeof t==='string').slice(0,16).map(t=>t.slice(0,70));
    unique.set(JSON.stringify([safe.sourceUrl,safe.isbn,safe.description,safe.coverUrl]),safe);
  }
  byStep[claim.step]={pages:[...unique.values()].slice(-3),imageUrl:typeof imageUrl==='string'?imageUrl.slice(0,1500):''};
}
function projectTrial(db,job,books,failedCovers=new Set()){
  const projected=structuredClone(books);
  const clone={...db,books:projected};
  const key=books[0]?workKey(books[0]):'';
  const results=job.trialResults?.[key]||{};
  const evidenceByBook=Object.create(null);
  for(const step of ['0','1','2']){
    if(!results[step])continue;
    const update=updateFromPages(clone,{key,bookIds:books.map(b=>b.id)},results[step].pages,{
      imageUrl:results[step].imageUrl,failedCovers});
    for(const [id,evidence] of Object.entries(update.evidenceByBook||{}))
      (evidenceByBook[id]||=[]).push(...evidence);
  }
  return {books:projected,evidenceByBook};
}
function preview(db,job,book,failedCovers=new Set()){
  if(job.source!=='trial'||!job.bookIds.includes(book.id)||book.personalLoanOnly===true)return null;
  const projected=projectTrial(db,job,[book],failedCovers);
  const next=projected.books[0];
  const changes=FIELDS.filter(field=>JSON.stringify(book[field]??null)!==JSON.stringify(next[field]??null))
    .map(field=>({field,before:book[field]??null,after:next[field]??null,
      sources:(projected.evidenceByBook[book.id]||[]).filter(e=>e.field===field)}));
  const snapshot={jobId:job.id,bookId:book.id,identity:workKey(book),changes};
  return {...snapshot,title:book.title,author:book.author,barcode:String(book.barcode||'').trim(),
    revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
function releaseTrialCheckpoints(db,job,bookId=null){
  for(const entry of Object.values(db.bookEnrichmentChecks||{})){
    for(const check of Object.values(entry?.brave||{})){
      if(check.jobId===job.id&&(!bookId||check.trialBookId===bookId))check.trialPending=false;
    }
  }
}
function applyPreview(db,job,book,revision,failedCovers=new Set()){
  if(job.state==='running')return {ok:false,error:'running'};
  const view=preview(db,job,book,failedCovers);
  if(!view||view.revision!==revision)return {ok:false,error:'stale_preview'};
  if(!view.changes.length)return {ok:false,error:'no_changes'};
  const next=projectTrial(db,job,[book],failedCovers).books[0];
  for(const change of view.changes){
    book[change.field]=next[change.field];
    if(change.field==='coverUrl'){book.localCoverUrl=next.localCoverUrl;book.coverCrop=next.coverCrop;}
    if(!book.importProvenance||typeof book.importProvenance!=='object')book.importProvenance={};
    if(!book.importProvenance.fieldSources)book.importProvenance.fieldSources={};
    book.importProvenance.fieldSources[change.field]=next.importProvenance.fieldSources[change.field];
  }
  (job.trialAppliedCopies||={})[createHash('sha256').update(String(book.id)).digest('hex')]=new Date().toISOString();
  releaseTrialCheckpoints(db,job,book.id);
  if(job.state==='complete'&&!(db.books||[]).some(b=>preview(db,job,b,failedCovers)?.changes.length)){
    job.trialReviewedAt=new Date().toISOString();releaseTrialCheckpoints(db,job);
  }
  return {ok:true,updated:view.changes.length,newCover:view.changes.some(c=>c.field==='coverUrl')};
}
function pendingTrialReview(db,failedCovers=new Set()){
  return (db.braveEnrichmentJobs||[]).some(job=>job.source==='trial'&&!job.trialReviewedAt
    &&(db.books||[]).some(book=>preview(db,job,book,failedCovers)?.changes.length));
}
function dismissTrial(db,job,now=new Date()){
  if(job?.source!=='trial'||job.state==='running'||job.inFlight)return {ok:false,error:'not_ready'};
  // Keep the verified research and ledger. Declining the suggestions does
  // not erase paid requests or authorize their automatic repetition.
  job.state='complete';job.approvedKeys=[];job.approval=null;job.trialReviewedAt=now.toISOString();
  job.trialDismissedAt=job.trialReviewedAt;job.updatedAt=job.trialReviewedAt;
  releaseTrialCheckpoints(db,job);
  return {ok:true};
}
module.exports={selectTrialBooks,storeTrialResult,projectTrial,preview,applyPreview,pendingTrialReview,dismissTrial,releaseTrialCheckpoints};
