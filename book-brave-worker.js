'use strict';

const {
  claimNext,finishClaim,claimIsCurrent,bookWorks,needsExtra,
}=require('./book-brave-core');
const {fetchBrave,discoverPages,selectImageResult}=require('./book-brave-fetch');

const {updateFromPages}=require('./book-brave-page-apply');
const {storeTrialResult,projectTrial,preview}=require('./book-brave-trial');

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
          const failedCovers=getFailedCovers();
          let updated;
          if(claim.source==='trial'){
            const job=db.braveEnrichmentJobs.find(j=>j.id===claim.id);
            const books=bookWorks(db,job).get(claim.key)||[];
            storeTrialResult(job,claim,pages,imageUrl);
            const projected=projectTrial(db,job,books,failedCovers);
            updated={added:books.reduce((n,b)=>n+(preview(db,job,b,failedCovers)?.changes.length||0),0),
              newCover:false,evidenceByBook:projected.evidenceByBook};
          }else updated=updateFromPages(db,claim,pages,{imageUrl,failedCovers});
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
