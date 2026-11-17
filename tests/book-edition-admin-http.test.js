'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=4417;
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-editions-'));
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
    passwordHash:hash('admin-pass'),role:'admin'}],
  history:[],
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
    const bad=await call('/api/books/lijsters','PUT',{
      barcode:'9789001561330',editionIsbn:'9789001561330',
    },token);
    assert.equal(bad.status,400,'An ISBN with a wrong check digit must not be saved');
    const fixed=await call('/api/books/lijsters','PUT',{
      barcode:'9789001561383',editionIsbn:'9789001561383',
      publisher:'Wolters-Noordhoff',
    },token);
    assert.equal(fixed.status,200,JSON.stringify(fixed.data));
    assert.equal(fixed.data.book.editionIsbn,'9789001561383');
    assert.equal(fixed.data.book.barcode,'9789001561383');
    assert.equal(fixed.data.book.status,'borrowed');
    assert.equal(fixed.data.book.borrowedBy,'pupil-1');
    assert.equal(fixed.data.book.borrowedAt,'2026-11-01T10:00:00Z');
    const books=await call('/api/books');
    assert.equal(books.status,200);
    assert.equal(books.data.length,2,'Editing an edition cannot create or delete a copy');
    const lijsters=books.data.find(b=>b.id==='lijsters');
    const warendorf=books.data.find(b=>b.id==='warendorf');
    assert.equal(lijsters.editionIsbn,'9789001561383');
    assert.equal(warendorf.editionIsbn,'9789026997471');
    assert.equal(warendorf.barcode,'9789026997471');
    assert.equal(warendorf.publisher,'Van Holkema & Warendorf');
    assert.ok(lijsters.importProvenance?.fieldSources?.editionIsbn,
      'An explicitly corrected edition must have a manual source');
    assert.equal(lijsters.status,'borrowed');
    const conflict=await call('/api/books/lijsters','PUT',{
      editionIsbn:'9789001561383',
      metadataIsbn:'9789026997471',
    },token);
    assert.equal(conflict.status,400,
      'Conflicting official and metadata edition ISBNs must be rejected');
    const posted=await call('/api/books','POST',{
      title:'Het web',author:'Johan Heyink',
      barcode:'9789001561383',editionIsbn:'9789001561383',
      publisher:'Wolters-Noordhoff',quantity:1,
    },token);
    assert.equal(posted.status,201,JSON.stringify(posted.data));
    assert.equal(posted.data.book.editionIsbn,'9789001561383');
    assert.equal((await call('/api/books')).data.length,3);
    console.log('Admin edition correction: two publishers, exact ISBN, borrower and copy IDs preserved');
  }finally{
    server.kill('SIGINT');
    if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
run().catch(err=>{console.error(err);process.exitCode=1;});
