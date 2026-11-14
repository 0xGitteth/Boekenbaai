'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const XLSX=require('xlsx');
const PORT=4059,BASE='http://127.0.0.1:'+PORT;
const ISBN='9780306406157',SECOND='9780439554930';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function workbook(rows){
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'Boeken');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64');
}
async function call(url,token,body){
  const response=await fetch(BASE+url,{
    method:body?'POST':'GET',
    headers:{...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  return {status:response.status,data:await response.json()};
}
async function waitForServer(child){
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString().slice(-5000);});
  for(let n=0;n<120;n++){
    if(child.exitCode!==null)throw Error('Server exited '+stderr);
    try{if((await fetch(BASE+'/api/health')).status)return;}catch{}
    await wait(80);
  }
  throw Error('Server timed out: '+stderr);
}
function original(){
  return {
    books:[
      {id:'copy-1',title:'Oorlogswinter',author:'Jan Terlouw',
        editionIsbn:ISBN,metadataIsbn:ISBN,barcode:'4711001',
        status:'borrowed',borrowedBy:'lisa',borrowedByClassId:null,
        borrowedAt:'2026-10-05T11:00:00Z',dueDate:'2026-11-12',
        description:'Bestaande beschrijving',coverUrl:'https://example.org/old.jpg',
        localCoverUrl:'/api/covers/'+('a'.repeat(64))+'.jpg',
        coverCrop:{enabled:true,x:10,y:80,zoom:2.5},
        fixedLocation:null},
      {id:'copy-2',title:'Oorlogswinter',author:'Jan Terlouw',
        editionIsbn:ISBN,metadataIsbn:ISBN,barcode:'4711002',
        status:'available',borrowedBy:null,borrowedByClassId:null,
        description:'Bestaande beschrijving',coverUrl:'https://example.org/old.jpg',
        fixedLocation:null},
    ],
    students:[
      {id:'lisa',name:'Lisa Leerling',username:'lisa',
        borrowedBooks:[{bookId:'copy-1',borrowedAt:'2026-10-05T11:00:00Z'}]},
      {id:'tim',name:'Tim Leerling',username:'tim',borrowedBooks:[]},
    ],
    classes:[{id:'a',name:'Klas A',teacherIds:[],studentIds:[]}],
    users:[{id:'admin',name:'Beheerder',username:'admin',role:'admin',
      passwordHash:crypto.createHash('sha256').update('password').digest('hex')}],
    history:[{id:'before',type:'check_out',bookId:'copy-1'}],
    readingRecords:[{id:'read',subjectId:'lisa',bookId:'copy-1',finished:true,
      subjectType:'student'}],
  };
}
async function run(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-unified-'));
  const file=path.join(dir,'db.json');
  fs.writeFileSync(file,JSON.stringify(original()));
  const server=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..'),
    env:{...process.env,PORT:String(PORT),BOEKENBAAI_DATA_PATH:file},
    stdio:['ignore','pipe','pipe'],
  });
  try {
    await waitForServer(server);
    const login=await call('/api/login','',{username:'admin',password:'password'});
    assert.equal(login.status,200,JSON.stringify(login.data));
    const token=login.data.token;
    const readDb=()=>JSON.parse(fs.readFileSync(file,'utf8'));
    const parts=(enabled={})=>({books:false,loans:false,locations:false,fields:{},...enabled});
    const old=(who,extra={})=>({
      Titel:'Oorlogswinter',Auteur:'Jan Terlouw','ISBN-nummer':ISBN,
      Aantal:1,Beschrijving:'Nieuwe beschrijving',
      ...((who)?{'Naam leerling':who}:{}),...extra,
    });
    async function start(rows,choices){
      return call('/api/admin/book-import-stages',token,{
        mode:'unified_sync',syncParts:choices,enrichIsbn:false,
        fileName:'boekensynchronisatie.xlsx',file:workbook(rows),
      });
    }
    async function review(stage,metadataChoices=[]){
      return call('/api/admin/book-import-stages/'+stage.data.id+'/review',token,{
        revision:stage.data.revision,corrections:[],acceptWarnings:true,
        inventoryResolutions:[],assignmentResolutions:[],
        metadataResolutions:metadataChoices,
      });
    }
    async function apply(stage){
      return call('/api/admin/book-import-stages/'+stage.data.id+'/apply',token,{
        revision:stage.data.revision,confirm:true,
      });
    }
    const rows=[
      old('Lisa Leerling'),
      old('Tim Leerling',{'Vast in de klas van:':'Klas A'}),
      {Titel:'Harry Potter en de Steen der Wijzen',Auteur:'J.K. Rowling',
        'ISBN-nummer':SECOND,Aantal:1,'Vast in de klas van:':'Klas A',
        'Naam leerling':'Lisa Leerling'},
    ];
    const selection=parts({books:true,loans:true,locations:true,
      fields:{description:true}});
    const stage=await start(rows,selection);
    assert.equal(stage.status,201,JSON.stringify(stage.data));
    assert.equal(stage.data.mode,'unified_sync');
    assert.equal(stage.data.syncParts.fields.description,true);
    assert.equal(stage.data.decisions.summary.newCopies,1);
    assert.equal(stage.data.decisions.summary.proposedLoans,2,
      'Existing and newly added books can receive loans in the same import');
    assert.equal(stage.data.decisions.summary.proposedLocations,1);
    assert.equal(stage.data.decisions.summary.metadataFields,1);
    assert.equal(stage.data.decisions.metadata.updates[0].copies,2);
    assert.equal(readDb().books.length,2,'Preview cannot create real books');

    const reviewed=await review(stage);
    assert.equal(reviewed.status,200,JSON.stringify(reviewed.data));
    assert.equal(reviewed.data.decisions.summary.readyToApply,true,
      JSON.stringify(reviewed.data.decisions.summary));
    const applied=await apply(reviewed);
    assert.equal(applied.status,200,JSON.stringify(applied.data));
    assert.equal(applied.data.result.created,1);
    assert.equal(applied.data.result.correctedLoans,2);
    assert.equal(applied.data.result.correctedLocations,1);
    assert.equal(applied.data.result.metadataUpdated,2);
    assert.equal(applied.data.result.report.mode,'unified_sync');
    const saved=readDb();
    assert.equal(saved.books.length,3);
    const lisa=saved.books.find(book=>book.id==='copy-1');
    const tim=saved.books.find(book=>book.id==='copy-2');
    assert.equal(lisa.borrowedBy,'lisa');
    assert.equal(lisa.borrowedAt,'2026-10-05T11:00:00Z',
      'An unchanged old loan retains its historical checkout date');
    assert.equal(tim.borrowedBy,'tim');
    assert.equal(tim.fixedLocation,'Klas A');
    assert.equal(lisa.description,'Nieuwe beschrijving');
    const lisaReceipt=crypto.createHash('sha256')
      .update(JSON.stringify(['copy-1','student','lisa'])).digest('hex');
    assert.ok(saved.bookImportLoanReceipts?.includes(lisaReceipt),
      'A verified existing loan must receive a durable receipt for future reuploads');
    assert.equal(tim.description,'Nieuwe beschrijving');
    const newBook=saved.books.find(book=>book.editionIsbn===SECOND);
    assert.ok(newBook,'The missing ISBN was created in the same transaction');
    assert.equal(newBook.fixedLocation,'Klas A');
    assert.equal(newBook.borrowedBy,'lisa',
      'The temporary preview ID must be replaced by the new real copy ID');
    assert.ok(saved.students.find(s=>s.id==='lisa').borrowedBooks.some(
      entry=>entry.bookId===newBook.id));
    assert.equal(saved.students.find(s=>s.id==='tim').borrowedBooks[0].bookId,'copy-2');
    assert.equal(saved.readingRecords.length,1,'Old reading responses are untouched');

    const repeat=await start(rows,selection);
    assert.equal(repeat.status,201,JSON.stringify(repeat.data));
    assert.equal(repeat.data.decisions.summary.newCopies,0,
      'Re-upload must be idempotent, not create duplicate copies');
    assert.equal(repeat.data.decisions.summary.proposedLoans,0);
    assert.equal(repeat.data.decisions.summary.proposedLocations,0);
    assert.equal(repeat.data.decisions.summary.metadataFields,0);
    assert.equal((await call('/api/admin/book-import-stages/'+repeat.data.id+'/cancel',
      token,{revision:repeat.data.revision})).status,200);

    // Synchronizing exactly one metadata column cannot overwrite other
    // metadata, the stock, loans or locations.
    const coverOnly=await start([
      old('',{Omschrijving:'Andere omschrijving',
        Cover:'https://example.org/new-cover.jpg'}),
    ],parts({fields:{coverUrl:true}}));
    assert.equal(coverOnly.status,201,JSON.stringify(coverOnly.data));
    assert.equal(coverOnly.data.decisions.summary.newCopies,0);
    assert.equal(coverOnly.data.decisions.summary.proposedLoans,0);
    assert.equal(coverOnly.data.decisions.summary.proposedLocations,0);
    const coverReviewed=await review(coverOnly);
    assert.equal(coverReviewed.status,200,JSON.stringify(coverReviewed.data));
    assert.equal(coverReviewed.data.decisions.summary.metadataFields,1,
      'A recognized selected Cover column is updated on existing editions');
    const coverApplied=await apply(coverReviewed);
    assert.equal(coverApplied.status,200,JSON.stringify(coverApplied.data));
    assert.equal(coverApplied.data.result.metadataUpdated,2);
    assert.equal(readDb().books.length,3);
    assert.equal(readDb().books.find(book=>book.id==='copy-2').coverUrl,
      'https://example.org/new-cover.jpg');
    assert.equal(readDb().books.find(book=>book.id==='copy-1').localCoverUrl,'',
      'A changed cover URL cannot leave a stale cached cover in place');
    assert.equal(readDb().books.find(book=>book.id==='copy-1').coverCrop,null,
      'A replacement cover must not inherit the previous image crop');
    assert.equal(readDb().books.find(book=>book.id==='copy-1').description,
      'Nieuwe beschrijving');
    assert.equal(readDb().books.find(book=>book.id==='copy-1').borrowedBy,'lisa');

    // Noncanonical themes belong in importedThemes, not only manualThemes.
    const themeOnly=await start([
      {...old(''),["Thema's"]:'Nieuw thema uit metadata'},
    ],parts({fields:{manualThemes:true}}));
    assert.equal(themeOnly.status,201,JSON.stringify(themeOnly.data));
    const themeReviewed=await review(themeOnly);
    assert.equal(themeReviewed.status,200,JSON.stringify(themeReviewed.data));
    assert.equal(themeReviewed.data.decisions.summary.metadataFields,1);
    const themeApplied=await apply(themeReviewed);
    assert.equal(themeApplied.status,200,JSON.stringify(themeApplied.data));
    const themed=readDb().books.find(book=>book.id==='copy-1');
    assert.ok(themed.importedThemes.includes('Nieuw thema uit metadata'),
      'Freeform Excel themes must survive DB normalization');
    assert.ok(themed.themes.includes('Nieuw thema uit metadata'));
    // Deferring the only difference must still create a persistent review
    // task, even when no stock or immediate correction is selected.
    const deferOnly=await start([
      old('',{Barcode:'4711001','Vast in de klas van:':'Klas A'}),
    ],parts({locations:true}));
    assert.equal(deferOnly.status,201,JSON.stringify(deferOnly.data));
    assert.equal(deferOnly.data.decisions.assignments.differences[0].kind,'location');
    const reviewedDefer=await call(
      '/api/admin/book-import-stages/'+deferOnly.data.id+'/review',token,{
      revision:deferOnly.data.revision,corrections:[],acceptWarnings:true,
      inventoryResolutions:[],metadataResolutions:[],
      assignmentResolutions:[{id:'0:location',action:'later'}],
    });
    assert.equal(reviewedDefer.status,200,JSON.stringify(reviewedDefer.data));
    assert.equal(reviewedDefer.data.decisions.summary.readyToApply,true);
    const savedDefer=await apply(reviewedDefer);
    assert.equal(savedDefer.status,200,JSON.stringify(savedDefer.data));
    assert.equal(savedDefer.data.result.deferred,1);
    assert.equal(savedDefer.data.result.report.fullyReviewed,false,
      'Deferred-only unified import must NOT report completion');
    const report=await call('/api/admin/book-import-reports/'
      +savedDefer.data.result.batchId,token);
    assert.equal(report.status,200);
    assert.equal(report.data.fullyReviewed,false,
      'Report API must stay open while the administrative task is pending');
    assert.equal(readDb().books.find(b=>b.id==='copy-1').fixedLocation,null);
    const tasks=await call('/api/admin/book-import-assignment-tasks',token);
    assert.equal(tasks.status,200);
    assert.ok(tasks.data.tasks.some(task=>
      task.reportId===savedDefer.data.result.batchId),
      'Deferred-only unified imports must persist a task for later');
    const noParts=await start([old('Tim Leerling')],
      parts({fields:{}}));
    assert.equal(noParts.status,400);
    assert.equal(noParts.data.error,'no_sync_parts_selected');
    console.log('Unified HTTP import: one atomic confirmation, selected fields, repeat, and no silent deletion OK');
  }finally{
    server.kill('SIGTERM');
    await wait(50);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
