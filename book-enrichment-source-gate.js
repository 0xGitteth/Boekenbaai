'use strict';

// Trial and future collection worker share the same conservative provider gate.
// Counts are in ISBN lookups, not individual HTTP requests. A provider's 429
// pauses that provider only; no paid search or automatic retry is authorized.
const {SOURCE_ORDER}=require('./book-enrichment-sources');
const LIMITS={boekenbase:5,bureau_isbn:3,easycb:5,google_books:5,open_library:3,isbnbarcode:3};
function createSourceGate({now=Date.now,limits=LIMITS,windowMs=60000}={}){
  const states=new Map();
  let active=false;
  function claim(source){
    if(!SOURCE_ORDER.includes(source))return {ok:false,status:'invalid_source'};
    const limit=limits[source];
    if(!Number.isInteger(limit)||limit<1)return {ok:false,status:'not_configured'};
    if(active)return {ok:false,status:'busy'};
    const time=now();
    const state=states.get(source)||{times:[],retryAt:0};
    states.set(source,state);
    state.times=state.times.filter(t=>t>time-windowMs);
    const retryAt=Math.max(state.retryAt,state.times.length>=limit?state.times[0]+windowMs:0);
    if(retryAt>time)return {ok:false,status:'cooldown',retryAt};
    active=true;state.times.push(time);
    let released=false;
    return {ok:true,finish(status){
      if(released)return;
      released=true;
      if(status==='rate_limited')state.retryAt=Math.max(state.retryAt,now()+windowMs);
      active=false;
    }};
  }
  return {claim};
}
module.exports={createSourceGate,LIMITS};
