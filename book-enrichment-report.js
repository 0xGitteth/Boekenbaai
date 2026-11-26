'use strict';
const {isbnOf,workKey}=require('./book-free-metadata');
const {comparison}=require('./book-enrichment-comparison');
const {descriptionCorpus}=require('./book-enrichment-content');
const {traitsForBook}=require('./student-choice-dialogue');
const {SOURCE_ORDER}=require('./book-enrichment-sources');
const terminal=new Set(['found','not_found','identity_mismatch']);
const normalize=v=>String(v||'').normalize('NFKC').toLocaleLowerCase('nl-NL').trim();
function missingFields(book,failedCovers,hasLocalCover){
  const missing=[];
  const local=Boolean(book.localCoverUrl&&hasLocalCover(book.localCoverUrl));
  if(!local&&(!book.coverUrl||failedCovers.has(book.coverUrl)))missing.push('coverUrl');
  if(!String(book.description||'').trim())missing.push('description');
  if(!String(book.publisher||'').trim())missing.push('publisher');
  if(!Number.isInteger(book.publishedYear)||book.publishedYear<1)missing.push('publishedYear');
  if(!Number.isInteger(book.pageCount)||book.pageCount<1)missing.push('pageCount');
  if(!String(book.language||'').trim())missing.push('language');
  return missing;
}
function braveEvidence(db,book){
  const key=JSON.stringify([book.id,workKey(book)]);
  const steps=db.bookEnrichmentChecks?.[key]?.brave||{};
  return Object.entries(steps).filter(([step])=>['0','1','2'].includes(step)).map(([step,check])=>({
    step:Number(step),status:check.status,checkedAt:check.checkedAt,error:check.error||null,
    evidence:Array.isArray(check.evidence)?check.evidence.slice(-60):[],
  }));
}
function report(db,{query='',filter='all',page=1,limit=20,enabledSources=SOURCE_ORDER,
  failedCovers=new Set(),hasLocalCover=()=>true}={}){
  const rows=[],counts={all:0,unresearched:0,partial:0,complete:0,conflicts:0,pending:0,no_isbn:0};
  const groups=new Map();
  for(const book of db.books||[]){
    if(!book?.id||!book.title||book.personalLoanOnly===true)continue;
    const key=workKey(book);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(book);
  }
  for(const copies of groups.values()){
    const book=copies[0],isbn=isbnOf(book),views=copies.map(b=>comparison(db,b,failedCovers));
    const sources=views[0].statuses.filter(s=>enabledSources.includes(s.source));
    const missing=[...new Set(copies.flatMap(b=>missingFields(b,failedCovers,hasLocalCover)))];
    const pending=views.reduce((n,v)=>n+v.changes.length,0);
    const conflicts=views.reduce((n,v)=>n+v.conflicts.length,0);
    const hasBrave=copies.some(b=>braveEvidence(db,b).length);
    const checked=sources.filter(s=>terminal.has(s.status)).length;
    const attempted=sources.filter(s=>s.status!=='not_checked').length;
    const traits=new Map();
    for(const copy of copies)for(const [trait,strength] of traitsForBook(copy))
      traits.set(trait,Math.max(strength,traits.get(trait)||0));
    const content={strong:[...traits].filter(([,v])=>v>=3).length,
      textual:[...traits].filter(([,v])=>v>0&&v<3).length,
      descriptionChars:Math.max(...copies.map(b=>descriptionCorpus(b).length))};
    const status=!attempted&&!hasBrave?'unresearched':!missing.length&&!conflicts&&checked===sources.length
      &&(content.strong+content.textual>0)?'complete':'partial';
    const row={id:book.id,title:book.title,author:book.author,isbn,copies:copies.length,status,
      missing,pending,conflicts,checked,sourceCount:sources.length,content,
      localCovers:copies.filter(b=>b.localCoverUrl&&hasLocalCover(b.localCoverUrl)).length,
      sourceStatuses:sources.map(s=>({source:s.source,status:s.status,lastError:s.lastError,checkedAt:s.checkedAt})),
      braveChecked:copies.reduce((n,b)=>n+braveEvidence(db,b).length,0)};
    rows.push(row);counts.all++;counts[status]++;
    if(!isbn)counts.no_isbn++;
    if(conflicts)counts.conflicts++;
    if(pending)counts.pending++;
  }
  const q=normalize(query).slice(0,200);
  const selected=rows.filter(row=>{
    if(q&&!normalize([row.title,row.author,row.isbn].join(' ')).includes(q))return false;
    if(filter==='conflicts')return row.conflicts>0;
    if(filter==='pending')return row.pending>0;
    if(filter==='no_isbn')return !row.isbn;
    return filter==='all'||row.status===filter;
  }).sort((a,b)=>a.title.localeCompare(b.title,'nl')||a.isbn.localeCompare(b.isbn));
  const size=Math.max(1,Math.min(50,Number.isSafeInteger(limit)?limit:20));
  const pages=Math.max(1,Math.ceil(selected.length/size));
  const current=Math.max(1,Math.min(pages,Number.isSafeInteger(page)?page:1));
  return {counts,total:selected.length,page:current,pages,rows:selected.slice((current-1)*size,current*size)};
}
function details(db,id,{failedCovers=new Set()}={}){
  const book=(db.books||[]).find(b=>b.id===id&&b.personalLoanOnly!==true);
  if(!book)return null;
  return (db.books||[]).filter(b=>b.personalLoanOnly!==true&&workKey(b)===workKey(book)).map(b=>({
    ...comparison(db,b,failedCovers),brave:braveEvidence(db,b),
  }));
}
module.exports={report,details,missingFields,braveEvidence};
