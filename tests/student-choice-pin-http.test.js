'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const authCore=require('../google-auth-core');
const pins=require('../student-pin-core');
const {accountCredentialFingerprint}=require('../google-auth-security-core');
const root=path.join(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb-choice-pin-'));
const dbPath=path.join(temp,'db.json'),authPath=dbPath+'.auth.json';
const port=31964,url='http://127.0.0.1:'+port,secret='long-choice-pin-test-secret-2026';
let child;const errors=[];
const db={
  students:[
    {id:'a',name:'Sanne Jansen',firstName:'Sanne',active:true,borrowedBooks:[],classIds:['ca']},
    {id:'b',name:'Pieter Peters',firstName:'Pieter',active:true,borrowedBooks:[],classIds:['cb']},
  ],
  classes:[
    {id:'ca',name:'Bovenbouw structuur',studentIds:['a'],teacherIds:['t']},
    {id:'cb',name:'Onderbouw BKT',studentIds:['b'],teacherIds:[]},
  ],
  users:[{id:'t',name:'Mentor',role:'teacher',active:true,classIds:['ca'],passwordHash:'secret'}],
  books:Array.from({length:12},(_,i)=>({
    id:'book-'+i,title:'Titel '+i,author:'Schrijver '+i,
    themes:i===11?undefined:i%2?['Mysterie','Spanning']:['Avontuur','Vriendschap'],
    tags:i===11?['Humor']:[],
    status:'available',borrowedBy:null,borrowedByClassId:null,pageCount:140+i,
  })),
  readingRecords:[
    {id:'read-a',subjectId:'a',subjectType:'student',bookId:'book-1',finished:true},
    {id:'read-b',subjectId:'b',subjectType:'student',bookId:'book-4',finished:true},
  ],examReadingLists:[],history:[],folders:[],
};
const readDb=()=>JSON.parse(fs.readFileSync(dbPath,'utf8'));
const readAuth=()=>JSON.parse(fs.readFileSync(authPath,'utf8'));
async function request(route,body,token='',origin=url){
  const response=await fetch(url+route,{
    method:body===undefined?'GET':'POST',
    headers:{
      Origin:origin,'Sec-Fetch-Site':'same-origin',
      ...(body===undefined?{}:{'Content-Type':'application/json'}),
      ...(token?{Cookie:'boekenbaai_session='+encodeURIComponent(token)}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {status:response.status,body:await response.json().catch(()=>({})),
    setCookie:response.headers.get('set-cookie')||''};
}
async function setup(){
  fs.writeFileSync(dbPath,JSON.stringify(db));
  let auth=authCore.emptyAuthStore();
  for(const [id,sub,code]of [['a','google-a','123456'],['b','google-b','654321']]){
    auth.links.push({accountType:'student',accountId:id,sub,email:id+'@koraaledu.nl'});
    pins.replaceCredential(auth,await pins.makeCredential(code,id,secret,null,sub));
  }
  for(const [token,userId,type]of [['session-a','a','student'],['session-t','t','staff']]){
    const record=authCore.upsertSession(auth,token,{userId,type,now:Date.now()});
    auth=record.store;
    const account=type==='student'?{...db.students[0],role:'student'}:db.users[0];
    record.session.accountFingerprint=accountCredentialFingerprint(account);
    record.session.authMethod='google';
  }
  fs.writeFileSync(authPath,JSON.stringify(auth));
  child=spawn(process.execPath,[
    '--require',path.join(root,'response-safety-preload.js'),
    '--require',path.join(root,'student-login-directory-preload.js'),
    '--require',path.join(root,'google-auth-security-preload.js'),
    '--require',path.join(root,'active-account-session-guard-preload.js'),
    '--require',path.join(root,'google-auth-runtime-preload.js'),
    '--require',path.join(root,'student-pin-preload.js'),
    path.join(root,'server.js'),
  ],{env:{...process.env,PORT:String(port),NODE_ENV:'test',
    BOEKENBAAI_DATA_PATH:dbPath,BOEKENBAAI_AUTH_DATA_PATH:authPath,
    BOEKENBAAI_AUTH_SECRET:secret,BOEKENBAAI_PUBLIC_URL:url,
    BOEKENBAAI_STATIC_DIR:path.join(root,'public')},
    stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',chunk=>errors.push(String(chunk)));
  for(let i=0;i<130;i++){
    if(child.exitCode!==null)throw Error('Choice server exited '+errors.join(''));
    try{const res=await request('/api/status');if(res.status===200)return;}catch(_){}
    await new Promise(r=>setTimeout(r,50));
  }
  throw Error('Choice server startup failed '+errors.join(''));
}
const begin=(studentId='a',pin='123456')=>request('/api/auth/student-pin/choice-begin',{studentId,pin});
const suggest=(choices,grant,session='')=>request('/api/auth/student-pin/choice-suggest',{
  ...(grant?{choiceGrant:grant}:{}),choices,
},session);
async function stop(){
  if(child&&child.exitCode===null){
    child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));
  }
  fs.rmSync(temp,{recursive:true,force:true});
}
(async()=>{
  try{
    await setup();
    const foreign=await request('/api/auth/student-pin/choice-begin',
      {studentId:'a',pin:'123456'},'','https://other.invalid');
    assert.equal(foreign.status,403);
    assert.equal((await begin('a','000000')).status,401);
    assert.equal((await begin('does-not-exist','123456')).status,401);
    const started=await begin();
    assert.equal(started.status,200,JSON.stringify(started.body));
    assert.equal(started.body.firstName,'Sanne');
    assert.equal(started.body.expiresInSeconds,600);
    assert.equal(started.setCookie,'','Choice PIN cannot create login cookie');
    const grant=started.body.grant;
    assert.ok(/^[\w-]{32,}$/.test(grant));
    assert.notEqual((await request('/api/me',undefined,grant)).status,200,
      'Recommendation grant may never authenticate a student session');
    const rawTags=await suggest({route:'new',mood:'funny',seed:'derived'});
    assert.equal(rawTags.status,200);
    assert.equal(rawTags.body.suggestions[0].bookId,'book-11',
      'Raw catalogue tags must be normalized with the shared curator rules');
    const choices={route:'similar',activity:'gaming',situation:'secret',detail:'puzzles',mood:'exciting',length:'any',seed:'same'};
    const first=await suggest(choices,grant);
    assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.personalized,true);
    assert.equal(first.body.firstName,'Sanne');
    assert.equal(first.body.suggestions.length,3);
    const next=await suggest(choices,grant);
    assert.equal(next.status,200,JSON.stringify(next.body));
    assert.equal(next.body.suggestions.length,3);
    assert.ok(next.body.suggestions.every(x=>!first.body.suggestions.some(a=>a.key===x.key)),
      'Same answers must not return earlier suggestions across sessions');
    const record=readDb().studentChoiceSeen.find(x=>x.studentId==='a');
    assert.ok(record&&record.keys.length===6);
    assert.equal(readDb().studentChoiceSeen.some(x=>x.studentId==='b'),false);
    const outsider=await suggest(choices);
    assert.equal(outsider.status,200);
    assert.equal(outsider.body.personalized,false);
    assert.ok(!outsider.body.firstName);
    const staff=await suggest(choices,undefined,'session-t');
    assert.equal(staff.status,200);
    assert.equal(staff.body.personalized,false,'Teacher session must not reveal pupil choices');
    const full=await suggest(choices,undefined,'session-a');
    assert.equal(full.status,200);
    const explicitlyAnonymous=await request('/api/auth/student-pin/choice-suggest',
      {anonymous:true,choices},'session-a');
    assert.equal(explicitlyAnonymous.status,200);
    assert.equal(explicitlyAnonymous.body.personalized,false,
      'Explicit anonymous mode must override a residual valid student session');
    assert.equal(full.body.personalized,true);
    assert.equal(full.body.firstName,'Sanne');
    assert.equal((await request('/api/auth/student-pin/choice-reset',{choiceGrant:grant})).status,200);
    assert.equal(readDb().studentChoiceSeen.some(x=>x.studentId==='a'),false);
    const another=await suggest(choices,grant);
    assert.equal(another.status,200);
    assert.equal((await request('/api/auth/student-pin/choice-end',{choiceGrant:grant})).status,200);
    assert.equal((await suggest(choices,grant)).status,401,'Closed choice grant must not be reusable');

    const secondStudent=await begin('b','654321');
    assert.equal(secondStudent.status,200);
    assert.equal(secondStudent.body.firstName,'Pieter');
    const beforeReset=secondStudent.body.grant;
    const reset=await request('/api/auth/student-pin/students/b/reset',{},'session-t');
    assert.equal(reset.status,403,'Unrelated teacher may not reset');
    // Simulate PIN reset tombstone, then scoped token must be rejected.
    const store=readAuth();
    pins.resetCredential(store,'b',pins.credentialFor(store,'b'));
    fs.writeFileSync(authPath,JSON.stringify(store));
    assert.equal((await suggest(choices,beforeReset)).status,401,
      'Reset must invalidate scoped recommendation access immediately');
    assert.equal((await begin('b','654321')).status,401);
    assert.equal((await request('/api/auth/student-pin/choice-suggest',{choiceGrant:'fake-token',choices})).status,401);
    assert.ok(!JSON.stringify(readDb()).includes('123456'));
    assert.ok(!JSON.stringify(readAuth()).includes(grant),
      'Only hashes of scoped bearer grants are saved');
    console.log('PIN recommendations scope, no login escalation, anti-repeat, revocation and privacy: OK');
  }finally{await stop();}
})().catch(e=>{console.error(e);if(errors.length)console.error(errors.join(''));process.exitCode=1;});
