'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=4423;
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-preflight-'));
const databasePath=path.join(temp,'db.json');
const hash=pass=>crypto.createHash('sha256').update(pass).digest('hex');
fs.writeFileSync(databasePath,JSON.stringify({
  books:[
    {id:'lijsters',title:'Het web',author:'Johan Heyink',
      barcode:'9789001561330',editionIsbn:'',metadataIsbn:'',
      publisher:'Wolters-Noordhoff',status:'borrowed',
      borrowedBy:'pupil-1',borrowedAt:'2026-11-01T10:00:00Z'},
    {id:'warendorf',title:'Het web',author:'Johan Heyink',
      barcode:'9789026997471',editionIsbn:'9789026997471',
      metadataIsbn:'',publisher:'Van Holkema & Warendorf',status:'available'},
  ],
  students:[{id:'pupil-1',name:'Test leerling',borrowedBooks:[{bookId:'lijsters'}]}],
  classes:[],folders:[],
  users:[{id:'admin',name:'Admin',username:'admin',
    passwordHash:hash('admin-pass'),role:'admin'}, {id:'teacher',name:'Teacher',username:'teacher',passwordHash:hash('teacher-pass'),role:'teacher'}],
  history:[],bookImportDeferredBookChecks:[{id:'task-1',batchId:'r1',worksheetRow:1,status:'open',title:'Het web',author:'Johan Heyink',editionIsbn:'9789026997471'}],
}));
const server=spawn(process.execPath,['server.js'],{
  cwd:root,
  env:{...process.env,PORT:String(PORT),BOEKENBAAI_DATA_PATH:databasePath,
    BOEKENBAAI_STATIC_DIR:path.join(root,'public')},
  stdio:['ignore','pipe','pipe'],
});
async function run(){
  try{
    await new Promise((resolve,reject)=>{
      let done=false;
      const timeout=setTimeout(()=>finish(new Error('Server launch timeout')),15000);
      const finish=err=>{
        if(done)return;done=true;clearTimeout(timeout);
        if(err)reject(err);else resolve();
      };
      server.stdout.on('data',data=>{
        if(String(data).includes('http://localhost:'+PORT))finish();
      });
      server.once('exit',code=>finish(Error('Server exited '+code)));
    });
    async function call(url,method='GET',body,token){
      const response=await fetch('http://127.0.0.1:'+PORT+url,{
        method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
          ...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
      });
      return {status:response.status,data:await response.json()};
    }
    const login=await call('/api/login','POST',{
      username:'admin',password:'admin-pass'});
    assert.equal(login.status,200,JSON.stringify(login.data));
    const token=login.data.token;
    const teacherLogin=await call('/api/login','POST',{username:'teacher',password:'teacher-pass'});
    assert.equal((await call('/api/admin/task-preflight','GET',undefined,teacherLogin.data.token)).status,403);
    const before=fs.readFileSync(databasePath,'utf8');
    assert.equal((await call('/api/admin/task-preflight')).status,401);
    const preview=await call('/api/admin/task-preflight','GET',undefined,token);
    assert.equal(preview.status,200,JSON.stringify(preview.data));
    assert.equal(preview.data.mode,'preview');
    assert.equal(preview.data.writesAllowed,false);
    assert.equal(preview.data.summary.open,1);
    assert.equal(preview.data.tasks[0].rule,'edition_found_copy_unproven');
    assert.equal((await call('/api/admin/task-preflight','POST',{confirm:true},token)).status,405);
    assert.equal((await call('/api/admin/task-preflight','DELETE',undefined,token)).status,405);
    assert.equal(fs.readFileSync(databasePath,'utf8'),before,'GET and rejected writes leave DB byte-identical');
    const next=await call('/api/admin/task-preflight','GET',undefined,token);
    assert.equal(next.data.fingerprint,preview.data.fingerprint);
    console.log('Task preflight HTTP: authentication, read-only route, stable fresh assessment, byte-identical database OK');
  }finally{
    server.kill('SIGINT');
    if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
run().catch(err=>{console.error(err);process.exitCode=1;});
