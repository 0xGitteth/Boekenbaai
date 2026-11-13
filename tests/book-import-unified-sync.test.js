'use strict';
const assert=require('node:assert/strict');
const {
  normalizeParts,virtualId,buildUnifiedBookImport,actualAssignmentPreview,
}=require('../book-import-unified-sync');
const ISBN='9780306406157',SECOND='9780439554930';
const source=(index,context={},extra={},provenance={})=>({
  index,sourceRowNumber:index+2,status:'ready',
  book:{title:'Oorlogswinter',author:'Jan Terlouw',
    editionIsbn:ISBN,metadataIsbn:ISBN,barcode:'',
    quantity:{valid:true,value:1},...extra},
  context,provenance,
});
const copy=(id,extra={})=>({
  id,title:'Oorlogswinter',author:'Jan Terlouw',
  metadataIsbn:ISBN,editionIsbn:ISBN,barcode:'471100'+id.slice(-1),
  status:'available',borrowedBy:null,borrowedByClassId:null,
  fixedLocation:null,description:'Bestaande beschrijving',
  ...extra,
});
const db=()=>({
  books:[copy('copy-1',{status:'borrowed',borrowedBy:'lisa'}),
    copy('copy-2')],
  students:[{id:'lisa',name:'Lisa Leerling',borrowedBooks:[{bookId:'copy-1'}]},
    {id:'tim',name:'Tim Leerling',borrowedBooks:[]}],
  classes:[{id:'a',name:'Klas A'}],
  history:[],readingRecords:[],
});
const loan=(id,name)=>({studentLoan:{status:'matched',id,name}});
const parts=(other={})=>({books:false,loans:false,locations:false,fields:{},...other});
const plan=(sourceRows,database,options={})=>
  buildUnifiedBookImport({ok:true,rows:sourceRows},database,options);

assert.equal(normalizeParts({books:false,loans:false,locations:false,fields:{}}).ok,false);
assert.equal(normalizeParts({books:false,loans:false,locations:false,fields:{coverUrl:true}}).ok,true);
assert.equal(normalizeParts({books:true,loans:false,locations:false,fields:{coverUrl:'yes'}}).ok,false);
assert.equal(normalizeParts({books:true,loans:true,locations:true,fields:{mystery:true}}).ok,false);
assert.equal(normalizeParts(undefined).value.books,true);

{
  const current=db();
  const loanOnly=plan([source(0,loan('tim','Tim Leerling'))],current,
    {parts:parts({loans:true})});
  assert.equal(loanOnly.ok,true);
  assert.equal(loanOnly.summary.newCopies,0);
  assert.equal(loanOnly.summary.proposedLoans,1);
  assert.equal(loanOnly.assignments.differences[0].bookId,'copy-2');
  assert.equal(loanOnly.assignments.differences[0].choice,'apply');
  assert.equal(loanOnly.summary.readyToApply,true);
  assert.equal(current.books[0].borrowedBy,'lisa',
    'A preview never mutates live loans');
  const blank=plan([source(0)],current,{parts:parts({loans:true})});
  assert.equal(blank.summary.proposedLoans,0);
  assert.equal(blank.summary.readyToApply,false);
  assert.equal(current.books[0].borrowedBy,'lisa');
  const disabled=plan([source(0,loan('tim','Tim Leerling'))],current,
    {parts:parts({locations:true})});
  assert.equal(disabled.summary.proposedLoans,0);
}
{
  const current=db();
  const fixed=plan([source(0,{
    fixedLocation:{status:'resolved',label:'Klas A'},
    ...loan('tim','Tim Leerling'),
  })],current,{parts:parts({locations:true})});
  assert.equal(fixed.ok,true);
  assert.equal(fixed.summary.proposedLoans,0,'Loans are unchecked');
  assert.equal(fixed.summary.proposedLocations,1);
  assert.equal(fixed.assignments.differences[0].bookId,'copy-2');
  assert.equal(current.books[1].fixedLocation,null);
}
{
  const current=db();
  const description=source(0,{},{
    description:'Nieuwe tekst',coverUrl:'https://new.example/cover.png',
  },{
    description:{source:'excel',raw:'Nieuwe tekst'},
    coverUrl:{source:'excel',raw:'https://new.example/cover.png'},
  });
  const metadataOnly=plan([description],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(metadataOnly.ok,true);
  assert.equal(metadataOnly.summary.metadataFields,1);
  assert.equal(metadataOnly.summary.newCopies,0);
  assert.equal(metadataOnly.metadata.updates[0].field,'description');
  assert.deepEqual(metadataOnly.metadata.updates[0].bookIds,['copy-1','copy-2']);
  assert.equal(metadataOnly.summary.readyToApply,true);
  const onlyCover=plan([description],current,{
    parts:parts({fields:{coverUrl:true}}),
  });
  assert.equal(onlyCover.metadata.updates[0].field,'coverUrl');
  assert.equal(onlyCover.metadata.updates.some(x=>x.field==='description'),false);
  const blankField=plan([source(0,{},{
    description:'Van online verrijking',
  },{description:{source:'metadata'}})],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(blankField.metadata.updates.length,0,
    'A selected column without an explicit Excel value stays unchanged');
  assert.equal(current.books[0].description,'Bestaande beschrijving');
}
{
  const current=db();
  const mk=(index,text)=>source(index,{},{
    description:text,
  },{description:{source:'excel',raw:text}});
  const conflicts=plan([mk(0,'Links'),mk(1,'Rechts')],current,
    {parts:parts({fields:{description:true}})});
  assert.equal(conflicts.ok,true);
  assert.equal(conflicts.summary.pendingMetadata,1);
  assert.equal(conflicts.summary.readyToApply,false);
  const accepted=plan([mk(0,'Links'),mk(1,'Rechts')],current,{
    parts:parts({fields:{description:true},locations:true}),
    metadataResolutions:[{id:ISBN+':description',action:'keep'}],
  });
  assert.equal(accepted.metadata.issues.length,0);
  assert.equal(accepted.metadata.updates.length,0);
  assert.equal(plan([mk(0,'Links')],current,{
    parts:parts({fields:{description:true}}),
    metadataResolutions:[{id:SECOND+':description',action:'keep'}],
  }).error,'stale_metadata_choice');
}
{
  const current=db();
  const moreOld=plan([source(0)],current,
    {parts:parts({books:true})});
  assert.equal(moreOld.ok,true);
  assert.equal(moreOld.summary.newCopies,0);
  assert.equal(moreOld.inventory.summary.acknowledgedEditions,1,
    'A smaller Excel total preserves existing copies without 1-by-1 decisions');
  const newBook=source(0,loan('tim','Tim Leerling'),{
    editionIsbn:SECOND,metadataIsbn:SECOND,title:'Harry Potter',author:'J.K. Rowling',
  });
  const combined=plan([newBook],current,{
    parts:parts({books:true,loans:true,locations:true}),
  });
  assert.equal(combined.ok,true);
  assert.equal(combined.summary.newCopies,1);
  assert.equal(combined.summary.proposedLoans,1);
  assert.equal(combined.assignments.differences[0].bookId,virtualId(0,0));
  const assigned=actualAssignmentPreview(combined.assignments,
    new Map([[0,[{id:'saved-copy'}]]]));
  assert.equal(assigned.differences[0].bookId,'saved-copy');
  assert.equal(current.books.length,2,'The virtual copy was never written to the database');
}
console.log('Unified import: independent checkboxes, virtual copies, metadata and no implicit deletions OK');
