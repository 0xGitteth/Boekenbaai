'use strict';

const {
  claimNext,finishClaim,bookWorks,needsExtra,
}=require('./book-brave-core');
const {workKey}=require('./book-free-metadata');
const {fetchBrave,discoverPages,selectImageResult}=require('./book-brave-fetch');

function addProvenance(book,field,source){
  if(!book.importProvenance||typeof book.importProvenance!=='object')
    book.importProvenance={fieldSources:{}};
  if(!book.importProvenance.fieldSources)book.importProvenance.fieldSources={};
  book.importProvenance.fieldSources[field]={sourceType:'metadata',sourceDetail:source};
}
function userEdited(book,field){
  return ['manual','excel','existing'].includes(
    book.importProvenance?.fieldSources?.[field]?.sourceType);
}
function updateFromPages(db,claim,pages,{imageUrl='',failedCovers=new Set()}={}) {
  let added=0,newCover=false;
  for(const book of db.books||[]){
    if(workKey(book)!==claim.key)continue;
    for(const page of pages||[]){
      if(!page||!['isbn','title_author'].includes(page.confidence))continue;
      if(!userEdited(book,'description') && page.description?.length>=90
        && String(book.description||'').length<280
        && page.description.length>String(book.description||'').length+40){
        book.description=page.description;addProvenance(book,'description','verified_book_page');added++;
      }
      if(!userEdited(book,'publisher')&&!book.publisher&&page.publisher){
        book.publisher=page.publisher;addProvenance(book,'publisher','verified_book_page');added++;
      }
      if(!userEdited(book,'pageCount')&&!book.pageCount&&page.pageCount){
        book.pageCount=page.pageCount;addProvenance(book,'pageCount','verified_book_page');added++;
      }
      if(!userEdited(book,'tags')&&Array.isArray(page.tags)&&page.tags.length){
        const current=Array.isArray(book.tags)?book.tags:[];
        const values=new Set(current.map(t=>String(t).toLocaleLowerCase('nl-NL')));
        const merged=[...current];
        for(const t of page.tags){
          if(merged.length>=25)break;
          const key=String(t).toLocaleLowerCase('nl-NL');
          if(!values.has(key)){values.add(key);merged.push(t);}
        }
        if(merged.length>current.length){
          book.tags=merged;addProvenance(book,'tags','verified_book_page');added++;
        }
      }
      const failed=failedCovers.has(book.coverUrl)&&!book.localCoverUrl;
      if(!userEdited(book,'coverUrl')&&page.coverUrl
        &&(!book.coverUrl||failed)&&book.coverUrl!==page.coverUrl){
        book.coverUrl=page.coverUrl;
        book.localCoverUrl='';addProvenance(book,'coverUrl','verified_book_page');
        newCover=true;added++;
      }
    }
    const failed=failedCovers.has(book.coverUrl)&&!book.localCoverUrl;
    if(imageUrl&&!userEdited(book,'coverUrl')&&(!book.coverUrl||failed)
      &&book.coverUrl!==imageUrl){
      book.coverUrl=imageUrl;book.localCoverUrl='';
      addProvenance(book,'coverUrl','verified_book_image');
      newCover=true;added++;
    }
  }
  return {added,newCover};
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
      const claim=await commit(db=>claimNext(db,{failedCovers:getFailedCovers()}));
      if(!claim)return;
      keepGoing=true;
      const result=await fetchSearch(claim.step,claim,{apiKey});
      let pages=[],imageUrl='';
      if(!result.error&&!stopped){
        if(claim.step===1){
          imageUrl=selectImageResult(result.images,claim);
          if(!imageUrl){
            // Many image results identify only the title. Verify their
            // ORIGINAL publisher/book pages before accepting an image.
            // Browsing the page does not consume another Brave API request.
            const candidates=(result.images||[]).slice(0,8)
              .filter(x=>x.pageUrl&&x.title)
              .map(x=>({title:x.title,url:x.pageUrl}));
            pages=await findPages({pages:candidates},claim,{maxPages:2});
          }
        }else{
          pages=await findPages(result,claim,{maxPages:3});
        }
      }
      if(stopped)return;
      const bad=result.error||null;
      const outcome=await commit(db=>{
        const updated=updateFromPages(db,claim,pages,{
          imageUrl,failedCovers:getFailedCovers(),
        });
        finishClaim(db,claim,{providerRemaining:result.providerRemaining,error:bad});
        return updated;
      });
      if(outcome?.newCover)onNewCover();
      // Stop after 429, missing entitlement or paid quota. No silent
      // repeated retries and no new approval without an explicit action.
      if(['rate_limited','unauthorized','payment_required'].includes(bad))
        keepGoing=false;
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
