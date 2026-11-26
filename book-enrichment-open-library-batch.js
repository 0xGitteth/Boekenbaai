'use strict';
// Open Library requests batch lookups rather than hundreds of individual
// ISBN requests for a collection (https://openlibrary.org/developers/api).
// Work-level matches can only supply work-level information.
const {isbnOf,usableFor}=require('./book-free-metadata');
const {getEquivalentIsbns,toIsbn13,normalizeLanguage}=require('./isbn-lookup-core-impl');
const MAX_BATCH=20,MAX_BYTES=2*1024*1024;
const errorAll=(books,status)=>books.map(()=>({status,metadata:null}));
const text=(value,max=300)=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
function list(value,max=30){return Array.isArray(value)?[...new Set(value.map(x=>text(x,100)).filter(Boolean))].slice(0,max):[];}
function parseBatch(data,books){
  if(!Array.isArray(data?.docs))return errorAll(books,'invalid_response');
  const count=data.numFound??data.num_found;
  const complete=data.numFoundExact!==false&&Number.isSafeInteger(count)&&count===data.docs.length;
  return books.map(book=>{
    const isbn=isbnOf(book);
    const matches=[];
    for(const doc of data.docs){
      const isbns=Array.isArray(doc?.isbn)?doc.isbn:[];
      if(!isbn||!isbns.some(i=>toIsbn13(i)===isbn))continue;
      const edition=(Array.isArray(doc.editions?.docs)?doc.editions.docs:[]).find(e=>
        Array.isArray(e.isbn)&&e.isbn.some(i=>toIsbn13(i)===isbn));
      const author=list(doc.author_name,8).join(', ');
      const record={isbn,title:text(edition?.title||doc.title),author,
        tags:list(doc.subject),source:'open_library',matchLevel:'work_isbn',
        sourceUrl:/^(?:\/works\/)?OL\d+W$/.test(doc.key||'')
          ?'https://openlibrary.org/works/'+doc.key.split('/').pop():''};
      if(!author||!usableFor(book,record))continue;
      // Never use aggregated work publisher/year/pages/cover as edition facts.
      // Only use fields returned on a nested edition with explicit ISBN proof.
      if(edition){
        record.matchLevel='exact_isbn';
        record.publisher=list(edition.publisher,4).join(', ');
        const years=Array.isArray(edition.publish_year)?edition.publish_year:[edition.publish_year];
        const validYears=[...new Set(years.filter(n=>Number.isInteger(n)&&n>0&&n<=2100))];
        if(validYears.length===1)record.publishedYear=validYears[0];
        const languages=list(edition.language,5).map(normalizeLanguage).filter(Boolean);
        if(new Set(languages).size===1)record.language=languages[0];
        if(Number.isSafeInteger(edition.cover_i)&&edition.cover_i>0)
          record.coverUrl='https://covers.openlibrary.org/b/id/'+edition.cover_i+'-L.jpg?default=false';
      }
      matches.push(record);
    }
    if(matches.length===1)return {status:'found',metadata:matches[0]};
    if(matches.length>1)return {status:'identity_mismatch',metadata:null};
    if(!complete)return {status:'incomplete_response',metadata:null};
    const hasIdentifier=data.docs.some(doc=>Array.isArray(doc?.isbn)&&doc.isbn.some(i=>toIsbn13(i)===isbn));
    return {status:hasIdentifier?'identity_mismatch':'not_found',metadata:null};
  });
}
async function fetchOpenLibraryBatch(books,{fetchImpl=globalThis.fetch,env=process.env,timeoutMs=12000}={}){
  if(!Array.isArray(books)||!books.length||books.length>MAX_BATCH)return errorAll(books||[],'invalid_batch');
  const isbns=[...new Set(books.flatMap(b=>getEquivalentIsbns(isbnOf(b))))];
  if(!isbns.length)return errorAll(books,'invalid_isbn');
  const url=new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q','isbn:('+isbns.join(' OR ')+')');
  url.searchParams.set('fields','key,title,author_name,isbn,subject,editions,editions.title,editions.isbn,editions.publisher,editions.publish_year,editions.language,editions.cover_i');
  url.searchParams.set('limit','100');
  const contact=String(env.BOEKENBAAI_EASYCB_CONTACT||'').trim();
  const userAgent=String(env.BOEKENBAAI_ISBN_USER_AGENT||'Boekenbaai/1.0 school library')
    +( /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)?' ('+contact+')':'');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url.href,{headers:{Accept:'application/json','User-Agent':userAgent},
      redirect:'error',signal:controller.signal});
    if(response.status===429)return errorAll(books,'rate_limited');
    if(!response.ok)return errorAll(books,'provider_error');
    if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)return errorAll(books,'too_large');
    // Bound streaming payload rather than trusting the Content-Length.
    if(!response.body?.getReader)return errorAll(books,'invalid_response');
    const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,raw='';
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES){await reader.cancel();return errorAll(books,'too_large');}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
    return parseBatch(JSON.parse(raw),books);
  }catch(error){return errorAll(books,error?.name==='AbortError'?'timeout':'error');}
  finally{clearTimeout(timer);}
}
module.exports={fetchOpenLibraryBatch,parseBatch,MAX_BATCH};
