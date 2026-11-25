'use strict';
// Real legacy student/staff HTTP endpoints must not report yesterday's class
// or reveal a pupil to the mentor of the previous class.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const port=31625;
const base='http://127.0.0.1:'+port;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-class-roster-'));
const dbFile=path.join(tmp,'db.json');
const pass='school-test-pass';
const passwordHash=crypto.createHash('sha256').update(pass).digest('hex');
const student=(id,name,classIds)=>({
  id,name,username:id,passwordHash,role:'student',grade:'Vorige klas',
  classIds,active:true,borrowedBooks:[],mustChangePassword:false,
});
const teacher=(id,classId)=>({
  id,name:id,username:id,passwordHash,role:'teacher',active:true,
  classIds:[classId],mustChangePassword:false,
});
const db={
  books:[{id:'favorite-copy',title:'Spijt!',author:'Carry Slee',status:'available'}],folders:[],history:[],importJobs:[],
  classes:[
    {id:'old',name:'Arbeid',studentIds:['pupil-two'],teacherIds:['teacher-old']},
    {id:'new',name:'Onderbouw BKT',studentIds:['pupil-one'],
      teacherIds:['teacher-new']},
    {id:'legacy',name:'Bovenbouw Structuur',teacherIds:['teacher-legacy']},
    {id:'empty',name:'VMBO Theoretisch 4',studentIds:[],teacherIds:['teacher-empty']},
    {id:'legacy-b',name:'VMBO Theoretisch 3',teacherIds:['teacher-legacy-b']},
  ],
  students:[
    student('pupil-one','Leerling Nieuwe Klas',['old']),
    student('pupil-two','Leerling Oude Klas',['old']),
    student('pupil-legacy','Leerling Legacy',['legacy']),
    student('pupil-legacy-two','Tweede Legacy',['legacy','legacy-b']),
    student('pupil-empty','Leerling Zonder Klas',['empty']),
  ],
  users:[teacher('teacher-old','old'),teacher('teacher-new','new'),
    teacher('teacher-legacy','legacy'),teacher('teacher-empty','empty'),
    teacher('teacher-legacy-b','legacy-b')],
};
fs.writeFileSync(dbFile,JSON.stringify(db));
let child;
async function fetchApi(route,token,body){
  const response=await fetch(base+route,{
    method:body===undefined?'GET':'POST',
    headers:{Origin:base, ...(token?{Authorization:'Bearer '+token}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  let data;
  try{data=await response.json();}catch(_){data=null;}
  return {status:response.status,data};
}
async function start(){
  child=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),
      NODE_ENV:'test',BOEKENBAAI_DATA_PATH:dbFile,
      BOEKENBAAI_PUBLIC_URL:base,
      BOEKENBAAI_STATIC_DIR:path.join(__dirname,'../public')},
    stdio:['ignore','pipe','pipe'],
  });
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Server stopped before HTTP test');
    try{if((await fetchApi('/api/books')).status===200)return;}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw Error('Server startup timeout');
}
async function login(username){
  const result=await fetchApi('/api/login',null,{username,password:pass});
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.data;
}
(async()=>{
  try{
    await start();
    const pupil=await login('pupil-one');
    assert.deepEqual(pupil.user.classIds,['new']);
    assert.deepEqual(pupil.user.classNames,['Onderbouw BKT']);
    const me=await fetchApi('/api/me',pupil.token);
    assert.equal(me.status,200);
    assert.equal(me.data.grade,'Vorige klas',
      'Keep legacy stored grade without calling it the current class');
    assert.deepEqual(me.data.classIds,['new']);
    assert.deepEqual(me.data.classNames,['Onderbouw BKT']);
    const oldTeacher=await login('teacher-old');
    const oldList=await fetchApi('/api/students',oldTeacher.token);
    assert.equal(oldList.status,200);
    assert.deepEqual(oldList.data.map(s=>s.id),['pupil-two'],
      'A previous mentor must not see the pupil now in another class');
    const newTeacher=await login('teacher-new');
    const newList=await fetchApi('/api/students',newTeacher.token);
    assert.equal(newList.status,200);
    assert.deepEqual(newList.data.map(s=>s.id),['pupil-one']);
    assert.deepEqual(newList.data[0].classNames,['Onderbouw BKT']);
    assert.deepEqual(newList.data[0].classIds,['new']);
    const legacy=await login('pupil-legacy');
    assert.deepEqual(legacy.user.classIds,['legacy']);
    assert.deepEqual(legacy.user.classNames,['Bovenbouw Structuur']);
    const legacyMe=await fetchApi('/api/me',legacy.token);
    assert.deepEqual(legacyMe.data.classIds,['legacy']);
    assert.deepEqual(legacyMe.data.classNames,['Bovenbouw Structuur']);
    assert.equal((await fetchApi('/api/exam-reading-list',legacy.token)).status,200);
    const legacyTeacher=await login('teacher-legacy');
    const legacyList=await fetchApi('/api/students',legacyTeacher.token);
    assert.deepEqual(legacyList.data.map(x=>x.id).sort(),['pupil-legacy','pupil-legacy-two']);
    assert.deepEqual((await fetchApi('/api/classes',legacyTeacher.token)).data[0].studentIds.sort(),
      ['pupil-legacy','pupil-legacy-two']);
    const empty=await login('pupil-empty');
    assert.deepEqual(empty.user.classIds,[]);
    assert.equal((await fetchApi('/api/exam-reading-list',empty.token)).status,403);
    assert.equal((await fetchApi('/api/students/pupil-one/reset-password',oldTeacher.token,{})).status,403);
    const after=JSON.parse(fs.readFileSync(dbFile,'utf8'));
    assert.deepEqual(after.students,db.students,
      'Read-only class projection must not mutate account records');
    assert.deepEqual(after.classes,db.classes);
    const multi=await login('pupil-legacy-two');
    assert.deepEqual(multi.user.classIds,['legacy','legacy-b']);
    const added=await fetchApi('/api/classes/legacy/students',legacyTeacher.token,{studentId:'pupil-one'});
    assert.equal(added.status,200,JSON.stringify(added.data));
    assert.deepEqual((await fetchApi('/api/me',multi.token)).data.classIds,['legacy','legacy-b']);
    const otherMentor=await login('teacher-legacy-b');
    assert.deepEqual((await fetchApi('/api/students',otherMentor.token)).data.map(x=>x.id),['pupil-legacy-two']);
    assert.equal((await fetchApi('/api/exam-reading-list',multi.token)).status,200);
    const key=JSON.stringify(['spijt!','carry slee']);
    const route=id=>'/api/me/favorites?account='+encodeURIComponent(id);
    assert.equal((await fetchApi(route('pupil-one'))).status,401);
    assert.equal((await fetchApi(route('pupil-one'),oldTeacher.token)).status,403);
    assert.equal((await fetchApi('/api/me/favorites',pupil.token)).status,409);
    assert.deepEqual((await fetchApi(route('pupil-one'),pupil.token)).data,{studentId:'pupil-one',favorites:[]});
    const favorite=await fetchApi(route('pupil-one'),pupil.token,{key,bookId:'favorite-copy',favorite:true,studentId:'pupil-two'});
    assert.equal(favorite.status,200,JSON.stringify(favorite.data));
    assert.deepEqual(favorite.data,{studentId:'pupil-one',favorites:[{key,title:'Spijt!',author:'Carry Slee'}]});
    // Simulate a stale tab whose displayed account is A but whose actual
    // authenticated request belongs to B. Neither reading nor editing is allowed.
    const staleRead=await fetchApi(route('pupil-one'),multi.token);
    assert.equal(staleRead.status,409);
    assert.equal(staleRead.data.code,'FAVORITE_ACCOUNT_CHANGED');
    assert.equal(staleRead.data.favorites,undefined);
    const staleWrite=await fetchApi(route('pupil-one'),multi.token,{key,bookId:'favorite-copy',favorite:true});
    assert.equal(staleWrite.status,409);
    assert.deepEqual((await fetchApi(route('pupil-legacy-two'),multi.token)).data.favorites,[]);
    assert.equal((await fetchApi(route('pupil-one'),pupil.token)).data.favorites.length,1);
    assert.deepEqual((await fetchApi(route('pupil-one'),pupil.token,{key,favorite:false})).data.favorites,[]);
    console.log('Current classes, mentor API and private favorites OK');
  }finally{
    child?.kill('SIGTERM');
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
