'use strict';
const crypto=require('node:crypto');
const {workKey}=require('./book-reservations');
const {resolveCanonicalEditionIsbn}=require('./book-edition-core');
const {isHidden}=require('./book-catalog-integrity');
const {traitsForBook}=require('./student-choice-dialogue');
const {describe}=require('./student-choice-series');
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const text=(v,max=200)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const strList=(v,max=12)=>Array.isArray(v)?v.filter(x=>typeof x==='string').map(x=>text(x,160)).filter(Boolean).slice(0,max):[];
const cleanIsbn=v=>String(v||'').replace(/[-\s]/g,'').toUpperCase();
function validIsbn(v){
 const s=cleanIsbn(v);
 if(/^\d{13}$/.test(s))return [...s].reduce((n,x,i)=>n+Number(x)*(i%2?3:1),0)%10===0;
 if(/^\d{9}[\dX]$/.test(s))return [...s].reduce((n,x,i)=>n+(x==='X'?10:Number(x))*(10-i),0)%11===0;
 return false;
}
function isbn13(v){
 const s=cleanIsbn(v);
 if(!validIsbn(s))return '';
 if(s.length===13)return s;
 const p='978'+s.slice(0,9);
 return p+((10-[...p].reduce((n,x,i)=>n+Number(x)*(i%2?3:1),0)%10)%10);
}
function cleanQuery(raw){
 const title=text(raw?.title,120),author=text(raw?.author,90);
 const isbn=isbn13(raw?.isbn||title);
 if(isbn)return {title:'',author:'',isbn};
 // No URLs, contacts, opaque IDs or prose are forwarded by the lookup.
 if(title.length<2||/https?:|www\.|@|\b\d{6,}\b/i.test(title+' '+author))return null;
 if(!/^[\p{L}\p{N}\s.,:'’‘“”"!?&()+\-–—/]+$/u.test(title+' '+author))return null;
 return {title,author,isbn:''};
}
const visible=b=>b?.id&&b.title&&!isHidden(b)&&b.personalLoanOnly!==true;
function localScore(book,q){
 if(q.isbn)return resolveCanonicalEditionIsbn(book)===q.isbn?100:0;
 const title=norm(book.title),query=norm(q.title);
 if(q.author&&!norm(book.author).includes(norm(q.author)))return 0;
 if(title===query)return 100;
 if(title.startsWith(query+' '))return 65;
 if(query.length>=5&&(' '+title+' ').includes(' '+query+' '))return 50;
 const words=query.split(' ').filter(w=>w.length>=3);
 return words.length>=2&&words.every(w=>title.split(' ').includes(w))?35:0;
}
function localMatches(db,q){
 const best=new Map();
 for(const b of db.books||[]){
  if(!visible(b))continue;
  const score=localScore(b,q);
  if(!score)continue;
  const key=workKey(b),existing=best.get(key);
  if(!existing||score>existing.score)best.set(key,{book:b,score});
 }
 return [...best.values()].sort((a,b)=>b.score-a.score||String(a.book.title).localeCompare(String(b.book.title),'nl')).slice(0,8)
  .map(({book})=>({bookId:book.id,title:text(book.title),author:text(book.author),source:'Schoolbibliotheek',series:describe(book)}));
}
// These short-lived caches contain bibliographic data, never pupil identity,
// answer text, reading history, or authentication tokens.
const TTL=30*60*1000,MAX_CACHE=200,MAX_REFS=1000;
const cache=new Map(),refs=new Map(),inflight=new Map();
let lastOpenLibrary=0,requestTimes=[],active=0;
function trim(map,max,now){
 for(const [k,v] of map)if(v.expiresAt<=now)map.delete(k);
 while(map.size>=max)map.delete(map.keys().next().value);
}
function storeReference(row,now=Date.now()){
 trim(refs,MAX_REFS,now);
 const token=crypto.randomBytes(24).toString('base64url');
 refs.set(token,{row,expiresAt:now+TTL});
 return token;
}
function getReference(token,now=Date.now()){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token))return null;
 const entry=refs.get(token);
 if(!entry||entry.expiresAt<=now){refs.delete(token);return null;}
 return entry.row;
}
function project(row){
 return {externalRef:storeReference(row),title:row.title,author:row.author,source:row.source,
  year:row.year||null,series:describe(row)};
}
function googleRows(body){
 return (Array.isArray(body?.items)?body.items:[]).slice(0,12).flatMap(x=>{
  const v=x?.volumeInfo;if(!v)return [];
  const title=text(v.title),author=strList(v.authors,3).join(', ');
  if(!title||!author)return [];
  return [{title,author,description:text(v.description,2400),tags:strList(v.categories),
   isbn:(Array.isArray(v.industryIdentifiers)?v.industryIdentifiers:[]).map(z=>isbn13(z?.identifier)).find(Boolean)||'',
   year:Number(String(v.publishedDate||'').slice(0,4))||null,source:'Google Books'}];
 });
}
function openRows(body){
 return (Array.isArray(body?.docs)?body.docs:[]).slice(0,12).flatMap(v=>{
  const title=text(v?.title),author=strList(v?.author_name,3).join(', ');
  if(!title||!author)return [];
  return [{title,author,description:'',tags:strList(v.subject,18),
   isbn:strList(v.isbn,50).map(isbn13).find(Boolean)||'',isbns:strList(v.isbn,50).map(isbn13).filter(Boolean),year:Number(v.first_publish_year)||null,source:'Open Library'}];
 });
}
async function boundedJson(url,headers,fetchImpl){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3200);
 try{
  const response=await fetchImpl(url.toString(),{headers:{Accept:'application/json',...headers},signal:controller.signal,redirect:'error'});
  if(!response?.ok)return null;
  if(Number(response.headers?.get?.('content-length')||0)>750000)return null;
  if(response.body?.getReader){
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{
    while(true){
     const {done,value}=await reader.read();if(done)break;
     size+=value.byteLength;if(size>750000){await reader.cancel();return null;}
     chunks.push(Buffer.from(value));
    }
   }finally{reader.releaseLock?.();}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return typeof response.json==='function'?await response.json():null;
 }catch(_){return null;}finally{clearTimeout(timer);}
}
function relevant(row,q){
 if(q.isbn)return row.isbn===q.isbn||row.isbns?.includes(q.isbn);
 const n=norm(row.title),t=norm(q.title);
 if(q.author&&!norm(row.author).includes(norm(q.author)))return false;
 const words=t.split(' ').filter(Boolean);
 return n===t||n.startsWith(t+' ')||words.length>=2&&words.every(w=>n.split(' ').includes(w));
}
async function queryProviders(q,{fetchImpl=global.fetch,env=process.env,now=Date.now}={}){
 const stamp=now(),key=JSON.stringify([q.isbn,norm(q.title),norm(q.author)]);
 const cached=cache.get(key);
 if(cached?.expiresAt>stamp)return cached.value;
 if(inflight.has(key))return inflight.get(key);
 requestTimes=requestTimes.filter(t=>t>stamp-60000);
 if(active>=3||requestTimes.length>=15)return {rows:[],status:'busy'};
 requestTimes.push(stamp);active++;
 const promise=(async()=>{
  let rows=[],succeeded=false;
  if(env.GOOGLE_BOOKS_API_KEY){
   const url=new URL('https://www.googleapis.com/books/v1/volumes');
   url.searchParams.set('q',q.isbn?'isbn:'+q.isbn:'intitle:'+q.title+(q.author?' inauthor:'+q.author:''));
   url.searchParams.set('maxResults','12');
   const data=await boundedJson(url,{'x-goog-api-key':env.GOOGLE_BOOKS_API_KEY},fetchImpl);
   if(data){succeeded=true;rows.push(...googleRows(data));}
  }
  // Do not bypass Open Library's anonymous 1 request/second limit.
  const t=now();
  if(t-lastOpenLibrary>=1100){
   lastOpenLibrary=t;
   const url=new URL('https://openlibrary.org/search.json');
   if(q.isbn)url.searchParams.set('isbn',q.isbn);else{
    url.searchParams.set('title',q.title);if(q.author)url.searchParams.set('author',q.author);
   }
   url.searchParams.set('limit','10');
   url.searchParams.set('fields','title,author_name,first_publish_year,isbn,subject');
   const data=await boundedJson(url,{},fetchImpl);
   if(data){succeeded=true;rows.push(...openRows(data));}
  }
  const unique=new Map();
  for(const row of rows.filter(r=>relevant(r,q))){
   const k=workKey(row);if(!unique.has(k))unique.set(k,row);
  }
  const out={rows:[...unique.values()].slice(0,8),status:succeeded?'ok':'unavailable'};
  if(succeeded){trim(cache,MAX_CACHE,now());cache.set(key,{value:out,expiresAt:now()+TTL});}
  return out;
 })();
 inflight.set(key,promise);
 try{return await promise;}finally{active--;inflight.delete(key);}
}
async function lookup(db,raw,{external=false,...deps}={}){
 const q=cleanQuery(raw);
 if(!q)return {status:'invalid',matches:[]};
 const local=localMatches(db,q);
 if(local.length&&!external)return {status:'ok',matches:local,external:false};
 if(!external)return {status:'not_found',matches:[],external:false};
 const remote=await queryProviders(q,deps);
 const localKeys=new Set(local.map(b=>workKey(b)));
 const outside=remote.rows.filter(r=>!localKeys.has(workKey(r))).map(project);
 return {status:remote.status,matches:[...local,...outside].slice(0,12),external:true};
}
function referenceTraits(token){
 const row=getReference(token);if(!row)return new Map();
 return traitsForBook(row);
}
module.exports={lookup,cleanQuery,localMatches,validIsbn,isbn13,getReference,referenceTraits,googleRows,openRows};
