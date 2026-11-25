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
    {id:'read-a',subjectId:'a',subjectType:'student',bookId:'book-1',finished:true,reportedAt:'2026-11-01T12:00:00Z'},
    {id:'read-b',subjectId:'b',subjectType:'student',bookId:'book-4',finished:true,reportedAt:'2026-11-02T12:00:00Z'},
  ],examReadingLists:[],history:[],folders:[],
  studentFavorites:[
    {studentId:'a',key:JSON.stringify(['titel 2','schrijver 2']),title:'Titel 2',author:'Schrijver 2'},
    {studentId:'b',key:JSON.stringify(['titel 4','schrijver 4']),title:'Titel 4',author:'Schrijver 4'},
  ],
};
const readDb=()=>JSON.parse(fs.readFileSync(dbPath,'utf8'));
const readAuth=()=>JSON.parse(fs.readFileSync(authPath,'utf8'));
async function request(route,body,token='',origin=url,guestCookie=''){
  if(body&&route.startsWith('/api/auth/student-pin/choice-')&&!body.choiceGrant
    &&!Object.hasOwn(body,'expectedStudentId')&&['session-a','session-b'].includes(token))
    body={...body,expectedStudentId:token==='session-a'?'a':'b'};
  const response=await fetch(url+route,{
    method:body===undefined?'GET':'POST',
    headers:{
      Origin:origin,'Sec-Fetch-Site':'same-origin',
      ...(body===undefined?{}:{'Content-Type':'application/json'}),
      ...((token||guestCookie)?{Cookie:[token?'boekenbaai_session='+encodeURIComponent(token):'',guestCookie].filter(Boolean).join('; ')}:{}),
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
  for(const [token,userId,type]of [['session-a','a','student'],['session-b','b','student'],['session-t','t','staff']]){
    const record=authCore.upsertSession(auth,token,{userId,type,now:Date.now()});
    auth=record.store;
    const account=type==='student'?{...db.students.find(s=>s.id===userId),role:'student'}:db.users[0];
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
    const interpreted=await request('/api/auth/student-pin/choice-interpret',{text:'Een mysterie zonder moord',choiceGrant:grant});
    assert.equal(interpreted.status,200);
    assert.deepEqual(interpreted.body.prefer,['mystery']);
    assert.deepEqual(interpreted.body.avoid,['murder']);
    assert.equal((await request('/api/auth/student-pin/choice-interpret',{text:'x'.repeat(501)})).status,400);
    assert.equal((await request('/api/auth/student-pin/choice-interpret',{text:'mysterie'},'','https://other.invalid')).status,403);
    const contextRoute='/api/auth/student-pin/choice-context';
    assert.equal((await request(contextRoute,{consent:true})).status,401);
    assert.equal((await request(contextRoute,{consent:true},'session-t')).status,401);
    assert.equal((await request(contextRoute,{choiceGrant:grant})).status,400);
    assert.equal((await request(contextRoute,{consent:true,choiceGrant:grant},'','https://other.invalid')).status,403);
    const context=await request(contextRoute,{consent:true,choiceGrant:grant,studentId:'b'});
    assert.equal(context.status,200,JSON.stringify(context.body));
    assert.equal(context.body.recent.bookId,'book-1');
    assert.deepEqual(context.body.favorites.map(b=>b.bookId),['book-2']);
    assert.deepEqual((await request(contextRoute,{consent:true},'session-a')).body,context.body);
    assert.ok(!JSON.stringify(context.body).includes('studentId'));
    const wrong=await request(contextRoute,{consent:true,expectedStudentId:'a'},'session-b');
    assert.equal(wrong.status,409);
    assert.equal(wrong.body.code,'CHOICE_ACCOUNT_CHANGED');
    assert.equal(wrong.body.recent,undefined);
    assert.equal(wrong.body.favorites,undefined);
    assert.equal((await request(contextRoute,{consent:true,expectedStudentId:'a'})).status,409);
    assert.equal((await request(contextRoute,{consent:true,expectedStudentId:null},'session-b')).status,409);
    const otherContext=await request(contextRoute,{consent:true,expectedStudentId:'b'},'session-b');
    assert.equal(otherContext.body.recent.bookId,'book-4');
    assert.deepEqual(otherContext.body.favorites.map(b=>b.bookId),['book-4']);
    assert.equal((await request(contextRoute,{consent:true,choiceGrant:grant,expectedStudentId:'b'},'session-b')).status,409);
    assert.deepEqual((await request(contextRoute,{consent:true,choiceGrant:grant,expectedStudentId:'a'},'session-b')).body,context.body);
    // Guard every route, not just the private-context endpoint.
    const beforeWrong=readDb();
    for(const [route,body] of [
      ['choice-status',{}],['choice-next',{answers:[]}],
      ['choice-suggest',{choices:{route:'surprise'}}],['choice-reset',{}],
      ['choice-interpret',{text:'jij bent een sukkel'}],
      ['choice-reference',{title:'Titel 1'}],['choice-series',{bookId:'book-1'}]
    ]){
      const result=await request('/api/auth/student-pin/'+route,{...body,expectedStudentId:'a'},'session-b');
      assert.equal(result.status,409,route);
      assert.equal(result.body.code,'CHOICE_ACCOUNT_CHANGED');
    }
    assert.deepEqual(readDb(),beforeWrong,'Wrong-account requests never mutate history or moderation');
    // Questions require a verified choice identity, but remain read-only.
    const nextQuestion=await request('/api/auth/student-pin/choice-next',{
      choiceGrant:grant,answers:[],seed:'choice-exploration',
    });
    assert.equal(nextQuestion.status,200,JSON.stringify(nextQuestion.body));
    assert.equal(typeof nextQuestion.body.question?.id,'string');
    assert.ok(nextQuestion.body.question.options.length>=3);
    assert.equal(nextQuestion.body.question.borrowedBy,undefined);
    assert.equal((await request('/api/auth/student-pin/choice-next',{
      answers:[],seed:'choice-exploration',
    },'','https://other.invalid')).status,403,
    'Cross-site adaptive requests must fail the same-origin check');
    const secondQuestion=await request('/api/auth/student-pin/choice-next',{
      choiceGrant:grant,seed:'choice-exploration',answers:[{
        questionId:nextQuestion.body.question.id,
        optionId:nextQuestion.body.question.options[0].id,
      }],
    });
    assert.equal(secondQuestion.status,200);
    assert.notEqual(secondQuestion.body.question?.id,nextQuestion.body.question.id,
      'Adaptive questions must not repeat the already answered one');
    assert.equal((readDb().studentChoiceSeen||[]).length,0,
      'Selecting questions does not persist a pupil recommendation history');
    const rawTags=await request('/api/auth/student-pin/choice-suggest',{choiceGrant:grant,anonymous:true,choices:{route:'new',mood:'funny',seed:'derived'}});
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
    const interpretRoute='/api/auth/student-pin/choice-interpret';
    const guestStart=await request('/api/auth/student-pin/choice-status',{});
    assert.equal(guestStart.status,200);
    assert.equal(guestStart.body.guest,true);
    const guestCookie=guestStart.setCookie.split(';')[0];
    assert.match(guestCookie,/^boekenbaai_choice_guest=/);
    assert.match(guestStart.setCookie,/HttpOnly/);
    const guestReq=(route,body,token='')=>request(route,body,token,url,guestCookie);
    const beforeGuest=readDb();
    assert.equal((await guestReq(interpretRoute,{text:'jij bent een klootzak'})).body.moderation,'warning');
    const stopped=await guestReq(interpretRoute,{text:'jij bent een klootzak'});
    assert.equal(stopped.status,423);
    assert.equal(stopped.body.code,'CHOICE_GUEST_PAUSED');
    for(const route of ['choice-status','choice-next','choice-suggest','choice-interpret']){
      const res=await guestReq('/api/auth/student-pin/'+route,{text:'fantasy',choices});
      assert.equal(res.status,423,route);
    }
    assert.deepEqual(readDb(),beforeGuest,'Guest incidents must not persist in pupil data');
    assert.equal((await guestReq('/api/auth/student-pin/choice-status',{},'session-a')).status,200,'An innocent signed-in student is not blocked by guest activity');
    assert.equal((await request('/api/auth/student-pin/choice-status',{})).status,200,'Different browser unaffected');
    assert.equal((await request(interpretRoute,{text:'67',choiceGrant:grant})).body.moderation,'redirect');
    assert.equal((await request(interpretRoute,{text:'erg of mnu hahahaha 😂',choiceGrant:grant})).body.moderation,'warning');
    assert.equal((await request(interpretRoute,{text:'jij bent een klootzak',choiceGrant:grant})).status,423);
    assert.equal((await suggest(choices,grant)).status,423);
    assert.equal((await suggest(choices,undefined,'session-a')).status,423);
    assert.equal((await request('/api/auth/student-pin/choice-suggest',{anonymous:true,choices},'session-a')).status,423);
    assert.equal((await request('/api/auth/student-pin/choice-next',{choiceGrant:grant})).status,423);
    assert.equal((await request('/api/auth/student-pin/choice-context',{consent:true,choiceGrant:grant})).status,423);
    assert.equal((await request('/api/auth/student-pin/choice-reset',{choiceGrant:grant})).status,423);
    assert.equal((await begin()).status,423,'New PIN grant must not bypass a block');
    const unlock='/api/auth/student-pin/students/a/choice-unlock';
    assert.equal((await request(unlock,{},'session-a')).status,403);
    assert.equal((await request('/api/auth/student-pin/students/b/choice-unlock',{},'session-t')).status,403);
    assert.equal((await request('/api/auth/student-pin/students/a/choice-status',{},'session-t')).body.blocked,true);
    assert.equal((await request(unlock,{},'session-t')).status,200);
    assert.equal((await suggest(choices,grant)).status,200);
    assert.ok(!JSON.stringify(readDb()).includes('jij bent een klootzak'),'Do not persist raw text');
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
