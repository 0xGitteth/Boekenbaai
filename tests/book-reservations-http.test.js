'use strict';
// Live HTTP regression: waiting-list holds must be enforced by the actual
// scan/checkout endpoints, not just by disabled catalogue buttons.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PORT=4087,BASE='http://127.0.0.1:'+PORT;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-reserve-'));
const dbFile=path.join(tmp,'db.json');
const user=(id,role='student')=>({
  id,name:id,username:id,passwordHash:hash('pass'),role,active:true,
  classIds:['class-a'],borrowedBooks:[],
});
const pupilA=user('waiting-a'),pupilB=user('waiting-b'),borrower=user('borrower');
borrower.borrowedBooks=[{bookId:'copy-a',borrowedAt:'2026-11-19T12:00:00Z'}];
fs.writeFileSync(dbFile,JSON.stringify({
  books:[{id:'copy-a',title:'Spijt!',author:'Carry Slee.',
    editionIsbn:'9789048849178',metadataIsbn:'9789048849178',
    barcode:'9789048849178',status:'borrowed',
    borrowedBy:'borrower',borrowedByClassId:null,
    borrowedAt:'2026-11-19T12:00:00Z',catalogHidden:false}],
  students:[pupilA,pupilB,borrower],
  users:[{...user('teacher-a','teacher'),classIds:['class-a']}],
  classes:[{id:'class-a',name:'Schoolklas A',teacherIds:['teacher-a'],
    studentIds:['waiting-a','waiting-b','borrower']}],
  history:[],folders:[],importJobs:[],
}));
let child;
async function call(route,token,payload,method){
  const response=await fetch(BASE+route,{
    method:method||(payload===undefined?'GET':'POST'),
    headers:{Origin:BASE,'Sec-Fetch-Site':'same-origin',
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(payload===undefined?{}:{'Content-Type':'application/json'})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
  });
  return {status:response.status,body:await response.json()};
}
async function ready(){
  for(let i=0;i<100;i++){
    try{if((await call('/api/status')).status===200)return;}
    catch(_){}
    await new Promise(resolve=>setTimeout(resolve,60));
  }
  throw Error('Reservation test server failed to start');
}
async function run(){
  child=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(__dirname,'..'),
    env:{...process.env,PORT:String(PORT),BOEKENBAAI_DATA_PATH:dbFile,
      BOEKENBAAI_STATIC_DIR:path.resolve(__dirname,'../public')},
    stdio:['ignore','pipe','pipe'],
  });
  try{
    await ready();
    const login=async id=>{
      const result=await call('/api/login',null,{username:id,password:'pass'});
      assert.equal(result.status,200,JSON.stringify(result.body));
      return result.body.token;
    };
    const [a,b,borrowerToken,mentor]=await Promise.all(
      ['waiting-a','waiting-b','borrower','teacher-a'].map(login));
    assert.equal((await call('/api/book-reservations',null)).status,401);
    assert.equal((await call('/api/book-reservations',mentor,{bookId:'copy-a'})).status,403);
    assert.equal((await call('/api/book-reservations',a,{bookId:'copy-a'})).status,200);
    assert.equal((await call('/api/book-reservations',b,{bookId:'copy-a'})).status,200);
    assert.equal((await call('/api/book-reservations',b)).body.reservations[0].position,2);
    assert.equal((await call('/api/book-reservations',a)).body.reservations.length,1);
    const returned=await call('/api/books/copy-a/check-in',borrowerToken,{finished:true});
    assert.equal(returned.status,200,JSON.stringify(returned.body));
    const onHold=(await call('/api/book-reservations',a)).body.reservations[0];
    assert.equal(onHold.status,'ready');
    assert.equal((await call('/api/book-reservations',b)).body.reservations[0].status,'waiting');
    assert.equal((await call('/api/book-reservations',mentor)).body.mentorAlerts.length,1);
    const catalogOther=(await call('/api/books',b)).body.find(x=>x.id==='copy-a');
    const catalogFirst=(await call('/api/books',a)).body.find(x=>x.id==='copy-a');
    assert.equal(catalogOther.reservationHeld,true);
    assert.equal(catalogOther.reservationMine,false);
    assert.equal(catalogFirst.reservationMine,true);
    assert.equal(catalogOther.borrowedBy,undefined,'Do not leak borrower identity');
    assert.equal((await call('/api/books/copy-a/check-out',b,{})).status,409);
    assert.equal((await call('/api/books/copy-a/check-out',mentor,
      {studentId:'waiting-b'})).status,409);
    assert.equal((await call('/api/books/copy-a/check-out',a,{})).status,200);
    assert.equal((await call('/api/book-reservations',a)).body.reservations.length,0);
    assert.equal((await call('/api/books/copy-a/check-in',a,{finished:false})).status,200);
    const next=(await call('/api/book-reservations',b)).body.reservations[0];
    assert.equal(next.status,'ready');
    assert.equal((await call('/api/book-reservations/'+next.id,a,undefined,'DELETE')).status,404);
    assert.equal((await call('/api/book-reservations/'+next.id,b,undefined,'DELETE')).status,200);
    assert.equal((await call('/api/book-reservations',b)).body.reservations.length,0);
    const snapshot=JSON.parse(fs.readFileSync(dbFile,'utf8'));
    assert.equal(snapshot.books.length,1,'Reservation never creates a phantom copy');
    assert.equal(snapshot.books[0].borrowedBy,null);
    assert.equal(snapshot.bookReservations.length,2);
  }finally{
    if(child)child.kill('SIGTERM');
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}
run().then(()=>console.log('HTTP reservation ownership, queue and circulation OK'))
  .catch(error=>{console.error(error);process.exitCode=1;});
