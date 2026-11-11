'use strict';
// A recommendation grant is NOT a login. The only accepted action is
// to request ranked public catalogue titles, never a loan or reading history.
const crypto=require('node:crypto');
const path=require('node:path');
const core=require('./google-auth-core');
const security=require('./google-auth-security-core');
const pins=require('./student-pin-core');
const {readJsonSnapshot,mutateJsonLockedAsync}=require('./database-write-coordinator');
const {rankBooks}=require('./student-choice-recommendations');
const DATA_PATH=process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname,process.env.BOEKENBAAI_DATA_PATH) : path.join(__dirname,'data','db.json');
const AUTH_PATH=process.env.BOEKENBAAI_AUTH_DATA_PATH
  ? path.resolve(__dirname,process.env.BOEKENBAAI_AUTH_DATA_PATH) : DATA_PATH+'.auth.json';
const SECRET=pins.configuredSecret();
const TTL=10*60*1000;
const MAX_TRIES=5,WINDOW=15*60*1000;
const error=(message,status=401)=>Object.assign(new Error(message),{status});
function loadDb(){return readJsonSnapshot(DATA_PATH);}
function loadAuth(){return core.pruneStore(core.normalizeStore(readJsonSnapshot(AUTH_PATH,{missingValue:core.emptyAuthStore()})));}
const active=(db,id)=>(db.students||[]).find(x=>x?.id===id&&x.active!==false&&x.status!=='inactive');
function usable(db,auth,studentId){
  const student=active(db,studentId);
  const link=core.findLinkByAccount(auth,'student',studentId);
  const cred=pins.credentialFor(auth,studentId);
  return student&&link?.sub&&link?.email&&cred?.hash&&cred?.salt&&cred.linkedSub===link.sub
    ? {student,link,cred}:null;
}
function firstName(student){
  const value=String(student?.firstName||student?.name||'').normalize('NFKC').trim();
  return value.split(/\s+/)[0].slice(0,60);
}
function rateRecord(auth,studentId,now){
  if(!Array.isArray(auth.pinAttemptLimits))auth.pinAttemptLimits=[];
  let row=auth.pinAttemptLimits.find(x=>x.studentId===studentId);
  if(!row){row={studentId,attempts:[],blockedUntil:0,updatedAt:now};auth.pinAttemptLimits.push(row);}
  row.attempts=(Array.isArray(row.attempts)?row.attempts:[])
    .filter(time=>Number.isFinite(time)&&time>now-WINDOW);
  return row;
}
async function startChoice({studentId,pin}){
  if(!SECRET)throw error('PIN-controle is niet ingesteld.',503);
  if(typeof studentId!=='string'||!/^[\w-]{1,100}$/.test(studentId)||!pins.validPin(pin))
    throw error('Controleer je naam en PIN. Je kunt ook met Google inloggen.');
  let snapshot=null,locked=false;
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:AUTH_PATH,read:loadAuth,waitMs:1800,
    mutate:auth=>{
      const now=Date.now();
      const row=rateRecord(auth,studentId,now);
      if(row.blockedUntil>now)throw error('Te veel pogingen. Probeer later opnieuw.',429);
      if(row.attempts.length>=MAX_TRIES){
        row.blockedUntil=now+WINDOW;row.updatedAt=now;locked=true;return auth;
      }
      row.attempts.push(now);row.updatedAt=now;
      snapshot=usable(loadDb(),auth,studentId);
      return auth;
    }});
  if(locked)throw error('Te veel pogingen. Probeer later opnieuw.',429);
  if(!snapshot)throw error('Controleer je naam en PIN. Je kunt ook met Google inloggen.');
  if(!await pins.verifyCredential(pin,studentId,SECRET,snapshot.cred,snapshot.link.sub))
    throw error('Controleer je naam en PIN. Je kunt ook met Google inloggen.');
  const grant=crypto.randomBytes(32).toString('base64url');
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:AUTH_PATH,read:loadAuth,waitMs:1800,
    mutate:auth=>{
      const latest=usable(loadDb(),auth,studentId);
      const row=rateRecord(auth,studentId,Date.now());
      if(!latest||latest.link.sub!==snapshot.link.sub||latest.cred.hash!==snapshot.cred.hash||
        pins.currentGeneration(latest.cred)!==pins.currentGeneration(snapshot.cred)||
        row.blockedUntil>Date.now())throw error('PIN of account is gewijzigd. Probeer opnieuw.',409);
      row.attempts=[];row.blockedUntil=0;row.updatedAt=Date.now();
      const old=Array.isArray(auth.studentChoiceGrants)?auth.studentChoiceGrants:[];
      // One active choice grant per student; a newer tablet invalidates an older one.
      auth.studentChoiceGrants=old.filter(x=>x.studentId!==studentId&&x.expiresAt>Date.now());
      auth.studentChoiceGrants.push({
        tokenHash:core.tokenHash(grant),studentId,
        linkedSub:latest.link.sub,generation:pins.currentGeneration(latest.cred),
        expiresAt:Date.now()+TTL,
      });
      return auth;
    }});
  return {grant,expiresInSeconds:TTL/1000,firstName:firstName(snapshot.student)};
}
function resolveChoice(db,auth,{grant='',sessionToken=''}={}){
  if(grant){
    if(typeof grant!=='string'||!/^[a-zA-Z0-9_-]{32,100}$/.test(grant))
      throw error('Je persoonlijke keuzehulpsessie is verlopen.');
    const entry=(auth.studentChoiceGrants||[]).find(x=>x.tokenHash===core.tokenHash(grant));
    const latest=entry&&usable(db,auth,entry.studentId);
    if(!entry||entry.expiresAt<=Date.now()||!latest||
      latest.link.sub!==entry.linkedSub||
      pins.currentGeneration(latest.cred)!==entry.generation)
      throw error('Je persoonlijke keuzehulpsessie is verlopen.');
    return {studentId:entry.studentId,firstName:firstName(latest.student),scoped:true};
  }
  const session=sessionToken?security.validatePersistedSession(auth,sessionToken,db):null;
  if(session?.valid&&session.session?.type==='student'&&session.account?.active!==false){
    return {studentId:session.account.id,firstName:firstName(session.account),scoped:false};
  }
  return null;
}
const RECENT_DAYS=90;
function pastKeys(db,studentId){
  const entry=(db.studentChoiceSeen||[]).find(x=>x.studentId===studentId);
  if(!entry||!Number.isFinite(Date.parse(entry.updatedAt))||
    Date.parse(entry.updatedAt)<Date.now()-RECENT_DAYS*86400000)return [];
  return Array.isArray(entry.keys)?entry.keys.filter(x=>typeof x==='string').slice(-240):[];
}
async function suggestions({grant,sessionToken,choices}){
  // Authentication is rechecked inside the atomic DB transaction. We
  // serialize reading/updating recommendation history across server workers.
  let result;
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:DATA_PATH,read:loadDb,waitMs:1800,
    mutate:db=>{
      const identity=resolveChoice(db,loadAuth(),{grant,sessionToken});
      result=rankBooks(db,choices,{
        studentId:identity?.studentId||'',
        seenKeys:identity?pastKeys(db,identity.studentId):[],
      });
      result.personalized=Boolean(identity);
      result.firstName=identity?.firstName||'';
      if(identity&&result.suggestions.length){
        if(!Array.isArray(db.studentChoiceSeen))db.studentChoiceSeen=[];
        db.studentChoiceSeen=db.studentChoiceSeen.filter(x=>
          x.studentId!==identity.studentId &&
          Number.isFinite(Date.parse(x.updatedAt)) &&
          Date.parse(x.updatedAt)>Date.now()-RECENT_DAYS*86400000);
        const keys=[...pastKeys(db,identity.studentId),...result.suggestions.map(x=>x.key)];
        db.studentChoiceSeen.push({
          studentId:identity.studentId,keys:[...new Set(keys)].slice(-240),
          updatedAt:new Date().toISOString(),
        });
      }
      return identity?db:false; // guest: no persistent personal information
    }});
  return result;
}
async function clearHistory({grant,sessionToken}){
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:DATA_PATH,read:loadDb,waitMs:1800,
    mutate:db=>{
      const identity=resolveChoice(db,loadAuth(),{grant,sessionToken});
      if(!identity)throw error('Log in voor persoonlijke aanbevelingen.',401);
      db.studentChoiceSeen=(db.studentChoiceSeen||[]).filter(x=>x.studentId!==identity.studentId);
      return db;
    }});
  return {cleared:true};
}
async function closeChoice(grant){
  if(!grant||typeof grant!=='string'||!/^[a-zA-Z0-9_-]{32,100}$/.test(grant))return;
  const hash=core.tokenHash(grant);
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:AUTH_PATH,read:loadAuth,waitMs:1800,
    mutate:auth=>{
      auth.studentChoiceGrants=(auth.studentChoiceGrants||[]).filter(x=>x.tokenHash!==hash);
      return auth;
    }});
}
module.exports={startChoice,resolveChoice,suggestions,clearHistory,closeChoice,firstName,TTL};
