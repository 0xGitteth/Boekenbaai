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
  books:[],folders:[],history:[],importJobs:[],
  classes:[
    {id:'old',name:'Arbeid',studentIds:['pupil-two'],teacherIds:['teacher-old']},
    {id:'new',name:'Onderbouw BKT',studentIds:['pupil-one'],
      teacherIds:['teacher-new']},
  ],
  students:[
    student('pupil-one','Leerling Nieuwe Klas',['old']),
    student('pupil-two','Leerling Oude Klas',['old']),
  ],
  users:[teacher('teacher-old','old'),teacher('teacher-new','new')],
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
    assert.deepEqual(pupil.data.user.classIds,['new']);
    assert.deepEqual(pupil.data.user.classNames,['Onderbouw BKT']);
    const me=await fetchApi('/api/me',pupil.data.token);
    assert.equal(me.status,200);
    assert.equal(me.data.grade,'Vorige klas',
      'Keep legacy stored grade without calling it the current class');
    assert.deepEqual(me.data.classIds,['new']);
    assert.deepEqual(me.data.classNames,['Onderbouw BKT']);
    const oldTeacher=await login('teacher-old');
    const oldList=await fetchApi('/api/students',oldTeacher.data.token);
    assert.equal(oldList.status,200);
    assert.deepEqual(oldList.data.map(s=>s.id),['pupil-two'],
      'A previous mentor must not see the pupil now in another class');
    const newTeacher=await login('teacher-new');
    const newList=await fetchApi('/api/students',newTeacher.data.token);
    assert.equal(newList.status,200);
    assert.deepEqual(newList.data.map(s=>s.id),['pupil-one']);
    assert.deepEqual(newList.data[0].classNames,['Onderbouw BKT']);
    assert.deepEqual(newList.data[0].classIds,['new']);
    const after=JSON.parse(fs.readFileSync(dbFile,'utf8'));
    assert.deepEqual(after.students,db.students,
      'Read-only class projection must not mutate account records');
    assert.deepEqual(after.classes,db.classes);
    console.log('Current classes in student login, own profile and mentor API OK');
  }finally{
    child?.kill('SIGTERM');
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
