'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const XLSX=require('xlsx');

const port=4086,base='http://127.0.0.1:'+port;
const ISBN1='9780306406157',ISBN2='9780140328721';
const pwd=p=>crypto.createHash('sha256').update(p).digest('hex');
async function call(route,token,body){
  const res=await fetch(base+route,{
    method:body===undefined?'GET':'POST',
    headers:{...(token?{Authorization:'Bearer '+token}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  return {status:res.status,body:await res.json()};
}
function excel(rows){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Bibliotheek');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}).toString('base64');
}
async function ready(child){
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Timed out starting server')),12000);
    const onData=chunk=>{
      if(chunk.toString().includes('http://localhost:'+port)){
        clearTimeout(timeout);child.stdout.off('data',onData);resolve();
      }
    };
    child.stdout.on('data',onData);
    child.once('exit',code=>{clearTimeout(timeout);reject(Error('Server stopped '+code));});
  });
}
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-admin-corrections-'));
  const dbFile=path.join(dir,'db.json');
  const original={
    books:[
      {id:'copy-a',title:'Eerste boek',author:'Auteur A',barcode:'10001',
        editionIsbn:ISBN1,metadataIsbn:ISBN1,status:'borrowed',
        borrowedBy:'s1',borrowedByClassId:null,
        borrowedAt:'2026-11-01T10:00:00.000Z',description:'Al verrijkt',
        localCoverUrl:'/api/covers/'+'a'.repeat(64)+'.jpg'},
      {id:'copy-b',title:'Tweede boek',author:'Auteur B',barcode:'10002',
        editionIsbn:ISBN2,metadataIsbn:ISBN2,status:'borrowed',
        borrowedBy:'s1',borrowedByClassId:null},
    ],
    students:[
      {id:'s1',name:'Lisa',username:'lisa',active:true,
        borrowedBooks:[{bookId:'copy-a',borrowedAt:'2026-11-01T10:00:00.000Z'},
          {bookId:'copy-b',borrowedAt:null}]},
      {id:'s2',name:'Tim',username:'tim',active:true,borrowedBooks:[]},
    ],
    classes:[{id:'cl1',name:'Klas A',studentIds:['s1','s2'],teacherIds:[]}],
    users:[{id:'admin',name:'Beheerder',username:'admin',passwordHash:pwd('wachtwoord'),role:'admin'}],
    folders:[],history:[],readingRecords:[],
  };
  fs.writeFileSync(dbFile,JSON.stringify(original));
  const child=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..'),stdio:['ignore','pipe','pipe'],
    env:{...process.env,PORT:String(port),BOEKENBAAI_DATA_PATH:dbFile,
      BOEKENBAAI_STATIC_DIR:path.join(__dirname,'..','public')},
  });
  try{
    await ready(child);
    const auth=await call('/api/login',null,{username:'admin',password:'wachtwoord'});
    assert.equal(auth.status,200);
    const token=auth.body.token;
    const data=excel([
      {Titel:'Eerste boek',Auteur:'Auteur A','ISBN-nummer':ISBN1,
        'Fysieke barcode':'10001','Naam leerling':'Tim',Aantal:1},
      {Titel:'Tweede boek',Auteur:'Auteur B','ISBN-nummer':ISBN2,
        'Fysieke barcode':'10002','Naam leerling':'',Aantal:1},
    ]);
    const rejected=await call('/api/admin/book-import-stages',token,{
      file:data,fileName:'proef.xlsx',mode:'assignment_reconcile',enrichIsbn:true,
    });
    assert.equal(rejected.status,400,'Correction mode must not call paid/free enrichment');

    const prepared=await call('/api/admin/book-import-stages',token,{
      file:data,fileName:'proef.xlsx',mode:'assignment_reconcile',enrichIsbn:false,
    });
    assert.equal(prepared.status,201,JSON.stringify(prepared.body).slice(0,700));
    assert.equal(prepared.body.mode,'assignment_reconcile');
    assert.equal(prepared.body.decisions.summary.readyToApply,false);
    const differences=prepared.body.decisions.differences;
    assert.equal(differences.length,2,JSON.stringify(differences));
    const loanChange=differences.find(d=>d.bookId==='copy-a');
    const blankChange=differences.find(d=>d.bookId==='copy-b');
    assert.equal(loanChange.after.id,'s2');
    assert.equal(blankChange.blankSource,true);
    assert.equal(JSON.parse(fs.readFileSync(dbFile,'utf8')).books[0].borrowedBy,'s1',
      'Preview does not mutate the DB');

    const rejectedApply=await call('/api/admin/book-import-stages/'+prepared.body.id+'/apply',
      token,{revision:prepared.body.revision,confirm:true});
    assert.equal(rejectedApply.status,409,'Cannot apply a preview with undecided differences');

    // A rejected apply intentionally closes that draft. Start a new review
    // instead of retrying an unsafe saved preview.
    const freshStage=await call('/api/admin/book-import-stages',token,{
      file:data,fileName:'proef.xlsx',mode:'assignment_reconcile',enrichIsbn:false,
    });
    assert.equal(freshStage.status,201);
    const reviewed=await call('/api/admin/book-import-stages/'+freshStage.body.id+'/review',
      token,{revision:freshStage.body.revision,acceptWarnings:true,corrections:[],
        assignmentResolutions:[
          {id:loanChange.id,action:'apply'},
          {id:blankChange.id,action:'keep'},
        ]});
    assert.equal(reviewed.status,200,JSON.stringify(reviewed.body).slice(0,650));
    assert.equal(reviewed.body.decisions.summary.readyToApply,true);
    const applied=await call('/api/admin/book-import-stages/'+freshStage.body.id+'/apply',
      token,{revision:reviewed.body.revision,confirm:true});
    assert.equal(applied.status,200,JSON.stringify(applied.body).slice(0,650));
    assert.equal(applied.body.result.corrected,1);
    const after=JSON.parse(fs.readFileSync(dbFile,'utf8'));
    assert.equal(after.books.length,2);
    assert.equal(after.books.find(x=>x.id==='copy-a').borrowedBy,'s2');
    assert.equal(after.books.find(x=>x.id==='copy-b').borrowedBy,'s1',
      'Blank worksheet fields never end an existing loan without approval');
    assert.equal(after.students.find(x=>x.id==='s1').borrowedBooks.length,1);
    assert.equal(after.students.find(x=>x.id==='s2').borrowedBooks.length,1);
    assert.equal(after.books[0].description,'Al verrijkt','Enriched data must survive');
    assert.equal(after.books[0].localCoverUrl,original.books[0].localCoverUrl);
    assert.deepEqual(after.readingRecords,[]);
    assert.equal(after.bookAssignmentCorrectionLog.length,1);

    const repeat=await call('/api/admin/book-import-stages',token,{
      file:data,fileName:'proef.xlsx',mode:'assignment_reconcile',enrichIsbn:false,
    });
    assert.equal(repeat.status,201);
    assert.equal(repeat.body.decisions.differences.length,1,
      'Only the blank field on a still-borrowed copy remains a difference');
    assert.equal(repeat.body.decisions.differences[0].bookId,'copy-b',
      'Correctly registered borrowers do not generate new corrections');
    console.log('Corrected Excel import HTTP preview, decisions, persistence and safe repeat: OK');
  }finally{
    child.kill('SIGTERM');
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
