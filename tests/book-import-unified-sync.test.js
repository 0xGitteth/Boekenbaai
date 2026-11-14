'use strict';
const assert=require('node:assert/strict');
const {
  normalizeParts,virtualId,buildUnifiedBookImport,actualAssignmentPreview,assignmentSource,
  normalizedMetadataChoice,
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

{
  const current=db();
  const unmatched=source(0,{
    studentLoan:{status:'unmatched',name:'Onbekend'},
    fixedLocation:{status:'resolved',label:'Klas A'},
  },{barcode:'4711001'});
  const locationOnly=assignmentSource({ok:true,rows:[unmatched]},
    parts({locations:true}),current);
  assert.equal(locationOnly.rows[0].context.studentLoan,undefined,
    'Disabled loan fields must be removed from deferred task snapshots');
  assert.equal(locationOnly.rows[0].context.fixedLocation.label,'Klas A');
  const nothing=assignmentSource({ok:true,rows:[unmatched]},
    parts({loans:true}),current);
  assert.equal(nothing.rows[0].context.fixedLocation,undefined);
}

{
  // Existing library records from the old format may only contain an ISBN
  // in the barcode or isbn13 field, never editionIsbn/metadataIsbn.
  for(const oldIdentifier of [{barcode:ISBN},{barcode:'4711001',isbn13:ISBN}]){
    const database=db();
    database.books=[copy('copy-1',{editionIsbn:null,metadataIsbn:null,
      ...oldIdentifier})];
    const selected=plan([source(0,{},{
      description:'Nieuwe Exceltekst',
    },{description:{source:'excel',raw:'Nieuwe Exceltekst'}})],database,{
      parts:parts({fields:{description:true}}),
    });
    assert.equal(selected.ok,true);
    assert.equal(selected.summary.metadataFields,1,
      'Selected metadata must match ISBNs stored in legacy identifier fields');
    assert.deepEqual(selected.metadata.updates[0].bookIds,['copy-1']);
  }
}
{
  // Examenmateriaal: Engels implies language=en for enrichment, but is not
  // permission to overwrite Taal when only Taal was selected and left blank.
  const database=db();
  database.books[0].language='nl';
  const hint=source(0,{},{
    language:'en',
  },{language:{source:'excel',raw:'Engels',
    derived:'exam_material_language_hint'}});
  const derived=plan([hint],database,{
    parts:parts({fields:{language:true}}),
  });
  assert.equal(derived.ok,true);
  assert.equal(derived.summary.metadataFields,0);
  assert.equal(derived.summary.readyToApply,false);
  const explicit=plan([source(0,{},{
    language:'en',
  },{language:{source:'excel',raw:'Engels'}})],database,{
    parts:parts({fields:{language:true}}),
  });
  assert.equal(explicit.summary.metadataFields,1,
    'A genuinely populated selected language cell is allowed');
}
{
  // A full 1,500-row workbook with multiple fields can exceed the former
  // arbitrary 6,000-decision cap even though the input is valid.
  const choices=[];
  for(let i=0;i<1001;i++){
    const isbn='978'+String(i).padStart(10,'0');
    for(const field of ['description','publisher','language','coverUrl','tags','manualThemes']){
      choices.push({id:isbn+':'+field,action:'keep'});
    }
  }
  assert.equal(choices.length,6006);
  assert.equal(normalizedMetadataChoice(choices).ok,true);
  const tooMany=Array.from({length:18001},(_,i)=>({
    id:'978'+String(Math.floor(i/12)).padStart(10,'0')+':'+
      ['title','author','description','publisher','publishedYear','pageCount',
       'language','coverUrl','easyReading','suitableForExamList','tags','manualThemes'][i%12],
    action:'keep',
  }));
  assert.equal(normalizedMetadataChoice(tooMany).ok,false,
    'The cap should still reject more resolutions than the workbook supports');
}

{
  const current=db();
  current.books[0].tags=['oud'];
  current.books[1].tags=['oud'];
  const explicitTags=source(0,{},{
    tags:['avontuur','strip'],
  },{tags:{
    source:'excel',raw:'avontuur',explicitValues:['avontuur'],
    derived:'exam_material_strip_tag',includesDerivedValues:true,
  }});
  const selected=plan([explicitTags],current,{
    parts:parts({fields:{tags:true}}),
  });
  assert.equal(selected.ok,true);
  assert.equal(selected.summary.metadataFields,1,
    'Mixed explicit and derived tags still make a selected tag update');
  assert.deepEqual(selected.metadata.updates[0].value,['avontuur'],
    'The Strip hint must not be written into selected Tags metadata');
  const multiple=plan([source(0,{},{
    tags:['avontuur','spannend','strip'],
  },{tags:{
    source:'excel',raw:'avontuur',
    explicitValues:['avontuur','spannend'],
    derived:'exam_material_strip_tag',includesDerivedValues:true,
  }})],current,{parts:parts({fields:{tags:true}})});
  assert.deepEqual(multiple.metadata.updates[0].value,['avontuur','spannend']);
  const hintOnly=plan([source(0,{},{
    tags:['strip'],
  },{tags:{
    source:'derived',detail:'exam_material_strip_tag',raw:'Strip',
  }})],current,{parts:parts({fields:{tags:true}})});
  assert.equal(hintOnly.summary.metadataFields,0,
    'A blank Tags cell may never be filled by Examenmateriaal alone');
}

{
  // An unchecked student's unmatched loan must not block a valid selected
  // fixed location or metadata-only update, but must remain blocking if
  // the loan column itself is explicitly selected.
  const current=db();
  const row=source(0,{
    studentLoan:{status:'unmatched',name:'Onbekende leerling'},
    fixedLocation:{status:'resolved',label:'Klas A'},
  },{
    barcode:'4711002',description:'Aangepaste beschrijving',
  },{
    description:{source:'excel',raw:'Aangepaste beschrijving'},
  });
  row.status='conflict';
  row.issues=[{code:'student_loan_unmatched',severity:'conflict',
    value:'Onbekende leerling'}];
  const locationOnly=plan([row],current,{parts:parts({locations:true})});
  assert.equal(locationOnly.ok,true);
  assert.equal(locationOnly.summary.proposedLocations,1,
    'Unchecked loan conflicts must not prevent fixed-location updates');
  assert.equal(locationOnly.summary.pending,0);
  assert.equal(locationOnly.summary.readyToApply,true);
  const descriptionOnly=plan([row],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(descriptionOnly.summary.metadataFields,1,
    'Unchecked loan conflicts must not block selected metadata');
  assert.equal(descriptionOnly.summary.pendingMetadata,0);
  const loanOnly=plan([row],current,{parts:parts({loans:true})});
  assert.equal(loanOnly.summary.proposedLoans,0);
  assert.equal(loanOnly.assignments.differences[0].kind,'issue',
    'Selected invalid loan data must still be reviewed');

  const newRow=source(0,{
    studentLoan:{status:'unmatched',name:'Onbekende leerling'},
  },{
    title:'Nieuw boek',author:'Nieuwe auteur',
    editionIsbn:SECOND,metadataIsbn:SECOND,
  });
  newRow.status='conflict';
  newRow.issues=[{code:'student_loan_unmatched',severity:'conflict'}];
  const stockOnly=plan([newRow],current,{parts:parts({books:true})});
  assert.equal(stockOnly.summary.newCopies,1,
    'Stock-only imports cannot be blocked by an unchecked borrower column');

  const identityConflict=source(0,{
    fixedLocation:{status:'resolved',label:'Klas A'},
  },{barcode:'4711002'});
  identityConflict.status='conflict';
  identityConflict.issues=[{code:'conflicting_edition_isbns',severity:'conflict'}];
  const protectedLocation=plan([identityConflict],current,{
    parts:parts({locations:true}),
  });
  assert.equal(protectedLocation.summary.proposedLocations,0);
  assert.equal(protectedLocation.assignments.differences[0].kind,'issue',
    'Identity conflicts remain blocking even for selected valid fields');
}
{
  // The stock planner already proposes every copy of a new ISBN at its
  // selected fixed location. Those 3 physical copies need no extra
  // single-copy assignment decisions, but a borrower remains ambiguous.
  const current=db();
  const row=source(0,{
    fixedLocation:{status:'resolved',label:'Klas A'},
  },{
    title:'Nieuwe editie',author:'Nieuwe auteur',
    editionIsbn:SECOND,metadataIsbn:SECOND,
    quantity:{valid:true,value:3},
  });
  const bulk=plan([row],current,{parts:parts({books:true,locations:true})});
  assert.equal(bulk.ok,true);
  assert.equal(bulk.summary.newCopies,3);
  assert.equal(bulk.summary.pending,0);
  assert.equal(bulk.summary.readyToApply,true);
  assert.equal(bulk.assignments.differences.length,0);
  const held=plan([{
    ...row,context:{
      ...row.context,studentLoan:{status:'matched',id:'tim',name:'Tim Leerling'},
    },
  }],current,{parts:parts({books:true,loans:true,locations:true})});
  assert.equal(held.ok,true);
  assert.equal(held.assignments.differences.some(diff=>
    diff.reason==='copy_requires_single_excel_row'),true,
    'A bulk quantity must never assign an ambiguous loan to one copy');
}

{
  const current=db();
  // Keeping a changed title cannot silently authorize a second physical
  // copy with another title under the same ISBN edition.
  current.books=[current.books[0]];
  const changed=source(0,{},{
    title:'Oorlogswinter, gewijzigde Excelnaam',
    quantity:{valid:true,value:2},
  },{title:{source:'excel',raw:'Oorlogswinter, gewijzigde Excelnaam'}});
  const options={parts:parts({books:true,fields:{title:true}})};
  const proposed=plan([changed],current,options);
  assert.equal(proposed.ok,true);
  assert.equal(proposed.summary.metadataFields,1);
  assert.equal(proposed.summary.newCopies,1,
    'A real selected title update may add compatible ISBN copies');
  assert.equal(proposed.summary.readyToApply,true);
  const kept=plan([changed],current,{
    ...options,metadataResolutions:[{id:ISBN+':title',action:'keep'}],
  });
  assert.equal(kept.ok,true);
  assert.equal(kept.summary.metadataFields,0);
  assert.equal(kept.summary.newCopies,0);
  assert.equal(kept.summary.blockedStock,1);
  assert.equal(kept.summary.readyToApply,false,
    'Keeping the old title must prevent adding an incompatible new copy');

  // Selecting an empty source column is not an instruction to replace its
  // older identity with a title found through enrichment.
  const enriched=source(0,{},{
    title:'Titel uit boekverrijking',quantity:{valid:true,value:2},
  },{title:{source:'metadata',detail:'enrichment'}});
  const blankSource=plan([enriched],current,options);
  assert.equal(blankSource.ok,true);
  assert.equal(blankSource.summary.metadataFields,0);
  assert.equal(blankSource.summary.newCopies,0);
  assert.equal(blankSource.summary.readyToApply,false);
  const authorChange=source(0,{},{
    author:'Nieuwe schrijver',authors:['Nieuwe schrijver'],
    quantity:{valid:true,value:2},
  },{author:{source:'excel',raw:'Nieuwe schrijver'}});
  const authorKept=plan([authorChange],current,{
    parts:parts({books:true,fields:{author:true}}),
    metadataResolutions:[{id:ISBN+':author',action:'keep'}],
  });
  assert.equal(authorKept.summary.blockedStock,1,
    'Keeping an author correction must not create copies with another author');
}
console.log('Unified import: independent checkboxes, virtual copies, metadata and no implicit deletions OK');
