'use strict';
const {createHash}=require('node:crypto');
const {isbnOf,workKey,usableFor}=require('./book-free-metadata');
const {getCheck,proposedChanges,keyOf}=require('./book-enrichment-trial');
const {SOURCE_ORDER,sourceRank}=require('./book-enrichment-sources');
const {normalizeLanguage}=require('./isbn-lookup-core-impl');
const fieldValue=(field,value)=>field==='language'&&typeof value==='string'?normalizeLanguage(value):value;
const {approvedDescriptions,identity:descriptionIdentity}=require('./book-enrichment-content');

const keyText=value=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('nl-NL'):JSON.stringify(value);
const byRank=(a,b)=>sourceRank(a.source)-sourceRank(b.source);
const isPresent=value=>Array.isArray(value)?value.length>0:typeof value==='string'?Boolean(value.trim()):value!==null&&value!==undefined&&value!==0;
const comparableFields=['publisher','imprint','publishedYear','pageCount','language','nurCode','nurCategory','seriesTitle','seriesNumber'];
function validCheck(book,check){
  return check?.status==='found'&&Boolean(check.metadata?.author)&&usableFor(book,check.metadata);
}
function comparison(db,book,failedCovers=new Set(),sources=SOURCE_ORDER){
  const ids=SOURCE_ORDER.filter(source=>sources.includes(source));
  const checks=ids.map(source=>({source,check:getCheck(db,book,source)}));
  const verified=checks.filter(({check})=>validCheck(book,check));
  const candidates=new Map();
  for(const {source,check} of verified){
    for(const change of proposedChanges(book,check,failedCovers,source)){
      if(!candidates.has(change.field))candidates.set(change.field,[]);
      candidates.get(change.field).push({...change,after:fieldValue(change.field,change.after)});
    }
  }
  // A long source description is useful even when the teacher has supplied
  // their own summary. Do not replace it. A short machine-supplied summary
  // may be improved only if the administrator explicitly approves the preview.
  if(book.importProvenance?.fieldSources?.description?.sourceType==='metadata'
    &&typeof book.description==='string'&&book.description.trim().length<280){
    for(const {source,check} of verified){
      const after=check.metadata.description;
      if(typeof after==='string'&&after.trim().length>=90
        &&after.trim().length>book.description.trim().length+40){
        if(!candidates.has('description'))candidates.set('description',[]);
        candidates.get('description').push({field:'description',before:book.description,after,source});
      }
    }
  }
  const changes=[];
  for(const [field,values] of candidates){
    values.sort(byRank);
    if(field==='enrichmentTags'){
      const before=Array.isArray(book.enrichmentTags)?book.enrichmentTags:[];
      const tags=new Map(before.filter(t=>typeof t==='string'&&t.trim()).map(t=>[keyText(t),t]));
      const origins=[];
      for(const item of values){
        let added=false;
        for(const value of item.after){
          const key=keyText(value);
          if(!key||tags.has(key)||tags.size>=30)continue;
          tags.set(key,value);added=true;
        }
        if(added)origins.push(item.source);
      }
      if(origins.length)changes.push({field,before:book.enrichmentTags??null,after:[...tags.values()],
        source:origins[0],sources:origins});
      continue;
    }
    if(comparableFields.includes(field)&&new Set(values.map(v=>keyText(v.after))).size>1)continue;
    if(field==='description')values.sort((a,b)=>b.after.trim().length-a.after.trim().length||byRank(a,b));
    const chosen=values[0];
    const agreeing=values.filter(v=>keyText(v.after)===keyText(chosen.after)).map(v=>v.source);
    changes.push({...chosen,sources:agreeing});
  }
  // Preserve separately approved descriptions even when a teacher's own
  // displayed description is protected. Distinct source text is weak
  // recommendation evidence, not a verified tag or a replacement summary.
  if(book.themesCleared!==true
    &&book.importProvenance?.fieldSources?.enrichmentDescriptions?.sourceType!=='manual'){
    const before=approvedDescriptions(book);
    const mainText=changes.find(c=>c.field==='description')?.after||book.description||'';
    const seen=new Set([keyText(mainText),...before.map(entry=>keyText(entry.text))]);
    const after=[...before],sources=[];
    for(const {source,check} of verified){
      const text=typeof check.metadata.description==='string'?check.metadata.description.trim().slice(0,2500):'';
      if(text.length<90||seen.has(keyText(text))||after.length>=6)continue;
      seen.add(keyText(text));
      after.push({source,text,identity:descriptionIdentity(book)});
      if(!sources.includes(source))sources.push(source);
    }
    if(sources.length)changes.push({field:'enrichmentDescriptions',before,after,source:sources[0],sources});
  }
  // Surface conflicts without altering populated fields. A source can be
  // incomplete without being wrong; absent values are not disagreements.
  const conflicts=[];
  for(const field of comparableFields){
    const values=verified.filter(({check})=>isPresent(check.metadata[field]))
      .map(({source,check})=>({source,value:fieldValue(field,check.metadata[field])}));
    if(isPresent(book[field]))values.unshift({source:'catalogue',value:fieldValue(field,book[field])});
    if(new Set(values.map(v=>keyText(v.value))).size>1)conflicts.push({field,values});
  }
  const statuses=checks.map(({source,check})=>({source,status:check?.status||'not_checked',
    checkedAt:check?.checkedAt||null,lastError:check?.lastError||null,lastAttemptAt:check?.lastAttemptAt||null,
    sourceUrl:typeof check?.metadata?.sourceUrl==='string'&&check.metadata.sourceUrl.startsWith('https://')?check.metadata.sourceUrl.slice(0,1500):null,
    matchLevel:check?.metadata?.matchLevel||null,
    history:Array.isArray(check?.attemptHistory)?check.attemptHistory.slice(-20):[],
    availableFields:validCheck(book,check)?Object.keys(check.metadata).filter(k=>
      ['description','publisher','imprint','publishedYear','pageCount','language','nurCode','nurCategory',
        'seriesTitle','seriesNumber','coverUrl','tags'].includes(k)&&isPresent(check.metadata[k])):[]}));
  const snapshot={bookId:book.id,identity:keyOf(book),changes,conflicts,statuses};
  return {...snapshot,isbn:isbnOf(book),barcode:book.barcode||'',title:book.title,author:book.author,
    revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
function applyComparison(db,book,revision,failedCovers=new Set(),sources=SOURCE_ORDER,now=new Date()){
  const preview=comparison(db,book,failedCovers,sources);
  if(preview.revision!==revision)return {ok:false,error:'stale_preview'};
  if(!preview.changes.length)return {ok:false,error:'no_changes'};
  for(const change of preview.changes){
    book[change.field]=change.after;
    if(change.field==='coverUrl'){book.localCoverUrl='';book.coverCrop=null;}
    if(!book.importProvenance||typeof book.importProvenance!=='object')book.importProvenance={};
    if(!book.importProvenance.fieldSources)book.importProvenance.fieldSources={};
    book.importProvenance.fieldSources[change.field]={sourceType:'metadata',
      sourceDetail:change.sources.length>1?'multiple_sources':change.source};
    // The durable research retains all agreeing sources and timestamps;
    // do not falsely label a union of keywords as one provider's result.
    for(const source of change.sources){
      const check=getCheck(db,book,source);
      if(!check)continue;
      const copyKey=createHash('sha256').update(String(book.id)).digest('hex');
      const appliedCopies=check.appliedCopies||={};
      appliedCopies[copyKey]=now.toISOString();
    }
  }
  return {ok:true,updated:preview.changes.length,newCover:preview.changes.some(c=>c.field==='coverUrl')};
}
function compareEdition(db,book,failedCovers=new Set(),sources=SOURCE_ORDER){
  return (db.books||[]).filter(b=>b.personalLoanOnly!==true&&workKey(b)===workKey(book)).map(b=>comparison(db,b,failedCovers,sources));
}
module.exports={comparison,applyComparison,compareEdition};
