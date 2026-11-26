'use strict';

const {
  claimNext,finishClaim,claimIsCurrent,bookWorks,needsExtra,
}=require('./book-brave-core');
const {workKey,isbnOf}=require('./book-free-metadata');
const {isValidIsbn,toIsbn13}=require('./isbn-lookup-core-impl');
const {fetchBrave,discoverPages,selectImageResult}=require('./book-brave-fetch');

function addProvenance(book,field,source){
  if(!book.importProvenance||typeof book.importProvenance!=='object')
    book.importProvenance={fieldSources:{}};
  if(!book.importProvenance.fieldSources)book.importProvenance.fieldSources={};
  book.importProvenance.fieldSources[field]={sourceType:'metadata',sourceDetail:source};
}
function userEdited(book,field){
  const source=book.importProvenance?.fieldSources?.[field]?.sourceType;
  // An intentionally cleared value is protected only if a teacher explicitly
  // cleared it. Imported "unknown" and absent/legacy values can be enriched
  // when empty, but populated non-metadata values must never be replaced.
  if(source==='manual')return true;
  const value=book[field];
  const populated=Array.isArray(value)?value.length>0
    : field==='pageCount' ? Number(value)>0
      : value!==null&&value!==undefined&&String(value).trim()!=='';
  return populated && source!=='metadata';
}
function updateFromPages(db,claim,pages,{imageUrl='',failedCovers=new Set()}={}) {
  let added=0,newCover=false;
  const evidenceByBook=Object.create(null);
  const approvedIds=new Set(Array.isArray(claim.bookIds)?claim.bookIds:[]);
  for(const book of db.books||[]){
    if(!approvedIds.has(book.id)||workKey(book)!==claim.key)continue;
    const isbn=isbnOf(book);
    const evidence=[];
    evidenceByBook[book.id]=evidence;
    const remember=(field,page)=>{
      if(typeof page.sourceUrl==='string'&&page.sourceUrl.startsWith('https://'))
        evidence.push({field,url:page.sourceUrl,confidence:page.confidence});
    };
    for(const page of pages||[]){
      if(!page||!['isbn','title_author'].includes(page.confidence))continue;
      const exactEdition=Boolean(isbn&&page.confidence==='isbn'&&isValidIsbn(page.isbn)&&toIsbn13(page.isbn)===isbn);
      if(!userEdited(book,'description') && page.description?.length>=90
        && String(book.description||'').length<280
        && page.description.length>String(book.description||'').length+40){
        book.description=page.description;addProvenance(book,'description','verified_book_page');remember('description',page);added++;
      }
      if(exactEdition&&!userEdited(book,'publisher')&&!book.publisher&&page.publisher){
        book.publisher=page.publisher;addProvenance(book,'publisher','verified_book_page');remember('publisher',page);added++;
      }
      if(exactEdition&&!userEdited(book,'pageCount')&&!book.pageCount&&page.pageCount){
        book.pageCount=page.pageCount;addProvenance(book,'pageCount','verified_book_page');remember('pageCount',page);added++;
      }
      // Keep source keywords separate from teacher/import labels, as EasyCB does.
      if(book.themesCleared!==true && book.importProvenance?.fieldSources?.enrichmentTags?.sourceType!=='manual' && Array.isArray(page.tags)&&page.tags.length){
        const current=Array.isArray(book.enrichmentTags)?book.enrichmentTags:[];
        const merged=new Map(current.filter(t=>typeof t==='string'&&t.trim())
          .map(t=>[t.trim().toLocaleLowerCase('nl-NL'),t.trim()]));
        for(const tag of page.tags){
          if(typeof tag!=='string'||!tag.trim()||merged.size>=30)continue;
          const key=tag.trim().toLocaleLowerCase('nl-NL');
          if(!merged.has(key))merged.set(key,tag.trim());
        }
        const fresh=[...merged.values()];
        if(JSON.stringify(current)!==JSON.stringify(fresh)){
          book.enrichmentTags=fresh;
          addProvenance(book,'enrichmentTags','verified_book_page');remember('enrichmentTags',page);added++;
        }
      }
      if(book.themesCleared!==true&&!userEdited(book,'tags')&&Array.isArray(page.tags)&&page.tags.length){
        const current=Array.isArray(book.tags)?book.tags:[];
        const values=new Set(current.map(t=>String(t).toLocaleLowerCase('nl-NL')));
        const merged=[...current];
        for(const t of page.tags){
          if(merged.length>=25)break;
          const key=String(t).toLocaleLowerCase('nl-NL');
          if(!values.has(key)){values.add(key);merged.push(t);}
        }
        if(merged.length>current.length){
          book.tags=merged;addProvenance(book,'tags','verified_book_page');remember('tags',page);added++;
        }
      }
      const failed=failedCovers.has(book.coverUrl)&&!book.localCoverUrl;
      if(exactEdition&&!book.localCoverUrl&&!userEdited(book,'coverUrl')&&page.coverUrl
        &&(!book.coverUrl||failed)&&book.coverUrl!==page.coverUrl){
        book.coverUrl=page.coverUrl;
        book.localCoverUrl='';book.coverCrop=null;addProvenance(book,'coverUrl','verified_book_page');remember('coverUrl',page);
        newCover=true;added++;
      }
    }
    const failed=failedCovers.has(book.coverUrl)&&!book.localCoverUrl;
    if(!isbn&&imageUrl&&!book.localCoverUrl&&!userEdited(book,'coverUrl')&&(!book.coverUrl||failed)
      &&book.coverUrl!==imageUrl){
      book.coverUrl=imageUrl;book.localCoverUrl='';book.coverCrop=null;
      addProvenance(book,'coverUrl','verified_book_image');
      newCover=true;added++;
    }
  }
  return {added,newCover,evidenceByBook};
}
function createBraveWorker({
  loadDb,commit,apiKey='',onNewCover=()=>{},isPaused=()=>false,
  getFailedCovers=()=>new Set(),fetchSearch=fetchBrave,
  findPages=discoverPages,logger=console,delayMs=1800,
}={}) {
  let timer=null,running=false,stopped=false;
  const configured=Boolean(typeof apiKey==='string'&&apiKey.trim());
  function schedule(delay=250){
    if(!configured||stopped||running||timer)return;
    timer=setTimeout(()=>{timer=null;void processOne();},Math.max(50,delay));
    timer.unref?.();
  }
  async function processOne(){
    if(stopped||running||!configured)return;
    if(isPaused()){schedule(4000);return;}
    running=true;
    let keepGoing=false;
    let retryDelay=0;
    try {
      // Atomic, durable debit/reservation occurs before each external API
      // call and is never refunded on an error or process crash.
      const claim=await commit(db=>isPaused()
        ? {deferred:true} : claimNext(db,{failedCovers:getFailedCovers()}));
      if(claim?.deferred){
        // An import began after our initial pause check but before the
        // atomic claim. Do not debit an API call during import preparation.
        keepGoing=true;
        retryDelay=4000;
        return;
      }
      if(!claim)return;
      keepGoing=true;
      const result=await fetchSearch(claim.step,claim,{apiKey});
      let pages=[],imageUrl='',sourceError=null;
      const onFailure=()=>{sourceError='source_unavailable';};
      if(!result.error&&!stopped){
        if(claim.step===1){
          imageUrl=claim.isbn?'':selectImageResult(result.images,claim);
          if(!imageUrl){
            // Many image results identify only the title. Verify their
            // ORIGINAL publisher/book pages before accepting an image.
            // Browsing the page does not consume another Brave API request.
            const candidates=(result.images||[]).slice(0,8)
              .filter(x=>x.pageUrl&&x.title)
              .map(x=>({title:x.title,url:x.pageUrl}));
            pages=await findPages({pages:candidates},claim,{maxPages:2,onFailure});
          }
        }else{
          pages=await findPages(result,claim,{maxPages:3,onFailure});
        }
      }
      if(stopped)return;
      const bad=result.error||sourceError||null;
      let outcome=null;
      // A legacy import can start during Brave's network request. Do not
      // modify ANY database fields (including progress/usage) until that
      // import has committed or cancelled. Recheck under the DB lock to
      // avoid a race between the pause check and the actual commit.
      while(!stopped){
        if(isPaused()){
          await new Promise(resolve=>setTimeout(resolve,200));
          continue;
        }
        outcome=await commit(db=>{
          if(isPaused())return {deferred:true};
          if(!claimIsCurrent(db,claim))return {stale:true};
          const updated=updateFromPages(db,claim,pages,{
            imageUrl,failedCovers:getFailedCovers(),
          });
          finishClaim(db,claim,{
            providerRemaining:result.providerRemaining,
            providerRemainingConfirmed:Number.isSafeInteger(result.providerRemaining),
            error:bad,status:updated.added>0?'found':'no_result',added:updated.added,
            evidenceByBook:updated.evidenceByBook,
          });
          return updated;
        });
        if(!outcome?.deferred)break;
      }
      if(stopped)return;
      if(outcome?.newCover)onNewCover();
      // Any provider/search error pauses this job. No later step is issued
      // automatically until an administrator reviews the status and approves.
      if(bad)keepGoing=false;
    }catch(error) {
      logger.warn?.('Brave-verrijking onderbroken:',error?.message||String(error));
      // A database failure must not depend on a browser being open.
      // The claimed request remains recorded and cannot be billed twice.
      keepGoing=true;
      retryDelay=30000;
    }finally{
      running=false;
      if(!stopped&&keepGoing)schedule(retryDelay||delayMs);
    }
  }
  return {
    configured,schedule,
    stop(){stopped=true;if(timer)clearTimeout(timer);timer=null;},
  };
}
module.exports={createBraveWorker,updateFromPages};
