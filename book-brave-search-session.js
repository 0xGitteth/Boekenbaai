'use strict';
// Search API results are transient operational data, NOT catalogue
// metadata, saved proposals or a database. No disk serialization.
const {safeCoverUrl}=require('./lib/cover-assets');
const {candidateMayMatch,rankPublisherCandidates}=require('./book-brave-fetch');
const TTL_MS=10*60*1000, MAX_ENTRIES=64;
function createSearchSession({now=Date.now,ttlMs=TTL_MS,maxEntries=MAX_ENTRIES}={}){
  const entries=new Map();
  const keyOf=(jobId,identity,step)=>JSON.stringify([jobId,identity,step]);
  function remove(key){const item=entries.get(key);if(item?.timer)clearTimeout(item.timer);entries.delete(key);}
  function prune(){for(const [key,item] of entries)if(item.expiresAt<=now())remove(key);}
  function remember(claim,pages){
    if(claim?.source!=='trial'||!claim.id||!claim.key||![0,2].includes(claim.step))return;
    prune();
    const key=keyOf(claim.id,claim.key,claim.step);
    remove(key);
    const candidates=[];
    for(const page of rankPublisherCandidates((Array.isArray(pages)?pages:[]).slice(0,8),claim)){
      if(!candidateMayMatch(claim,page))continue;
      try{
        const u=safeCoverUrl(page.url);if(u.protocol!=='https:')continue;
        u.hash='';
        const snippets=(Array.isArray(page.snippets)?page.snippets:[]).filter(v=>typeof v==='string'&&v.trim()).slice(0,6).map(v=>v.slice(0,650));
        const bookHints=(Array.isArray(page.bookHints)?page.bookHints:[]).filter(h=>h.isbn&&h.isbn===claim.isbn).slice(0,4);
        if(!snippets.length&&!bookHints.length)continue;
        candidates.push({title:String(page.title||'').slice(0,250),url:u.href,snippets,bookHints});
      }catch{/* no unsafe links */}
    }
    if(!candidates.length)return;
    while(entries.size>=maxEntries)remove(entries.keys().next().value);
    const expiresAt=now()+ttlMs;
    const item={jobId:claim.id,step:claim.step,expiresAt,candidates};
    item.timer=setTimeout(()=>remove(key),ttlMs);item.timer.unref?.();
    entries.set(key,item);
  }
  function view(jobId,identity){
    prune();
    return [0,2].map(step=>entries.get(keyOf(jobId,identity,step))).filter(Boolean)
      .map(({step,expiresAt,candidates})=>({step,expiresAt,candidates:structuredClone(candidates)}));
  }
  function clear(jobId){for(const [key,item] of entries)if(item.jobId===jobId)remove(key);}
  return {remember,view,clear};
}
module.exports={createSearchSession,searchSession:createSearchSession()};
