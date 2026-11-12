'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const XLSX=require('xlsx');
const PORT=4054,BASE='http://127.0.0.1:'+PORT;
const ISBN='9780306406157';
function workbook(rows){
  const w=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(rows),'Bibliotheek');
  return XLSX.write(w,{type:'buffer',bookType:'xlsx'}).toString('base64');
}
async function call(route,token,body){
  const response=await fetch(BASE+route,{
    method:body?'POST':'GET',
    headers:{...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  return {status:response.status,data:await response.json()};
}
async function waitServer(child){
  let errors='';
  child.stderr.on('data',chunk=>{errors+=chunk.toString().slice(-3000)});
  for(let i=0;i<120;i++){
    if(child.exitCode!==null)throw Error('Server exited: '+errors);
    try{
      const response=await fetch(BASE+'/api/health');
      if(response.status)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw Error('Server timeout: '+errors);
}
function data(){
  return {
    books:[{
      id:'copy-1',title:'Oorlogswinter',author:'Jan Terlouw',
      editionIsbn:ISBN,metadataIsbn:ISBN,barcode:'4711001',status:'borrowed',
      borrowedBy:'lisa',borrowedByClassId:null,
      borrowedAt:'2026-10-03T10:00:00.000Z',dueDate:'2026-10-24',
      coverUrl:'https://example.org/cover.jpg',description:'Bewaarde omschrijving',
      themes:['Oorlog'],
    }],
    students:[
      {id:'lisa',name:'Lisa Leerling',username:'lisa',
        borrowedBooks:[{bookId:'copy-1',borrowedAt:'2026-10-03T10:00:00.000Z'}]},
      {id:'tim',name:'Tim Leerling',username:'tim',borrowedBooks:[]},
    ],
    classes:[{id:'a',name:'Klas A',teacherIds:[],studentIds:[]}],
    users:[{id:'admin',name:'Beheerder',username:'admin',role:'admin',
      passwordHash:crypto.createHash('sha256').update('password').digest('hex')}],
    history:[{id:'old-loan',type:'check_out',bookId:'copy-1'}],
    readingRecords:[{id:'read',subjectId:'lisa',bookId:'copy-1',
      subjectType:'student',finished:true}],
  };
}
async function run(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-assignment-'));
  const file=path.join(dir,'db.json');
  fs.writeFileSync(file,JSON.stringify(data()));
  const server=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..'),
    env:{...process.env,PORT:String(PORT),BOEKENBAAI_DATA_PATH:file},
    stdio:['ignore','pipe','pipe'],
  });
  try{
    await waitServer(server);
    const login=await call('/api/login','',{username:'admin',password:'password'});
    assert.equal(login.status,200,JSON.stringify(login.data));
    const token=login.data.token;
    async function begin(rows,mode='assignment_reconcile',enrichIsbn=false){
      return call('/api/admin/book-import-stages',token,{
        mode,enrichIsbn,file:workbook(rows),fileName:'correcties.xlsx',
      });
    }
    const row=(loan)=>({
      Titel:'Oorlogswinter',Auteur:'Jan Terlouw','ISBN-nummer':ISBN,
      Barcode:'4711001',Aantal:1,...(loan?{'Naam leerling':loan}:{}),
    });
    const initial=await begin([row('Tim Leerling')]);
    assert.equal(initial.status,201,JSON.stringify(initial.data));
    assert.equal(initial.data.mode,'assignment_reconcile');
    assert.equal(initial.data.decisions.summary.differences,1);
    assert.equal(initial.data.decisions.differences[0].kind,'loan');
    assert.equal(initial.data.decisions.differences[0].before.id,'lisa');
    assert.equal(initial.data.decisions.differences[0].after.id,'tim');
    assert.equal(initial.data.decisions.summary.readyToApply,false);
    const unsafeApply=await call('/api/admin/book-import-stages/'+initial.data.id+'/apply',
      token,{revision:initial.data.revision,confirm:true});
    assert.equal(unsafeApply.status,409,'Never commit unanswered differences');

    // A rejected apply intentionally invalidates the old review session.
    // Upload again instead of accidentally reusing a failed approval.
    const retry=await begin([row('Tim Leerling')]);
    assert.equal(retry.status,201,JSON.stringify(retry.data));
    const reviewed=await call('/api/admin/book-import-stages/'+retry.data.id+'/review',
      token,{revision:retry.data.revision,corrections:[],acceptWarnings:true,
        assignmentResolutions:[{id:'0:loan',action:'apply'}]});
    assert.equal(reviewed.status,200,JSON.stringify(reviewed.data));
    assert.equal(reviewed.data.decisions.summary.readyToApply,true);
    const applied=await call('/api/admin/book-import-stages/'+retry.data.id+'/apply',
      token,{revision:reviewed.data.revision,confirm:true});
    assert.equal(applied.status,200,JSON.stringify(applied.data));
    assert.equal(applied.data.result.correctedLoans,1);
    const state=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(state.books.length,1);
    assert.equal(state.books[0].borrowedBy,'tim');
    assert.equal(state.books[0].description,'Bewaarde omschrijving');
    assert.equal(state.books[0].coverUrl,'https://example.org/cover.jpg');
    assert.equal(state.books[0].borrowedAt,null);
    assert.equal(state.students[0].borrowedBooks.length,0);
    assert.equal(state.students[1].borrowedBooks.length,1);
    assert.equal(state.history.filter(x=>x.type==='check_out').length,1);
    assert.equal(state.readingRecords.length,1);

    const noLoanExcel=await begin([row()]);
    assert.equal(noLoanExcel.status,201,JSON.stringify(noLoanExcel.data));
    assert.equal(noLoanExcel.data.decisions.summary.readyToApply,false);
    assert.equal(noLoanExcel.data.decisions.differences[0].blankSource,true);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).books[0].borrowedBy,'tim');
    const kept=await call('/api/admin/book-import-stages/'+noLoanExcel.data.id+'/review',
      token,{revision:noLoanExcel.data.revision,corrections:[],acceptWarnings:true,
        assignmentResolutions:[{id:'0:loan',action:'keep'}]});
    assert.equal(kept.status,200,JSON.stringify(kept.data));
    const keptApplied=await call('/api/admin/book-import-stages/'+noLoanExcel.data.id+'/apply',
      token,{revision:kept.data.revision,confirm:true});
    assert.equal(keptApplied.status,200,JSON.stringify(keptApplied.data));
    assert.equal(keptApplied.data.result.corrected,0);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).books[0].borrowedBy,'tim');

    // A postponed discrepancy must survive closing the import panel and
    // remain visible through the durable administrator report endpoint.
    const postponed=await begin([row()]);
    assert.equal(postponed.status,201,JSON.stringify(postponed.data));
    const invalidCorrection=await call(
      '/api/admin/book-import-stages/'+postponed.data.id+'/review',
      token,{revision:postponed.data.revision,corrections:[
        {index:0,fields:{quantity:'1000'}},
      ],acceptWarnings:true,assignmentResolutions:[{id:'0:loan',action:'later'}]});
    assert.equal(invalidCorrection.status,400,
      'Review API cannot reintroduce large quantities into correction mode');
    const later=await call('/api/admin/book-import-stages/'+postponed.data.id+'/review',
      token,{revision:postponed.data.revision,corrections:[],acceptWarnings:true,
        assignmentResolutions:[{id:'0:loan',action:'later'}]});
    assert.equal(later.status,200,JSON.stringify(later.data));
    const laterApplied=await call('/api/admin/book-import-stages/'+postponed.data.id+'/apply',
      token,{revision:later.data.revision,confirm:true});
    assert.equal(laterApplied.status,200,JSON.stringify(laterApplied.data));
    assert.equal(laterApplied.data.result.corrected,0);
    const report=await call('/api/admin/book-import-reports/'
      +laterApplied.data.result.batchId,token);
    assert.equal(report.status,200,JSON.stringify(report.data));
    assert.equal(report.data.fullyReviewed,false);
    assert.equal(report.data.deferredDifferences.length,1);
    assert.equal(report.data.deferredDifferences[0].bookId,'copy-1');
    assert.equal(report.data.deferredDifferences[0].before.id,'tim');
    assert.equal(report.data.deferredDifferences[0].worksheetRow,2);

    // The same apparent borrower state after circulation is not the same
    // historical loan period. The database ledger must make approval stale.
    const stale=await begin([row()]);
    assert.equal(stale.status,201,JSON.stringify(stale.data));
    const staleReviewed=await call('/api/admin/book-import-stages/'+stale.data.id+'/review',
      token,{revision:stale.data.revision,corrections:[],acceptWarnings:true,
        assignmentResolutions:[{id:'0:loan',action:'apply'}]});
    assert.equal(staleReviewed.status,200,JSON.stringify(staleReviewed.data));
    const changed=JSON.parse(fs.readFileSync(file,'utf8'));
    changed.bookImportLoanActivityCounters=changed.bookImportLoanActivityCounters||{};
    changed.bookImportLoanActivityCounters['copy-1']=
      (changed.bookImportLoanActivityCounters['copy-1']||0)+2;
    fs.writeFileSync(file,JSON.stringify(changed));
    const staleAttempt=await call('/api/admin/book-import-stages/'+stale.data.id+'/apply',
      token,{revision:staleReviewed.data.revision,confirm:true});
    assert.equal(staleAttempt.status,409,'Circulation revision must invalidate old decisions');
    assert.equal(staleAttempt.data.error,'assignment_preview_stale');
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).books[0].borrowedBy,'tim');

    const multiple=await begin([{...row(),Aantal:1000}]);
    assert.equal(multiple.status,400,
      'A large number of physical copies cannot be expanded during correction preview');
    assert.equal(multiple.data.error,'assignment_requires_single_copy');

    const rejected=await begin([row('Tim Leerling')],'assignment_reconcile',true);
    assert.equal(rejected.status,400,'Correction mode must never call metadata enrichment');
    // The Excel column "Klassen" needs a real classification choice, not
    // merely Keep/Later. Classifying it as a fixed location must never
    // return a book that is currently borrowed by a pupil.
    const postponedClass=await begin([{...row(),Klassen:'Klas A'}]);
    assert.equal(postponedClass.status,201,JSON.stringify(postponedClass.data));
    const postponedClassReviewed=await call(
      '/api/admin/book-import-stages/'+postponedClass.data.id+'/review',
      token,{revision:postponedClass.data.revision,corrections:[],acceptWarnings:true,
        assignmentResolutions:[{id:'0:class_context',action:'later'}]});
    assert.equal(postponedClassReviewed.status,200,JSON.stringify(postponedClassReviewed.data));
    const postponedClassApplied=await call(
      '/api/admin/book-import-stages/'+postponedClass.data.id+'/apply',
      token,{revision:postponedClassReviewed.data.revision,confirm:true});
    assert.equal(postponedClassApplied.status,200,JSON.stringify(postponedClassApplied.data));
    const laterClassReport=await call('/api/admin/book-import-reports/'
      +postponedClassApplied.data.result.batchId,token);
    assert.equal(laterClassReport.status,200,JSON.stringify(laterClassReport.data));
    assert.equal(laterClassReport.data.deferredDifferences[0].className,'Klas A');
    assert.equal(laterClassReport.data.deferredDifferences[0].beforeLoan.id,'tim');
    assert.equal(laterClassReport.data.deferredDifferences[0].kind,'class_context');
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).books[0].fixedLocation??null,null,
      'Later review must never change the fixed location');

    const classroom=await begin([{...row(),Klassen:'Klas A'}]);
    assert.equal(classroom.status,201,JSON.stringify(classroom.data));
    assert.equal(classroom.data.decisions.summary.classQuestions,1);
    assert.equal(classroom.data.decisions.summary.actualDifferences,0);
    assert.equal(classroom.data.decisions.differences.length,1);
    assert.equal(classroom.data.decisions.differences[0].kind,'class_context');
    assert.equal(classroom.data.decisions.differences[0].classId,'a');
    const classroomReviewed=await call(
      '/api/admin/book-import-stages/'+classroom.data.id+'/review',
      token,{revision:classroom.data.revision,corrections:[],acceptWarnings:true,
        assignmentResolutions:[{id:'0:class_context',action:'class_fixed'}]});
    assert.equal(classroomReviewed.status,200,JSON.stringify(classroomReviewed.data));
    assert.equal(classroomReviewed.data.decisions.summary.apply,1);
    const classroomSaved=await call(
      '/api/admin/book-import-stages/'+classroom.data.id+'/apply',
      token,{revision:classroomReviewed.data.revision,confirm:true});
    assert.equal(classroomSaved.status,200,JSON.stringify(classroomSaved.data));
    assert.equal(classroomSaved.data.result.correctedLocations,1);
    const afterLocation=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(afterLocation.books[0].fixedLocation,'Klas A');
    assert.equal(afterLocation.books[0].borrowedBy,'tim');
    assert.equal(afterLocation.books[0].status,'borrowed');
    assert.equal(afterLocation.readingRecords.length,1);
    const sameLocation=await begin([{...row(),Klassen:'Klas A'}]);
    assert.equal(sameLocation.status,201,JSON.stringify(sameLocation.data));
    assert.equal(sameLocation.data.decisions.summary.differences,0,
      'A confirmed matching class location must not be reported as another difference');

    const final=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(final.books.length,1);
    assert.equal(final.readingRecords.length,1);
    console.log('Administrative correction HTTP preview, explicit selection, and repeat import: OK');
  }finally{
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>server.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,3000))]);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
run().catch(e=>{console.error(e);process.exitCode=1});
