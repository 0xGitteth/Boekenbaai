'use strict';
// Anonymous moderation is short-lived, contains no account IDs or raw text,
// and never writes to the school database.
const crypto=require('node:crypto');
const moderation=require('./student-choice-moderation');
const PAUSE_MS=300000,IDLE_MS=1200000,MAX_SESSIONS=3000;
const sessions=new Map();
function open(token,now=Date.now()){
 for(const [key,row] of sessions)if(row.expiresAt<=now)sessions.delete(key);
 let row=typeof token==='string'?sessions.get(token):null;
 if(!row){
  if(sessions.size>=MAX_SESSIONS)throw Object.assign(Error('De keuzehulp is tijdelijk druk. Probeer later opnieuw.'),{status:429});
  token=crypto.randomBytes(24).toString('base64url');
  row={records:[],blockedUntil:0,expiresAt:now+IDLE_MS};
  sessions.set(token,row);
 }
 if(row.blockedUntil&&row.blockedUntil<=now){row.records=[];row.blockedUntil=0;}
 row.expiresAt=now+IDLE_MS;
 return {token,row};
}
function check(row,now=Date.now()){
 if(row.blockedUntil>now)throw Object.assign(Error('Dit anonieme gesprek is gestopt. Over vijf minuten kun je weer zonder inloggen beginnen. Je kunt ook inloggen met je eigen PIN.'),{status:423,code:'CHOICE_GUEST_PAUSED'});
}
function status(row){check(row);return {warned:moderation.state({studentChoiceModeration:row.records},'guest').warned,guest:true};}
function apply(row,text,books,now=Date.now()){
 check(row,now);
 const local={books,studentChoiceModeration:row.records};
 const result=moderation.apply(local,'guest',text,new Date(now).toISOString());
 row.records=local.studentChoiceModeration;
 if(result.kind==='blocked'){row.blockedUntil=now+PAUSE_MS;check(row,now);}
 return result;
}
module.exports={open,check,status,apply,PAUSE_MS,IDLE_MS};
