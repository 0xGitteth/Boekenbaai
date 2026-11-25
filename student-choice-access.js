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
const {workKey}=require('./book-reservations');
const moderation=require('./student-choice-moderation');
const guestModeration=require('./student-choice-guest');
const {interpret,LABELS}=require('./student-choice-open-text');
const conversation=require('./student-choice-conversation');
const references=require('./student-choice-reference');
const series=require('./student-choice-series');
const dialogue=require('./student-choice-dialogue');
const {attachDerivedThemeFields}=require('./book-theme-normalization');
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
      if(moderation.state(loadDb(),studentId).blocked)throw blockedError();
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
function blockedError(){
 return Object.assign(error('Help me kiezen is geblokkeerd. Vraag je mentor om de functie weer open te zetten.',423),{code:'CHOICE_BLOCKED'});
}
function assertOpeningIdentity(credentials,identity){
 // The assertion is never a credential. The actual identity is resolved
 // from a validated session or PIN grant before any read/write/moderation.
 const expected=credentials.expectedStudentId;
 if((expected!==undefined&&expected!==(identity?.studentId||null))
   ||(identity&&!credentials.grant&&typeof expected!=='string'))
  throw Object.assign(error('Je account is gewijzigd. Open Help me kiezen opnieuw.',409),{code:'CHOICE_ACCOUNT_CHANGED'});
}
function requireChoice(db,credentials){
 const identity=resolveChoice(db,loadAuth(),credentials);
 assertOpeningIdentity(credentials,identity);
 if(!identity)throw error('Log eerst in met je schoolaccount of PIN.',401);
 if(moderation.state(db,identity.studentId).blocked)throw blockedError();
 return identity;
}
// A valid pupil identity always takes precedence over anonymous mode.
function choiceAccess(db,credentials){
 const identity=resolveChoice(db,loadAuth(),credentials);
 assertOpeningIdentity(credentials,identity);
 if(identity){
  if(moderation.state(db,identity.studentId).blocked)throw blockedError();
  return {identity,guest:null};
 }
 if(typeof credentials.guest!=='function')throw error('Open de keuzehulp opnieuw.',401);
 const guest=credentials.guest();
 guestModeration.check(guest);
 return {identity:null,guest};
}
function choiceStatus(credentials){
 const db=loadDb(),access=choiceAccess(db,credentials);
 return access.identity?{warned:moderation.state(db,access.identity.studentId).warned}:guestModeration.status(access.guest);
}
async function interpretAnswer({grant,sessionToken,guest,expectedStudentId,text,context,consent=false}){
 let result;
 await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:DATA_PATH,read:loadDb,waitMs:1800,
  mutate:db=>{
   const access=choiceAccess(db,{grant,sessionToken,guest,expectedStudentId});
   const outcome=access.identity?moderation.apply(db,access.identity.studentId,text):guestModeration.apply(access.guest,text,db.books||[]);
   if(outcome.kind==='normal'){
     const recent=consent===true&&access.identity?pastQuestions(db,access.identity.studentId):[];
     const safe=conversation.cleanContext(context);
     const ctx={...safe,optionId:typeof context?.optionId==='string'?context.optionId:'',optionIds:Array.isArray(context?.optionIds)?context.optionIds.filter(x=>typeof x==='string').slice(0,24):undefined,navigation:['questions','examples','menu','topics','book-feedback','index'].includes(context?.navigation)?context.navigation:undefined,bookVotes:Array.isArray(context?.bookVotes)?context.bookVotes.slice(0,8):undefined,recent:[...safe.recent,...recent].slice(-40)};
     result={...conversation.analyze(text,ctx,(db.books||[]).map(attachDerivedThemeFields)),moderation:'normal'};
   }else result={moderation:outcome.kind,guest:!access.identity};
   return access.identity&&outcome.changed?db:false;
  }});
 // Throw only AFTER the transaction persists the block.
 if(result.moderation==='blocked')throw blockedError();
 return result;
}
async function lookupReference(credentials,query,external){
 const db=loadDb();
 choiceAccess(db,credentials);
 // Only a dedicated, explicitly submitted bibliographic form is forwarded.
 // Never pass authentication, conversation context or reading history.
 const result=await references.lookup(db,query,{external:external===true});
 choiceAccess(loadDb(),credentials);
 return result;
}
function seriesReference(credentials,{bookId,externalRef,readPart,consent,signals}={}){
 const db=loadDb(),access=choiceAccess(db,credentials);
 const book=typeof bookId==='string'?(db.books||[]).find(b=>b.id===bookId&&b.catalogHidden!==true&&b.personalLoanOnly!==true):references.getReference(externalRef);
 if(!book)return {series:null};
 const catalogue={...db,books:(db.books||[]).map(attachDerivedThemeFields)};
 return series.nextPart(catalogue,book,readPart,access.identity?.studentId||'',consent===true,signals);
}
function mentorContext(db,sessionToken,id){
 const checked=sessionToken?security.validatePersistedSession(loadAuth(),sessionToken,db):null;
 if(!checked?.valid||checked.session?.type!=='staff'||!moderation.mayUnlock(db,checked.account,id))
  throw error('Alleen een huidige mentor mag deze keuzehulp beheren.',403);
 return checked.account;
}
function mentorStatus({sessionToken,studentId}){
 const db=loadDb();
 mentorContext(db,sessionToken,studentId);
 const {blocked,warned,reason,updatedAt}=moderation.state(db,studentId);
 return {blocked,warned,reason,updatedAt};
}
async function mentorUnlock({sessionToken,studentId}){
 let result;
 await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:DATA_PATH,read:loadDb,waitMs:1800,
  mutate:db=>{
   const actor=mentorContext(db,sessionToken,studentId);
   result=moderation.unlock(db,actor,studentId);
   if(result.status!==200)throw error('Geen toestemming.',403);
   return result.changed?db:false;
  }});
 return {blocked:false,warned:false};
}
// The context request is explicit, read-only and restricted to a single
// student's validated choice grant or full session. Only public catalogue
// works are returned. Favorites indicate interest, not reading or liking.
function personalContext({grant,sessionToken,expectedStudentId}){
  const db=loadDb();
  const identity=requireChoice(db,{grant,sessionToken,expectedStudentId});
  const publicBooks=(db.books||[]).filter(b=>b?.id&&b.catalogHidden!==true&&b.personalLoanOnly!==true);
  const byId=new Map(publicBooks.map(b=>[b.id,b]));
  const byKey=new Map(publicBooks.map(b=>[workKey(b),b]));
  const project=b=>({bookId:b.id,title:String(b.title||'').slice(0,300),author:String(b.author||'').slice(0,300)});
  const records=(db.readingRecords||[]).filter(r=>r?.subjectType==='student'
    &&r.subjectId===identity.studentId&&r.finished===true
    &&Number.isFinite(Date.parse(r.reportedAt)))
    .sort((a,b)=>Date.parse(b.reportedAt)-Date.parse(a.reportedAt));
  let recent=null;
  for(const r of records){
    const book=byId.get(r.bookId);
    if(book&&(!r.title||workKey(r)===workKey(book))){
      recent=project(book);break;
    }
  }
  const favorites=[];
  const seen=new Set();
  for(const entry of db.studentFavorites||[]){
    if(entry?.studentId!==identity.studentId||seen.has(entry.key))continue;
    const book=byKey.get(entry.key);
    if(book){favorites.push(project(book));seen.add(entry.key);}
    if(favorites.length>=5)break;
  }
  return {recent,favorites};
}
const RECENT_DAYS=90;
function pastQuestions(db,id){
 const row=(db.studentChoiceSeen||[]).find(x=>x.studentId===id);
 if(!row||!Number.isFinite(Date.parse(row.updatedAt))||Date.parse(row.updatedAt)<Date.now()-RECENT_DAYS*86400000)return [];
 return conversation.cleanContext({recent:row.questionIds}).recent.filter(id=>!conversation.privateQuestion(id));
}
function pastKeys(db,studentId){
  const entry=(db.studentChoiceSeen||[]).find(x=>x.studentId===studentId);
  if(!entry||!Number.isFinite(Date.parse(entry.updatedAt))||
    Date.parse(entry.updatedAt)<Date.now()-RECENT_DAYS*86400000)return [];
  return Array.isArray(entry.keys)?entry.keys.filter(x=>typeof x==='string').slice(-240):[];
}
async function suggestions({grant,sessionToken,guest,expectedStudentId,choices,anonymous=false}){
  // Authentication is rechecked inside the atomic DB transaction. We
  // serialize reading/updating recommendation history across server workers.
  let result;
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:DATA_PATH,read:loadDb,waitMs:1800,
    mutate:db=>{
      const verified=choiceAccess(db,{grant,sessionToken,guest,expectedStudentId}).identity;
      // Declining personal advice does not disable account-level moderation.
      const identity=anonymous||choices?.discoverySample===true?null:verified;
      // Match public catalogue GET normalization. Raw imported tags are
      // not curator-approved themes until these shared rules are applied.
      const catalogue={...db,books:(db.books||[]).map(attachDerivedThemeFields)};
      result=rankBooks(catalogue,choices,{
        studentId:identity?.studentId||'',
        seenKeys:identity?pastKeys(db,identity.studentId):[],
      });
      result.personalized=Boolean(identity);
      result.firstName=identity?.firstName||'';
      // Sensitive reading topics remain within this conversation. Do not persist associated titles or question IDs.
      if(identity&&result.suggestions.length&&!conversation.privateReadingRequest(choices)){
        if(!Array.isArray(db.studentChoiceSeen))db.studentChoiceSeen=[];
        const prior=pastKeys(db,identity.studentId);
        const priorQuestions=pastQuestions(db,identity.studentId);
        const newQuestions=choices?.useReadingHistory===true?conversation.cleanContext({used:choices.questionIds}).used:[];
        db.studentChoiceSeen=db.studentChoiceSeen.filter(x=>
          x.studentId!==identity.studentId &&
          Number.isFinite(Date.parse(x.updatedAt)) &&
          Date.parse(x.updatedAt)>Date.now()-RECENT_DAYS*86400000);
        const keys=[...prior,...result.suggestions.map(x=>x.key)];
        db.studentChoiceSeen.push({
          studentId:identity.studentId,keys:[...new Set(keys)].slice(-240),
          questionIds:[...new Set([...priorQuestions,...newQuestions])].slice(-40),
          updatedAt:new Date().toISOString(),
        });
      }
      return identity&&result.suggestions.length&&!conversation.privateReadingRequest(choices)?db:false; // guest/private topic: no new recommendation history
    }});
  return result;
}
function nextQuestion({grant,sessionToken,guest,expectedStudentId,answers=[],seed='',excludeQuestionIds=[]}={}){
  const db=loadDb();
  choiceAccess(db,{grant,sessionToken,guest,expectedStudentId});
  // Question selection itself still sees public metadata only.
  const books=(db.books||[]).map(attachDerivedThemeFields);
  return dialogue.selection({books},{answers,seed,excludeQuestionIds});
}
async function clearHistory({grant,sessionToken,expectedStudentId}){
  await mutateJsonLockedAsync({lockPath:DATA_PATH,filePath:DATA_PATH,read:loadDb,waitMs:1800,
    mutate:db=>{
      const identity=requireChoice(db,{grant,sessionToken,expectedStudentId});
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
module.exports={startChoice,resolveChoice,suggestions,nextQuestion,clearHistory,closeChoice,personalContext,choiceStatus,interpretAnswer,mentorStatus,mentorUnlock,lookupReference,seriesReference,firstName,TTL};
