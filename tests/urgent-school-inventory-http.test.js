'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.join(__dirname,'..'),port=4433;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-urgent-'));
const dbPath=path.join(tmp,'db.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const book=(id,attrs={})=>({
  id,title:'Testtitel',author:'Testauteur',barcode:id==='lost'?'9789026997471':'9780306406157',
  editionIsbn:id==='lost'?'9789026997471':'9780306406157',
  metadataIsbn:id==='lost'?'9789026997471':'9780306406157',
  status:'available',borrowedBy:null,borrowedByClassId:null,...attrs,
});
fs.writeFileSync(dbPath,JSON.stringify({
  books:[book('claimed'),book('lost',{catalogHidden:true}),
    book('assigned',{borrowedBy:'student'})],
  students:[{id:'student',name:'Test Leerling',username:'leerling',
    passwordHash:sha('leerling-pass'),classIds:['old'],
    borrowedBooks:[{bookId:'claimed'}],active:true}],
  classes:[{id:'old',name:'Oude klas',studentIds:[],teacherIds:[]},
    {id:'new',name:'Nieuwe klas',studentIds:['student'],teacherIds:['teacher']}],
  users:[{id:'admin',name:'Beheer',role:'admin',username:'admin',
    passwordHash:sha('admin-pass')},
    {id:'teacher',name:'Mentor',role:'teacher',username:'teacher',
      passwordHash:sha('teacher-pass')}],
  history:[],folders:[],
}));
const proc=spawn(process.execPath,['server.js'],{
  cwd:root,
  env:{...process.env,PORT:String(port),BOEKENBAAI_DATA_PATH:dbPath,
    BOEKENBAAI_STATIC_DIR:path.join(root,'public')},
  stdio:['ignore','pipe','pipe'],
});
async function run() {
  try {
    await new Promise((resolve,reject)=>{
      let finished=false;
      const timeout=setTimeout(()=>done(Error('Server startup timeout')),18000);
      function done(err){if(finished)return;finished=true;clearTimeout(timeout);err?reject(err):resolve();}
      proc.stdout.on('data',data=>{
        if(String(data).includes('http://localhost:'+port))done();
      });
      proc.once('exit',code=>done(Error('Server exited '+code)));
    });
    const request=async(route,method='GET',body,token)=>{
      const res=await fetch('http://127.0.0.1:'+port+route,{
        method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
          ...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
      });
      return {status:res.status,data:await res.json()};
    };
    const admin=await request('/api/login','POST',{username:'admin',password:'admin-pass'});
    assert.equal(admin.status,200,JSON.stringify(admin.data));
    const teacher=await request('/api/login','POST',{username:'teacher',password:'teacher-pass'});
    assert.equal(teacher.status,200,JSON.stringify(teacher.data));
    const pupil=await request('/api/login','POST',{username:'leerling',password:'leerling-pass'});
    assert.equal(pupil.status,200,JSON.stringify(pupil.data));
    const a=admin.data.token,t=teacher.data.token,p=pupil.data.token;
    const catalog=await request('/api/books');
    assert.equal(catalog.status,200);
    assert.deepEqual(catalog.data.map(b=>b.id).sort(),['assigned','claimed']);
    assert.equal(catalog.data.find(b=>b.id==='claimed').status,'borrowed');
    assert.equal(catalog.data.find(b=>b.id==='assigned').status,'borrowed');
    assert.equal(catalog.data.find(b=>b.id==='assigned').borrowedBy,undefined);
    assert.equal((await request('/api/books/lost')).status,404);
    assert.equal((await request('/api/books/lost','GET',null,t)).status,404);
    const adminCatalog=await request('/api/books','GET',null,a);
    assert.equal(adminCatalog.data.find(b=>b.id==='lost').catalogHidden,true);
    assert.equal((await request('/api/books/lost','GET',null,a)).status,200);
    assert.equal((await request('/api/books/barcode/9789026997471')).status,404);
    assert.equal((await request('/api/books/barcode/9789026997471','GET',null,t)).status,404);
    const me=await request('/api/me','GET',null,p);
    assert.deepEqual(me.data.classIds,['new']);
    const management=await request('/api/staff/loans','GET',null,t);
    assert.deepEqual(management.data.students[0].classIds,['new']);
    assert.equal(management.data.books.some(b=>b.id==='lost'),false);
    assert.equal(management.data.books.find(b=>b.id==='claimed').status,'borrowed');
    assert.equal((await request('/api/admin/inventory-consistency')).status,401);
    assert.equal((await request('/api/admin/inventory-consistency','GET',null,t)).status,403);
    const audit=await request('/api/admin/inventory-consistency','GET',null,a);
    assert.equal(audit.status,200);
    assert.equal(audit.data.summary.booksWithConflicts>=2,true);
    assert.ok(audit.data.entries.find(b=>b.bookId==='claimed').reasons.includes('status_available_but_student_loan'));
    const originalDb=fs.readFileSync(dbPath,'utf8');
    await request('/api/admin/inventory-consistency','GET',null,a);
    assert.equal(fs.readFileSync(dbPath,'utf8'),originalDb,'Audit cannot alter loan data');
    // Admin uses the existing book edit endpoint to restore a missing copy.
    const update=await request('/api/books/lost','PUT',{catalogHidden:false},a);
    assert.equal(update.status,200,JSON.stringify(update.data));
    assert.equal((await request('/api/books')).data.some(b=>b.id==='lost'),true);
    const hide=await request('/api/books/lost','PUT',{catalogHidden:true},a);
    assert.equal(hide.status,200,JSON.stringify(hide.data));
    assert.equal((await request('/api/books')).data.some(b=>b.id==='lost'),false);
    assert.equal((await request('/api/books/lost','PUT',{catalogHidden:false},t)).status,403);
    console.log('Urgent HTTP: admin hidden/restored books, teacher/student privacy, accurate loan availability, roster mapping, read-only audit and authorization OK');
  }finally{
    proc.kill('SIGINT');
    if(proc.exitCode===null)await new Promise(resolve=>proc.once('exit',resolve));
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
