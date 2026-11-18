'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=4424;
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-safe-tasks-'));
const databasePath=path.join(temp,'db.json');
const hash=pass=>crypto.createHash('sha256').update(pass).digest('hex');
const book={id:'copy-1',title:'Testboek',author:'Auteur',
  barcode:'9780306406157',editionIsbn:'9780306406157',status:'available'};
const item=id=>({id,batchId:'batch-1',worksheetRow:2,
  title:'Testboek',author:'Auteur',editionIsbn:'9780306406157',
  excelIdentifier:'9780306406157',bookId:null,status:'open',revision:1});
fs.writeFileSync(databasePath,JSON.stringify({
  books:[book],students:[{id:'pupil',name:'Voorbeeldleerling',borrowedBooks:[]}],
  classes:[],folders:[],
  users:[{id:'admin',name:'Admin',username:'admin',
    passwordHash:hash('admin-pass'),role:'admin'},
    {id:'teacher',name:'Teacher',username:'teacher',
      passwordHash:hash('teacher-pass'),role:'teacher'}],
  history:[],bookImportDeferredBookChecks:[item('first'),item('duplicate')],
}));
const server=spawn(process.execPath,['server.js'],{
  cwd:root,env:{...process.env,PORT:String(PORT),
    BOEKENBAAI_DATA_PATH:databasePath,
    BOEKENBAAI_STATIC_DIR:path.join(root,'public')},
  stdio:['ignore','pipe','pipe'],
});
async function run(){
  try {
    await new Promise((resolve,reject)=>{
      let done=false;
      const timeout=setTimeout(()=>finish(Error('Server launch timeout')),20000);
      function finish(err){
        if(done)return;done=true;clearTimeout(timeout);
        if(err)reject(err);else resolve();
      }
      server.stdout.on('data',value=>{
        if(String(value).includes('http://localhost:'+PORT))finish();
      });
      server.once('exit',code=>finish(Error('Server exited '+code)));
    });
    const call=async(route,method='GET',body,token)=>{
      const response=await fetch('http://127.0.0.1:'+PORT+route,{
        method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
          ...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
      });
      return {status:response.status,data:await response.json()};
    };
    const login=await call('/api/login','POST',{username:'admin',password:'admin-pass'});
    assert.equal(login.status,200);
    const token=login.data.token;
    const teacher=await call('/api/login','POST',{username:'teacher',password:'teacher-pass'});
    assert.equal(teacher.status,200);
    const preview=(await call('/api/admin/task-preflight','GET',null,token)).data;
    assert.equal(preview.summary.automatic_candidate,1);
    const task=preview.tasks.find(x=>x.category==='automatic_candidate');
    const payload={
      confirm:true,scope:'verified_source_notification_duplicate',
      confirmation:'close_verified_duplicate_notifications',
      fingerprint:preview.fingerprint,
      taskIds:[task.id],revisions:[{id:task.id,revision:task.revision}],
      operationId:crypto.randomUUID(),
    };
    const url='/api/admin/task-preflight/execute';
    const oldDb=fs.readFileSync(databasePath,'utf8');
    assert.equal((await call(url,'POST',payload)).status,401);
    assert.equal((await call(url,'POST',payload,teacher.data.token)).status,403);
    assert.equal((await call(url,'GET',null,token)).status,405);
    assert.equal((await call(url,'DELETE',null,token)).status,405);
    assert.equal((await call(url,'POST',{...payload,confirm:false},token)).status,400);
    assert.equal((await call(url,'POST',{...payload,revisions:[{id:task.id,revision:2}]},token)).status,409);
    assert.equal(fs.readFileSync(databasePath,'utf8'),oldDb,
      'Unauthorised/invalid requests must not commit a database write');
    const completed=await call(url,'POST',payload,token);
    assert.equal(completed.status,200,JSON.stringify(completed.data));
    assert.equal(completed.data.closed,1);
    assert.equal(completed.data.replayed,false);
    const changed=JSON.parse(fs.readFileSync(databasePath,'utf8'));
    assert.equal(changed.books.length,1);
    assert.equal(changed.books[0].id,'copy-1');
    assert.equal(changed.books[0].status,'available');
    assert.equal(changed.students[0].borrowedBooks.length,0);
    assert.equal(changed.bookImportDeferredBookChecks.find(t=>t.id==='first').status,'open');
    assert.equal(changed.bookImportDeferredBookChecks.find(t=>t.id==='duplicate').status,'completed');
    assert.equal(changed.taskAutoClosureHistory.length,1);
    assert.equal(changed.taskAutoClosureOperations.length,1);
    const saved=fs.readFileSync(databasePath,'utf8');
    const retry=await call(url,'POST',payload,token);
    assert.equal(retry.status,200);
    assert.equal(retry.data.replayed,true);
    assert.equal(fs.readFileSync(databasePath,'utf8'),saved,
      'Retry with same operation ID must not write a second time');
    assert.equal((await call(url,'POST',{...payload,operationId:crypto.randomUUID()},token)).status,409);
    const history=await call('/api/admin/task-preflight/history','GET',null,token);
    assert.equal(history.status,200);
    assert.equal(history.data.total,1);
    assert.equal(history.data.entries.length,1);
    assert.equal((await call('/api/admin/task-preflight/history','GET',null,teacher.data.token)).status,403);
    assert.equal((await call('/api/admin/task-preflight/history')).status,401);
    const next=await call('/api/admin/task-preflight','GET',null,token);
    assert.equal(next.data.summary.automaticallyResolved,1);
    assert.equal(next.data.summary.automatic_candidate,0);
    console.log('HTTP safe task cleanup: fresh proof, authorization, audit, idempotent retry, history, no physical/loan/people mutation OK');
  } finally {
    server.kill('SIGINT');
    if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
