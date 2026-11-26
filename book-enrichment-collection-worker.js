'use strict';
const {chooseTask,finishTask,deferClaim}=require('./book-enrichment-collection');
const {fetchOpenLibraryBatch,MAX_BATCH}=require('./book-enrichment-open-library-batch');
function createCollectionWorker({loadDb,commit,sources,gate,isPaused=()=>false,probeOpenLibraryBatch=fetchOpenLibraryBatch,
  logger=console,delayMs=1500}={}){
  let running=false,stopped=false,timer=null;
  const blocked=new Map();
  function schedule(delay=100){
    if(stopped||running||timer)return;
    timer=setTimeout(()=>{timer=null;void tick();},Math.max(50,delay));
    timer.unref?.();
  }
  async function tick(){
    if(stopped||running)return;
    if(loadDb().freeEnrichmentRun?.state!=='running')return;
    if(isPaused()){schedule(4000);return;}
    running=true;
    let next=delayMs;
    try{
      for(const [source,until] of blocked)if(until<=Date.now())blocked.delete(source);
      const claim=await commit(db=>isPaused()?{wait:true}:chooseTask(db,{blocked:new Set(blocked.keys()),openLibraryBatchSize:MAX_BATCH}));
      if(claim?.wait){next=3000;return;}
      if(!claim)return;
      const permit=gate.claim(claim.source);
      if(!permit.ok){
        if(permit.retryAt)blocked.set(claim.source,permit.retryAt);
        await commit(db=>deferClaim(db,claim));
        next=permit.retryAt?delayMs:3000;
        return;
      }
      let result={status:'error',metadata:null};
      try{result=claim.source==='open_library'?await probeOpenLibraryBatch(claim.books):await sources.probe(claim.source,claim.book);}
      catch(error){logger.warn?.('Gratis bronopvraag mislukt:',error?.message);}
      finally{permit.finish(Array.isArray(result)?result.some(r=>r.status==='rate_limited')?'rate_limited':'finished':result.status);}
      // Retain a completed response while an import is active, then commit
      // under the lock. A lost lease must never overwrite a newer attempt.
      while(!stopped){
        if(isPaused()){await new Promise(resolve=>setTimeout(resolve,250));continue;}
        const saved=await commit(db=>isPaused()?{deferred:true}:finishTask(db,claim,result));
        if(!saved?.deferred)break;
      }
    }catch(error){logger.warn?.('Collectieonderzoek onderbroken:',error?.message);next=30000;}
    finally{
      running=false;
      if(!stopped&&loadDb().freeEnrichmentRun?.state==='running')schedule(next);
    }
  }
  return {schedule,stop(){stopped=true;if(timer)clearTimeout(timer);timer=null;}};
}
module.exports={createCollectionWorker};
