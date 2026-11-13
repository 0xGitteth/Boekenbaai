'use strict';
const assert=require('node:assert/strict');
const {
  normalizeParts,virtualId,buildUnifiedBookImport,actualAssignmentPreview,
}=require('../book-import-unified-sync');
const {excelLoanReceiptKey}=require('../book-import-loan-migration');
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
  const renamed=source(0,{},{
    title:'Oorlogswinter (nieuw)',author:'Nieuwe auteur',
    authors:['Nieuwe auteur'],
  },{
    title:{source:'excel',raw:'Oorlogswinter (nieuw)'},
    author:{source:'excel',raw:'Nieuwe auteur'},
  });
  const renamedEdition=plan([renamed],current,{
    parts:parts({books:true,fields:{title:true,author:true}}),
  });
  assert.equal(renamedEdition.ok,true);
  assert.equal(renamedEdition.summary.blockedStock,0,
    'Selected title/author changes are allowed without inventing another ISBN');
  assert.equal(renamedEdition.summary.metadataFields,2);
  const warning={...description,status:'warning'};
  const caution=plan([warning],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(caution.summary.pendingMetadata,1,
    'Selected metadata from a warning row needs approval before overwrite');
  const acceptedWarning=plan([warning],current,{
    parts:parts({fields:{description:true}}),acceptWarnings:true,
  });
  assert.equal(acceptedWarning.summary.metadataFields,1);
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
{
  const database=db();
  database.books[0].status='available';
  database.books[0].borrowedBy=null;
  database.students[0].borrowedBooks=[];
  const receipt=excelLoanReceiptKey('copy-1',{type:'student',id:'lisa'});
  const stale=plan([source(0,loan('lisa','Lisa Leerling'))],database,{
    parts:parts({loans:true}),loanReceipts:[receipt],
  });
  assert.equal(stale.ok,true);
  assert.equal(stale.summary.proposedLoans,0,
    'Reimporting an old worksheet cannot recreate a returned loan');
  assert.equal(stale.summary.previouslyImportedLoans,1);
  assert.equal(stale.assignments.differences[0].choice,'keep');
  assert.equal(stale.assignments.differences[0].previouslyImported,true);
  assert.equal(database.books[0].borrowedBy,null);
  // That earlier copy can now belong to another person. The same old
  // worksheet must not silently lend a different free copy to Lisa.
  database.books[0].borrowedBy='tim';
  database.books[0].status='borrowed';
  database.students[1].borrowedBooks=[{bookId:'copy-1'}];
  const relocated=plan([source(0,loan('lisa','Lisa Leerling'))],database,{
    parts:parts({loans:true}),loanReceipts:[receipt],
  });
  assert.equal(relocated.summary.proposedLoans,0,
    'Historical ISBN receipts protect returned loans across interchangeable copies');
  assert.equal(relocated.assignments.differences[0].bookId,'copy-2');
  assert.equal(relocated.assignments.differences[0].choice,'keep');
}
{
  const database=db();
  const later=plan([source(0,{
    fixedLocation:{status:'resolved',label:'Klas A'},
  },{barcode:'4711001'})],database,{
    parts:parts({locations:true}),
    assignmentResolutions:[{id:'0:location',action:'later'}],
  });
  assert.equal(later.ok,true);
  assert.equal(later.summary.deferred,1);
  assert.equal(later.summary.readyToApply,true,
    'A deferred-only review can be confirmed and saved as a task');
}
{
  const database=db();
  const excel=source(0,{},{
    description:'Nieuwe tekst',
  },{description:{source:'excel',raw:'Nieuwe tekst'}});
  const options={parts:parts({fields:{description:true}})};
  const first=plan([excel],database,options);
  assert.equal(first.ok,true);
  const before=first.metadata.updates[0].beforeValues;
  assert.equal(before[0].value,'Bestaande beschrijving');
  database.books[0].description='Later door beheer aangepast';
  const revised=plan([excel],database,options);
  assert.equal(revised.ok,true);
  assert.notDeepEqual(revised.metadata.updates[0].beforeValues,before,
    'A concurrent metadata edit must invalidate the stored preview');
  assert.notEqual(JSON.stringify(revised),JSON.stringify(first));
}
{
  const current=db();
  const renamedLoan=source(0,loan('tim','Tim Leerling'),{
    title:'Oorlogswinter, gecorrigeerde titel',
  },{title:{source:'excel',raw:'Oorlogswinter, gecorrigeerde titel'}});
  const sync=plan([renamedLoan],current,{
    parts:parts({books:true,loans:true,fields:{title:true}}),
  });
  assert.equal(sync.ok,true);
  assert.equal(sync.summary.blockedStock,0);
  assert.equal(sync.summary.proposedLoans,1,
    'Selecting a title correction must not block the simultaneous loan');
  assert.equal(sync.summary.metadataFields,1);
  assert.equal(sync.assignments.differences.find(d=>d.kind==='issue'),undefined);
}

{
  const current=db();
  // A former borrower from an old sheet must not replace the current
  // borrower of the very same physical book.
  const receipt=excelLoanReceiptKey('copy-1',{type:'student',id:'lisa'});
  current.books[0].borrowedBy='tim';
  current.books[0].status='borrowed';
  current.students[0].borrowedBooks=[];
  current.students[1].borrowedBooks=[{bookId:'copy-1'}];
  current.books.pop(); // no other free copies to use
  const restored=plan([source(0,loan('lisa','Lisa Leerling'))],current,{
    parts:parts({loans:true}),loanReceipts:[receipt],
  });
  assert.equal(restored.ok,true);
  assert.equal(restored.summary.proposedLoans,0,
    'An old workbook must not replace Tim with its former borrower Lisa');
  assert.equal(restored.assignments.differences[0].choice,'keep');
  assert.equal(restored.summary.previouslyImportedLoans,1);
}
{
  const current=db();
  const correction=source(0,{},{
    description:'Door beheer gecorrigeerd',title:'Gecorrigeerde titel',
  },{
    description:{source:'manual',detail:'review_correction'},
    title:{source:'manual',detail:'review_correction'},
  });
  const updated=plan([correction],current,{
    parts:parts({fields:{description:true,title:true}}),
  });
  assert.equal(updated.ok,true);
  assert.deepEqual(updated.metadata.updates.map(d=>d.field).sort(),
    ['description','title'],'Explicit review corrections must be applied');
  const enriched=plan([source(0,{},{
    description:'Automatisch gevonden tekst',
  },{description:{source:'metadata',detail:'enrichment'}})],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(enriched.metadata.updates.length,0);
}
{
  const current=db();
  for(const field of ['publishedYear','pageCount']){
    current.books[0][field]=field==='publishedYear'?2001:100;
    const invalid=source(0,{},{
      [field]:null,
    },{[field]:{source:'excel',raw:'onbekend'}});
    invalid.status='warning';
    const predicted=plan([invalid],current,{
      parts:parts({fields:{[field]:true}}),acceptWarnings:true,
    });
    assert.equal(predicted.ok,true);
    assert.equal(predicted.summary.metadataFields,0,
      'Invalid numeric Excel cells may never clear saved '+field);
    assert.equal(predicted.summary.pendingMetadata,1);
  }
}
console.log('Unified import: independent checkboxes, virtual copies, metadata and no implicit deletions OK');
