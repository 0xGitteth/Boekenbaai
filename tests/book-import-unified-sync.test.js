'use strict';
const assert=require('node:assert/strict');
const {
  normalizeParts,virtualId,buildUnifiedBookImport,actualAssignmentPreview,assignmentSource,
  normalizedMetadataChoice,issueAffectsSelection,actionableSourceIssues,
  shouldApplyMetadataToCreatedCopy,rebaseStaleAssignmentChoices,
}=require('../book-import-unified-sync');
const {excelLoanReceiptKey}=require('../book-import-loan-migration');
const ISBN='9780306406157',SECOND='9780439554930';
const XLSX=require('xlsx');
const {buildWorkbook,librarySheets,stageSheets}=require('../book-import-export');
{
  const committed=librarySheets({books:[{
    id:'copy-1',title:'Testboek',author:'A Auteur',
    editionIsbn:'9780306406157',barcode:'4711001',
    fixedLocation:'SK BB',status:'borrowed',borrowedBy:'pupil-1',
    pageCount:224,themes:['Vriendschap','School'],
  }],students:[{id:'pupil-1',name:'Voorbeeld Leerling'}],classes:[]});
  const bin=buildWorkbook(XLSX,committed);
  const parsed=XLSX.read(bin,{type:'base64'});
  const books=XLSX.utils.sheet_to_json(parsed.Sheets.Boeken);
  assert.equal(books[0]['Vaste locatie'],'SK BB');
  assert.equal(books[0]['Uitgeleend aan leerling'],'Voorbeeld Leerling');
  assert.equal(books[0]['Naam leerling'],'Voorbeeld Leerling');
  assert.equal(books[0]['Aantal'],1);
  assert.ok(books[0]['Overige gegevens (JSON)'].includes('copy-1'));
  assert.equal(books[0]["Thema's"],'Vriendschap; School');
  const original={'Titel':'Foute titel','Auteur':'A Auteur',
    'ISBN-nummer':'9780306406156','Vast in de klas van':'StructuurBB'};
  const stage={
    revision:1,fileName:'bibliotheek.xlsx',
    sourceRows:[original],
    analysis:{rows:[{
      index:0,sourceRowNumber:85,book:{
        title:'Foute titel',author:'A Auteur',
        editionIsbn:'',quantity:{value:1},
        themes:[],tags:[],
      },context:{fixedLocation:{label:'SK BB',raw:'StructuurBB'}},
    }]},
  };
  const snapshot=stageSheets(stage,{
    corrections:[{index:0,fields:{
      title:'Juiste titel',editionIsbn:ISBN,
      classes:'StructuurBB',libraryPresence:'Ja',
    }}],
    assignmentResolutions:[{id:'0:location',action:'later'}],
  });
  const sheet=XLSX.read(buildWorkbook(XLSX,snapshot),{type:'base64'});
  const draft=XLSX.utils.sheet_to_json(sheet.Sheets['Boeken concept']);
  assert.equal(draft[0].Titel,'Juiste titel');
  assert.equal(draft[0]['ISBN-nummer'],ISBN);
  assert.equal(draft[0]['Vast in de klas van'],'StructuurBB');
  assert.equal(draft[0]['Klassen'],'StructuurBB');
  assert.equal(draft[0]['Aanwezig bieb'],'Ja');
  assert.equal(draft[0].Importstatus,'Concept (nog niet geïmporteerd)');
  assert.equal(XLSX.utils.sheet_to_json(
    sheet.Sheets['Originele Excel'])[0].Titel,'Foute titel');
  const admin=XLSX.utils.sheet_to_json(sheet.Sheets['Administratieve keuzes']);
  assert.equal(admin[0].Keuze,'later');
  assert.ok(sheet.Sheets.Toelichting);
  const malicious=buildWorkbook(XLSX,[['Sheet',[
    {Titel:'=HYPERLINK("https://evil.example","Klik")'}]]]);
  const result=XLSX.read(malicious,{type:'base64'});
  assert.equal(XLSX.utils.sheet_to_json(result.Sheets.Sheet)[0].Titel[0],"'",
    'Untrusted spreadsheet text must never become an executable Excel formula');
}

{
  const previous=[
    {index:0,book:{editionIsbn:ISBN,title:'Mijn boek',author:'A'},
      context:{fixedLocation:{label:'A'}}},
    {index:1,book:{editionIsbn:ISBN,title:'Ander boek',author:'B'},context:{}},
    {index:2,book:{editionIsbn:ISBN,title:'Derde boek',author:'C'},context:{}},
  ];
  const current=[
    {...previous[0],book:{...previous[0].book,editionIsbn:SECOND}},
    previous[1],previous[2],
  ];
  const differences=[
    {id:'0:loan',rowIndex:0,kind:'loan'},
    {id:'1:location',rowIndex:1,kind:'location'},
    {id:'2:loan',rowIndex:2,kind:'loan'},
  ];
  const result=rebaseStaleAssignmentChoices([
    {id:'0:location',action:'keep'},
    {id:'1:location',action:'keep'},
    {id:'2:loan',action:'later'},
  ],previous,current,differences);
  assert.deepEqual(result.removed,[{id:'0:location',action:'keep'}]);
  assert.deepEqual(result.choices,[
    {id:'1:location',action:'keep'},
    {id:'2:loan',action:'later'},
    {id:'0:loan',action:'later'},
  ],'Keep unrelated explicit decisions; affected new loan changes must be postponed');
  const changedSameId=rebaseStaleAssignmentChoices([
    {id:'0:loan',action:'apply'}, {id:'1:location',action:'keep'},
  ],previous,current,differences);
  assert.deepEqual(changedSameId.choices,[
    {id:'1:location',action:'keep'}, {id:'0:loan',action:'later'},
  ],'A changed ISBN invalidates even the same loan ID; never auto-apply');
  const unchanged=rebaseStaleAssignmentChoices([
    {id:'1:location',action:'keep'},
  ],previous,previous,differences);
  assert.equal(unchanged.removed.length,0);
  assert.deepEqual(unchanged.choices,[{id:'1:location',action:'keep'}]);
}

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
const parts=(other={})=>({books:false,loans:false,locations:false,fields:{},...other});
const plan=(sourceRows,database,options={})=>
  buildUnifiedBookImport({ok:true,rows:sourceRows},database,options);
const loan=(id,name)=>({studentLoan:{status:'matched',id,name}});

// A historical missing first-name value must not create a new physical book,
// nor require nine separate decisions for the same bad legacy metadata.
{
  const legacy=db();
  legacy.books=[copy('copy-1',{
    title:'Haantjes',author:'nan Kluun',authors:['nan Kluun'],
    status:'borrowed',borrowedBy:'lisa',
  })];
  const row=source(0,{},{
    title:'Haantjes',author:'Kluun',authors:['Kluun'],
  },{author:{source:'excel',raw:'Kluun'}});
  row.sourceEvidence=[{
    source:'bureau isbn',editionIsbn:ISBN,title:'Haantjes',author:'Kluun',
  }];
  const preview=plan([row],legacy,{
    parts:parts({books:true,fields:{author:true}}),
  });
  assert.equal(preview.ok,true);
  assert.equal(preview.summary.blockedStock,0);
  assert.equal(preview.summary.newCopies,0);
  const authorUpdate=preview.metadata.updates.find(change=>change.field==='author');
  assert.deepEqual(authorUpdate.value,{value:'Kluun',authors:['Kluun']});
  assert.deepEqual(authorUpdate.bookIds,['copy-1'],
    'Correct only the existing physical copy, retaining its borrower and ID');
  assert.equal(preview.summary.readyToApply,true);
  const explicitKeep=plan([row],legacy,{
    parts:parts({books:true,fields:{author:true}}),
    metadataResolutions:[{id:ISBN+':author',action:'keep'}],
  });
  assert.equal(explicitKeep.metadata.updates.length,0,
    'An explicit decision to retain original values remains authoritative');
  const unrelated=db();
  unrelated.books=[copy('copy-1',{title:'Haantjes',author:'nan Somebody Else'})];
  assert.equal(plan([row],unrelated,{parts:parts({books:true,fields:{author:true}})})
    .summary.blockedStock,1,'Never silently repair a different surname');
  const genuineFirstName=db();
  genuineFirstName.books=[copy('copy-1',{title:'Haantjes',author:'Nan Kluun'})];
  assert.equal(plan([row],genuineFirstName,{parts:parts({books:true,fields:{author:true}})})
    .summary.blockedStock,1,'Preserve capitalized legitimate first names');
}



assert.equal(normalizeParts({books:false,loans:false,locations:false,fields:{}}).ok,false);
assert.equal(normalizeParts({books:false,loans:false,locations:false,fields:{coverUrl:true}}).ok,true);
assert.equal(normalizeParts({books:true,loans:false,locations:false,fields:{coverUrl:'yes'}}).ok,false);
assert.equal(normalizeParts({books:true,loans:true,locations:true,fields:{mystery:true}}).ok,false);
assert.equal(normalizeParts(undefined).value.books,true);

// Audit all major diagnostic families. A future unknown error remains
// conservative rather than being silently dropped by the import planner.
{
  const stock=parts({books:true});
  const loans=parts({loans:true});
  const fixed=parts({locations:true});
  const metadata=parts({fields:{pageCount:true}});
  for(const code of [
    'isbn_repaired','isbn_resolved_from_metadata',
    'isbn_repair_override_by_sources',

    'isbn_repair_suggested','metadata_lookup_failed',
    'metadata_not_usable','metadata_not_strict_match',
    'title_author_metadata_missing_edition_isbn',
    'ambiguous_identifier_interpreted_as_isbn',
    'ambiguous_identifier_interpreted_as_barcode',
    'nonstandard_easy_reading_value','dangerous_headers_ignored',
    'ml_structuurbb_fixed_location',
  ]){
    for(const [section,part] of [['stock',stock],['assignment',loans],
      ['metadata',metadata]]){
      assert.equal(issueAffectsSelection({code,severity:'warning'},part,section),false,
        code+' must be nonblocking for '+section);
    }
  }
  for(const code of ['invalid_quantity','copy_limit_exceeded']){
    assert.equal(issueAffectsSelection({code},stock,'stock'),true);
    assert.equal(issueAffectsSelection({code},loans,'assignment'),false);
    assert.equal(issueAffectsSelection({code},metadata,'metadata'),false);
  }
  for(const code of ['invalid_physical_barcode','duplicate_physical_barcode',
    'conflicting_physical_barcodes','barcode_with_multiple_copies']){
    assert.equal(issueAffectsSelection({code},stock,'stock'),true);
    assert.equal(issueAffectsSelection({code},loans,'assignment'),true);
    assert.equal(issueAffectsSelection({code},metadata,'metadata'),false);
  }
  for(const code of ['invalid_published_year','invalid_page_count',
    'language_hint_conflict']){
    assert.equal(issueAffectsSelection({code},stock,'stock'),false);
    assert.equal(issueAffectsSelection({code},loans,'assignment'),false);
  }
  assert.equal(issueAffectsSelection({code:'invalid_page_count'},metadata,'metadata'),false);
  assert.equal(issueAffectsSelection({code:'invalid_published_year'},metadata,'metadata'),false);
  assert.equal(issueAffectsSelection({code:'unexpected_exam_material_value'},
    parts({fields:{suitableForExamList:true}}),'metadata'),false);
  assert.equal(issueAffectsSelection({code:'unexpected_exam_material_value'},
    metadata,'metadata'),false);
  assert.equal(issueAffectsSelection({code:'class_context_needs_review'},
    parts({loans:true,locations:true}),'assignment'),false);
  assert.equal(issueAffectsSelection({code:'class_context_needs_review'},
    loans,'assignment'),false);
  assert.equal(issueAffectsSelection({code:'fixed_location_needs_review'},
    fixed,'assignment'),true);
  assert.equal(issueAffectsSelection({code:'fixed_location_needs_review'},
    loans,'assignment'),false);
  assert.equal(issueAffectsSelection({code:'student_loan_unmatched'},
    loans,'assignment'),true);
  assert.equal(issueAffectsSelection({code:'student_loan_unmatched'},
    stock,'stock'),false);
  assert.equal(issueAffectsSelection({code:'library_presence_needs_review'},
    stock,'stock'),false);
  for(const code of ['conflicting_edition_isbns','edition_identity_conflict',
    'missing_title','missing_author','metadata_identifier_conflict']){
    for(const [section,part] of [['stock',stock],['assignment',loans],
      ['metadata',metadata]]){
      assert.equal(issueAffectsSelection({code,severity:'conflict'},part,section),true,
        code+' must remain blocking in '+section);
    }
  }
  for(const [code,field] of [['metadata_title_conflict','title'],
    ['author_sources_differ','author']]){
    assert.equal(issueAffectsSelection({code,severity:'conflict'},stock,'stock'),true);
    assert.equal(issueAffectsSelection({code,severity:'conflict'},loans,'assignment'),true);
    assert.equal(issueAffectsSelection({code,severity:'conflict'},
      parts({fields:{[field]:true}}),'metadata'),true);
    assert.equal(issueAffectsSelection({code,severity:'conflict'},
      metadata,'metadata'),false,
      'One uncertain field must not force manual review of unrelated values');
  }
  for(const [field,expectedStock,expectedMetadata] of [
    ['description',false,false],['pageCount',false,false],
    ['quantity',true,false],['title',true,true],['author',true,true],
  ]){
    assert.equal(issueAffectsSelection({code:'conflicting_source_columns',field},
      stock,'stock'),expectedStock);
    assert.equal(issueAffectsSelection({code:'conflicting_source_columns',field},
      metadata,'metadata'),expectedMetadata);
  }
  assert.equal(issueAffectsSelection({code:'metadata_differs_from_excel',
    sourceInvalid:false,field:'pageCount'},metadata,'metadata'),false);
  assert.equal(issueAffectsSelection({code:'metadata_differs_from_excel',
    sourceInvalid:true,field:'pageCount'},metadata,'metadata'),true);
  assert.equal(issueAffectsSelection({code:'metadata_differs_from_excel',
    sourceInvalid:true,field:'pageCount'},stock,'stock'),false);
  assert.equal(issueAffectsSelection({code:'new_unrecognized_error'},
    stock,'stock'),true,'Unknown error codes must remain conservative');

  const example={ok:true,rows:[{
    index:0,sourceRowNumber:8,book:{title:'A',author:'B',editionIsbn:ISBN},
    issues:[{code:'isbn_repaired',severity:'warning'},
      {code:'invalid_page_count',severity:'warning'},
      {code:'metadata_lookup_failed',severity:'warning'},
      {code:'conflicting_source_columns',field:'title',severity:'conflict'}],
  }]};
  const actionable=actionableSourceIssues(example,stock);
  assert.equal(actionable.length,1);
  assert.deepEqual(actionable[0].issues.map(x=>x.code),['conflicting_source_columns'],
    'Only selected and meaningful diagnostics request administrator acknowledgment');
}


// A true ISBN/title conflict is still a title decision, but the same row's
// independently populated author and language are not three separate
// mandatory decisions. Existing physical copies must remain untouched.
{
  const current=db();
  current.books=[copy('copy-1',{language:'en',author:'Jan Terlouw',
    authors:['Jan Terlouw'],title:'Oorlogswinter'})];
  const row=source(0,{},{title:'Oorlogswinter',author:'Jan Terlouw',
    authors:['Jan Terlouw'],language:'nl'},{
    title:{source:'excel',raw:'Oorlogswinter'},
    author:{source:'excel',raw:'Jan Terlouw'},
    language:{source:'excel',raw:'nl'},
  });
  row.status='conflict';
  row.issues=[{code:'metadata_title_conflict',severity:'conflict'}];
  const scoped=plan([row],current,{
    parts:parts({books:true,fields:{title:true,author:true,language:true}}),
  });
  assert.equal(scoped.ok,true);
  assert.deepEqual(scoped.metadata.issues.map(issue=>issue.field),['title'],
    'Do not create redundant author/language decisions for a title dispute');
  assert.equal(scoped.metadata.updates.some(update=>update.field==='language'),false,
    'A disputed physical identity must not silently change the book language');
  assert.ok(scoped.metadata.automaticDecisions.some(item=>
    item.field==='language'&&item.action==='keep'));
  assert.equal(scoped.summary.blockedStock,1,
    'Uncertain book identity must remain blocked for physical-stock changes');

  const onlyLanguage=plan([row],current,{
    parts:parts({fields:{language:true}}),
  });
  assert.equal(onlyLanguage.summary.pendingMetadata,0);
  assert.equal(onlyLanguage.metadata.updates.length,0,
    'Selecting only language cannot bypass an unselected title conflict');
  assert.ok(onlyLanguage.metadata.automaticDecisions.some(item=>
    item.field==='language'&&item.action==='keep'));
  const missingLanguage=db();
  missingLanguage.books=[copy('copy-1',{language:''})];
  const withOnlineEnrichment=source(0,{},{language:'nl'},{
    language:{source:'metadata',detail:'isbn_lookup'},
  });
  withOnlineEnrichment.status='conflict';
  withOnlineEnrichment.issues=[{code:'metadata_title_conflict',severity:'conflict'}];
  const enrichment=plan([withOnlineEnrichment],missingLanguage,{
    parts:parts({fields:{pageCount:true}}),
  });
  assert.equal(enrichment.metadata.updates.some(item=>item.field==='language'),false,
    'Automatic enrichment also preserves a disputed physical edition');

  const authorClash=source(0,{},{title:'Oorlogswinter',author:'Jan Terlouw',
    authors:['Jan Terlouw'],language:'nl'},{
    title:{source:'excel',raw:'Oorlogswinter'},
    author:{source:'excel',raw:'Jan Terlouw'},
    language:{source:'excel',raw:'nl'},
  });
  authorClash.status='conflict';
  authorClash.issues=[{code:'author_sources_differ',severity:'conflict'}];
  const authorScoped=plan([authorClash],current,{
    parts:parts({fields:{title:true,author:true,language:true}}),
  });
  assert.deepEqual(authorScoped.metadata.issues.map(issue=>issue.field),['author']);
  assert.equal(authorScoped.metadata.updates.some(update=>update.field==='language'),false,
    'An author dispute likewise preserves other physical edition details');
}

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
  const row=source(0,{},{
    quantity:{valid:true,value:2},
    pageCount:null,description:'Nieuwe gecontroleerde tekst',
  },{
    pageCount:{source:'excel',raw:'onbekend'},
    description:{source:'excel',raw:'Nieuwe gecontroleerde tekst'},
  });
  row.status='warning';
  row.issues=[
    {code:'invalid_page_count',severity:'warning',raw:'onbekend'},
    {code:'metadata_differs_from_excel',severity:'warning',
      field:'pageCount',sourceInvalid:true,excelValue:'onbekend'},
  ];
  const review=plan([row],current,{
    parts:parts({books:true,fields:{description:true}}),
    acceptWarnings:false,
  });
  assert.equal(review.summary.blockedStock,0,
    'Unselected invalid page count cannot block a valid physical stock check');
  assert.equal(review.summary.metadataFields,1,
    'An independent valid description can be synced without approving page count');
  assert.equal(review.summary.pendingMetadata,0);
  assert.equal(review.summary.readyToApply,true);

  const conflict=source(0,{},{
    quantity:{valid:true,value:2},
    description:'Conflict in een niet-geselecteerde kolom',
  },{description:{source:'excel',raw:'Conflict in een niet-geselecteerde kolom'}});
  conflict.status='conflict';
  conflict.issues=[{code:'conflicting_source_columns',severity:'conflict',field:'description'}];
  const safe=plan([conflict],current,{parts:parts({books:true})});
  assert.equal(safe.summary.blockedStock,0,
    'A nonidentity Excel column disagreement cannot block the stock plan');
}

{
  const current=db();
  const advisory=source(0,{},{
    quantity:{valid:true,value:3},
  });
  advisory.status='warning';
  advisory.issues=[{
    code:'metadata_differs_from_excel',severity:'warning',field:'title',
    excelValue:'Oorlogswinter',metadataValue:['Online titel'],
  }];
  const safe=plan([advisory],current,{parts:parts({books:true})});
  assert.equal(safe.summary.newCopies,1,
    'One external title discrepancy must not block adding a verified ISBN copy');
  assert.equal(safe.summary.blockedStock,0);
  assert.equal(safe.summary.readyToApply,true);
  const confirmed=source(0,{},{
    quantity:{valid:true,value:3},
  });
  confirmed.status='conflict';
  confirmed.issues=[{
    code:'metadata_title_conflict',severity:'conflict',
    editionIsbn:ISBN,sourceCount:2,
  }];
  const blocked=plan([confirmed],current,{parts:parts({books:true})});
  assert.equal(blocked.summary.newCopies,0);
  assert.equal(blocked.summary.blockedStock,1,
    'Corroborated title/ISBN conflicts remain a mandatory human check');
}

{
  const current=db();
  const spellingVariant=source(0,{},{
    title:'Oorlogs-winter',author:'Jan Térlouw',authors:['Jan Térlouw'],
    quantity:{valid:true,value:3},
  });
  const result=plan([spellingVariant],current,{parts:parts({books:true})});
  assert.equal(result.ok,true);
  assert.equal(result.summary.blockedStock,0,
    'An ISBN-matched punctuation/accent-only edition name is not a new identity');
  assert.equal(result.summary.newCopies,1);
  assert.equal(result.summary.readyToApply,true);
  assert.equal(result.inventory.proposedAdds.length,1);
}

{
  const current=db();
  const one=(index,title,author)=>source(index,{},{
    title,author,authors:[author],
  },{
    title:{source:'excel',raw:title},
    author:{source:'excel',raw:author},
  });
  const preview=plan([
    one(0,'Oorlogswinter!','Jan Térlouw'),
    one(1,'Oorlogswinter','Jan Terlouw'),
  ],current,{parts:parts({fields:{title:true,author:true}})});
  assert.equal(preview.ok,true);
  assert.equal(preview.summary.pendingMetadata,0,
    'Two equivalent spellings in Excel must not become an identity conflict');
  assert.equal(preview.metadata.updates.some(change=>change.field==='title'),false,
    'Equivalent title spelling must not change the existing title');
  assert.equal(preview.metadata.updates.every(change=>
    change.field!=='author'||change.value.value==='Jan Terlouw'),true,
    'Normalizing a missing authors list must not change the author identity');
  assert.equal(preview.summary.readyToApply,true,
    'Harmless metadata normalization needs no manual identity decision');
}

{
  const current=db();
  const safe=source(0,{},{
    description:'Nieuwe geldige beschrijving',
  },{description:{source:'excel',raw:'Nieuwe geldige beschrijving'}});
  safe.status='warning';
  safe.issues=[
    {code:'isbn_repaired',severity:'warning'},
    {code:'metadata_lookup_failed',severity:'warning'},
    {code:'metadata_differs_from_excel',severity:'warning',field:'title',
      sourceInvalid:false},
    {code:'invalid_page_count',severity:'warning'},
    {code:'class_context_needs_review',severity:'warning'},
  ];
  const result=plan([safe],current,{
    parts:parts({fields:{description:true}}),acceptWarnings:false,
  });
  assert.equal(result.summary.metadataFields,1,
    'Benign lookup failures and unrelated fields may not silently preserve a valid selected description');
  assert.equal(result.summary.preservedMetadata,0);
  assert.equal(result.summary.pendingMetadata,0);
  assert.equal(result.summary.readyToApply,true);
  assert.equal(result.actionableSourceIssues.length,0,
    'The review panel and metadata planner must agree on which warnings need approval');

  const selected=source(0,{},{
    pageCount:null,
  },{pageCount:{source:'excel',raw:'onbekend'}});
  selected.status='warning';
  selected.issues=[{code:'invalid_page_count',severity:'warning'}];
  const unsafe=plan([selected],current,{
    parts:parts({fields:{pageCount:true}}),
  });
  assert.equal(unsafe.summary.metadataFields,0,
    'The same policy may not accidentally apply an invalid selected value');
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
  assert.equal(renamedEdition.summary.blockedStock,1,
    'Substantive identity differences without verification must not silently add stock');
  assert.equal(renamedEdition.summary.metadataFields,0);
  assert.equal(renamedEdition.summary.preservedMetadata,2);
  const warning={...description,status:'warning'};
  const caution=plan([warning],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(caution.summary.pendingMetadata,0,
    'Nonessential unresolved fields preserve existing data without manual prompts');
  assert.equal(caution.summary.preservedMetadata,1);
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
  assert.equal(conflicts.summary.pendingMetadata,0,
    'Conflicting descriptions are not critical ISBN identity questions');
  assert.equal(conflicts.summary.preservedMetadata,1);
  assert.equal(conflicts.summary.readyToApply,true);
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
  renamedLoan.sourceEvidence=[
    {source:'googlebooks',editionIsbn:ISBN,title:'Oorlogswinter, gecorrigeerde titel'},
    {source:'openlibrary',editionIsbn:ISBN,title:'Oorlogswinter, gecorrigeerde titel'},
  ];
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
    assert.equal(predicted.summary.pendingMetadata,0,
      'Unparseable optional numbers keep the old value without a compulsory task');
    assert.equal(predicted.summary.preservedMetadata,1);
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
  changed.sourceEvidence=[
    {source:'googlebooks',editionIsbn:ISBN,title:'Oorlogswinter, gewijzigde Excelnaam'},
    {source:'openlibrary',editionIsbn:ISBN,title:'Oorlogswinter, gewijzigde Excelnaam'},
  ];
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

{
  const current=db();
  const row=source(0,{
    ...loan('tim','Tim Leerling'),
    fixedLocation:{status:'resolved',label:'Klas A'},
  },{
    description:'Nieuwe beschrijving',
  },{description:{source:'excel',raw:'Nieuwe beschrijving'}});
  row.status='warning';
  row.issues=[{
    code:'metadata_differs_from_excel',severity:'warning',
    field:'author',excelValue:'Jan Terlouw',
    metadataValue:'J. Terlouw',
  }];
  const proposal=plan([row],current,{
    parts:parts({books:true,loans:true,locations:true,
      fields:{description:true}}),
    acceptWarnings:false,
  });
  assert.equal(proposal.ok,true);
  assert.equal(proposal.summary.blockedStock,0,
    'Online author spelling must not block stock comparison');
  assert.equal(proposal.summary.pendingMetadata,0,
    'Online author spelling must not block explicitly selected description');
  assert.equal(proposal.summary.metadataFields,1);
  assert.equal(proposal.summary.proposedLoans,1);
  assert.equal(proposal.summary.proposedLocations,1);
  assert.equal(proposal.summary.readyToApply,true,
    'External metadata comparisons should not require 3 unrelated decisions');
}
{
  const current=db();
  const row=source(0,{},{
    description:'Excelbeschrijving',
    pageCount:null,
  },{
    description:{source:'excel',raw:'Excelbeschrijving'},
    pageCount:{source:'excel',raw:'onbekend'},
  });
  row.status='warning';
  row.issues=[{
    code:'invalid_page_count',severity:'warning',
    raw:'onbekend',field:'pageCount',
  }];
  const preview=plan([row],current,{
    parts:parts({fields:{description:true,pageCount:true}}),
    acceptWarnings:false,
  });
  assert.equal(preview.ok,true);
  assert.equal(preview.summary.metadataFields,1,
    'Invalid page count must not block a valid description column');
  assert.equal(preview.metadata.updates[0].field,'description');
  assert.equal(preview.summary.pendingMetadata,0,
    'Selected invalid page count automatically preserves existing data');
  assert.equal(preview.summary.preservedMetadata,1);
  const invalidMetadata=source(0,{},{
    pageCount:null,
  },{pageCount:{source:'excel',raw:'geen getal'}});
  invalidMetadata.status='warning';
  invalidMetadata.issues=[{
    code:'metadata_differs_from_excel',severity:'warning',
    field:'pageCount',sourceInvalid:true,
    excelValue:'geen getal',metadataValue:200,
  }];
  const unsafeNumeric=plan([invalidMetadata],current,{
    parts:parts({fields:{pageCount:true}}),
    acceptWarnings:false,
  });
  assert.equal(unsafeNumeric.summary.metadataFields,0,
    'Invalid numeric Excel input is not a harmless external disagreement');
  assert.equal(unsafeNumeric.summary.pendingMetadata,0);
  assert.equal(unsafeNumeric.summary.preservedMetadata,1);

  const blocked=source(0,{},{
    description:'Excelbeschrijving',
  },{description:{source:'excel',raw:'Excelbeschrijving'}});
  blocked.status='conflict';
  blocked.issues=[{code:'edition_identity_conflict',severity:'conflict'}];
  const unsafe=plan([blocked],current,{
    parts:parts({fields:{description:true}}),
  });
  assert.equal(unsafe.summary.metadataFields,0);
  assert.equal(unsafe.summary.pendingMetadata,1,
    'Structural ISBN identity conflicts must remain blocked');
}

// Automatically enrich blank bibliographic fields after an opted-in exact
// ISBN lookup, even when the administrator did not select Excel metadata
// columns. Existing descriptive content and curator tags remain untouched.
{
  const current=db();
  current.books[0].description='Zelf geschreven tekst';
  current.books[1].description='';
  for(const book of current.books){
    book.publisher='';
    book.pageCount=null;
    book.tags=[];
  }
  const row=source(0,{},{
    quantity:{valid:true,value:2},
    description:'Een ISBN-geverifieerd verhaal over vriendschap.',
    publisher:'Uitgeverij Test',pageCount:214,
    tags:['friendship','adventure'],
  },{
    description:{source:'metadata',detail:'googlebooks'},
    publisher:{source:'metadata',detail:'googlebooks'},
    pageCount:{source:'metadata',detail:'googlebooks'},
    tags:{source:'metadata',detail:'googlebooks'},
  });
  const filled=plan([row],current,{parts:parts({books:true})});
  assert.equal(filled.ok,true);
  assert.equal(filled.summary.blockedStock,0);
  assert.equal(filled.summary.pendingMetadata,0);
  assert.equal(filled.summary.metadataFields,4,
    'Verified external data can fill missing fields without selecting Excel columns');
  const description=filled.metadata.updates.find(item=>item.field==='description');
  assert.deepEqual(description.bookIds,['copy-2'],
    'Existing teacher descriptions must not be overwritten');
  assert.equal(filled.metadata.updates.find(item=>item.field==='pageCount').value,214);
  assert.equal(filled.metadata.updates.find(item=>item.field==='tags').value.length,2);
  assert.equal(filled.summary.readyToApply,true);
  const keepEnrichment=plan([row],current,{
    parts:parts({books:true}),
    metadataResolutions:[{id:ISBN+':description',action:'keep'}],
  });
  assert.equal(keepEnrichment.ok,true);
  assert.equal(keepEnrichment.metadata.updates.some(update=>
    update.field==='description'),false,
    'An administrator may decline optional auto-enrichment without losing other fields');
  assert.ok(keepEnrichment.metadata.automaticDecisions.some(item=>
    item.field==='description'&&item.action==='keep'));
  const forbiddenExcel=plan([row],current,{
    parts:parts({books:true}),
    metadataResolutions:[{id:ISBN+':description',action:'excel'}],
  });
  assert.equal(forbiddenExcel.error,'unsafe_metadata_override',
    'Source-only fields cannot be replaced with fabricated nonexistent Excel values');
  const raw=source(0,{},{
    quantity:{valid:true,value:2},description:'Exceltekst',
  },{description:{source:'excel',raw:'Exceltekst'}});
  const notOpted=plan([raw],current,{parts:parts({books:true})});
  assert.equal(notOpted.summary.metadataFields,0,
    'Unselected Excel values are never silently imported');
}
{
  const current=db();
  for(const b of current.books)b.pageCount=210;
  const row=source(0,{},{
    pageCount:214,
  },{pageCount:{source:'excel',raw:'214'}});
  const unchanged=plan([row],current,{
    parts:parts({fields:{pageCount:true}}),
  });
  assert.equal(unchanged.summary.metadataFields,0);
  assert.equal(unchanged.summary.preservedMetadata,1,
    'A minor page-count disagreement is not worth an automatic rewrite');
  assert.equal(unchanged.summary.pendingMetadata,0);
  const explicit=plan([row],current,{
    parts:parts({fields:{pageCount:true}}),
    metadataResolutions:[{id:ISBN+':pageCount',action:'excel'}],
  });
  assert.equal(explicit.summary.metadataFields,1,
    'An administrator can intentionally override the nonessential value');
}
{
  const current=db();
  const vague=source(0,{classContext:['Klas A']});
  vague.status='warning';
  vague.issues=[{code:'class_context_needs_review',severity:'warning'}];
  const initial=plan([vague],current,{
    parts:parts({loans:true,locations:true}),
  });
  assert.equal(initial.ok,true);
  assert.equal(initial.summary.pendingAssignments,0,
    'Vague class notes are safely retained by default');
  const kept=initial.assignments.differences.find(item=>item.kind==='class_context');
  assert.equal(kept.choice,'keep');
  assert.equal(kept.autoKept,true);
  assert.equal(initial.summary.readyToApply,true,
    'A documented automatic keep may complete without a manual checkbox');
}
// Codex P2: duplicate Excel description columns must NEVER overwrite a
// stored description merely because generic source warnings are nonblocking.
{
  const current=db();
  const conflicting=source(0,{},{
    description:'Eerste beschrijving',publisher:'Nieuwe uitgever',
  },{
    description:{source:'excel',raw:'Eerste beschrijving'},
    publisher:{source:'excel',raw:'Nieuwe uitgever'},
  });
  conflicting.status='conflict';
  conflicting.issues=[{code:'conflicting_source_columns',
    severity:'conflict',field:'description'}];
  const selected=plan([conflicting],current,{
    parts:parts({fields:{description:true,publisher:true}}),
  });
  assert.equal(selected.ok,true);
  assert.equal(selected.summary.pendingMetadata,0);
  assert.equal(selected.summary.metadataFields,1,
    'A conflicting description must be skipped, not the safe publisher');
  assert.equal(selected.metadata.updates[0].field,'publisher');
  assert.ok(selected.metadata.updates.every(x=>x.field!=='description'));
  assert.equal(selected.summary.readyToApply,true);
}
// Codex P2: source-only enrichment must respect deliberately blank
// descriptions, covers and tags with manual provenance.
{
  const current=db();
  for(const book of current.books){
    book.description='';book.coverUrl='';book.tags=[];
  }
  current.books[0].importProvenance={fieldSources:{
    description:{sourceType:'manual'},
    coverUrl:{sourceType:'manual'},
    tags:{sourceType:'manual'},
  }};
  const enriched=source(0,{},{
    description:'Online beschrijving',
    coverUrl:'https://example.org/geverifieerd.jpg',
    tags:['vrienden'],
  },{
    description:{source:'metadata',detail:'googlebooks'},
    coverUrl:{source:'metadata',detail:'googlebooks'},
    tags:{source:'metadata',detail:'googlebooks'},
  });
  const result=plan([enriched],current,{parts:parts({books:true})});
  assert.equal(result.ok,true);
  assert.equal(result.summary.metadataFields,3);
  for(const update of result.metadata.updates){
    assert.deepEqual(update.bookIds,['copy-2'],
      'Manual blank fields must not be repopulated by import enrichment');
  }
}
// Codex P2: two matching ISBN providers must be able to correct a selected
// author field even after the analyzer records metadata provenance.
{
  const current=db();
  for(const book of current.books){
    book.author='Carrý Slee';book.authors=['Carrý Slee'];
  }
  const verified=source(0,{},{
    author:'Carry Slee',authors:['Carry Slee'],
  },{
    author:{source:'metadata',detail:'verified_isbn_spelling',
      correctedFrom:'Carrý Slee',sources:['googlebooks','openlibrary']},
  });
  verified.sourceEvidence=[
    {source:'googlebooks',editionIsbn:ISBN,author:'Carry Slee'},
    {source:'openlibrary',editionIsbn:ISBN,author:'Carry Slee'},
  ];
  const result=plan([verified],current,{
    parts:parts({fields:{author:true}}),
  });
  assert.equal(result.ok,true);
  assert.equal(result.summary.metadataFields,1);
  assert.equal(result.metadata.updates[0].field,'author');
  assert.equal(result.metadata.updates[0].value.value,'Carry Slee');
  assert.equal(result.summary.readyToApply,true);
}
// Codex P2: previously imported loan receipts must not undo automatic
// keep resolutions for an unrelated ambiguous class note in the same Excel.
{
  const current=db();
  current.books[0].status='available';
  current.books[0].borrowedBy=null;
  current.students[0].borrowedBooks=[];
  const ambiguous=source(0,{classContext:['Klas A']},
    {barcode:'4711002'});
  ambiguous.status='warning';
  ambiguous.issues=[{code:'class_context_needs_review',
    severity:'warning'}];
  const priorLoan=source(1,loan('lisa','Lisa Leerling'),
    {barcode:'4711001'});
  const receipt=excelLoanReceiptKey('copy-1',{type:'student',id:'lisa'});
  const result=plan([ambiguous,priorLoan],current,{
    parts:parts({loans:true,locations:true}),
    loanReceipts:[receipt],
  });
  assert.equal(result.ok,true);
  assert.equal(result.summary.previouslyImportedLoans,1);
  const kept=result.assignments.differences.find(x=>x.kind==='class_context');
  assert.ok(kept,'A vague class note remains visible');
  assert.equal(kept.choice,'keep');
  assert.equal(kept.automatic,true);
  assert.equal(kept.autoKept,true);
  assert.equal(result.summary.pendingAssignments,0);
  assert.equal(result.summary.readyToApply,true);
}
// Codex P2: unknown Examenmateriaal is advisory, not an instruction to
// overwrite an existing true exam-list flag with parsed fallback false.
{
  const current=db();
  for(const book of current.books)book.suitableForExamList=true;
  const invalid=source(0,{},{
    suitableForExamList:false,
    publisher:'Betrouwbare uitgever',
  },{
    suitableForExamList:{source:'excel',raw:'misschien'},
    publisher:{source:'excel',raw:'Betrouwbare uitgever'},
  });
  invalid.status='warning';
  invalid.issues=[{code:'unexpected_exam_material_value',
    severity:'warning',raw:'misschien'}];
  const outcome=plan([invalid],current,{
    parts:parts({fields:{suitableForExamList:true,publisher:true}}),
  });
  assert.equal(outcome.ok,true);
  assert.equal(outcome.summary.pendingMetadata,0);
  assert.equal(outcome.summary.metadataFields,1);
  assert.equal(outcome.metadata.updates[0].field,'publisher');
  assert.equal(outcome.metadata.updates.some(update=>
    update.field==='suitableForExamList'),false,
    'Never import a false fallback after an unknown exam material value');
  const standalone=plan([invalid],current,{
    parts:parts({fields:{suitableForExamList:true}}),
  });
  assert.equal(standalone.summary.metadataFields,0);
}
// Codex P2: automatic enrichment is fill-only for newly created copies.
// It must not overwrite an explicit Excel publisher or cover even when
// existing books of the ISBN are missing those fields.
{
  const isbn=ISBN;
  const copyFor=(extra={})=>({
    editionIsbn:isbn,publisher:'Schooluitgever',
    coverUrl:'https://example.org/schoolcover.jpg',...extra,
  });
  const sourceUpdate=(field,value)=>({
    isbn,field,value,chosenSource:'source',enrichmentOnly:true,
  });
  const onlinePublisher=sourceUpdate('publisher','Online uitgever');
  const onlineCover=sourceUpdate('coverUrl','https://example.org/online.jpg');
  assert.equal(shouldApplyMetadataToCreatedCopy(onlinePublisher,copyFor()),false);
  assert.equal(shouldApplyMetadataToCreatedCopy(onlineCover,copyFor()),false);
  assert.equal(shouldApplyMetadataToCreatedCopy(onlinePublisher,
    copyFor({publisher:''})),true);
  assert.equal(shouldApplyMetadataToCreatedCopy(onlineCover,
    copyFor({coverUrl:''})),true);
  assert.equal(shouldApplyMetadataToCreatedCopy(onlineCover,
    copyFor({coverUrl:'',importProvenance:{fieldSources:{
      coverUrl:{sourceType:'manual'},
    }}})),false);
  assert.equal(shouldApplyMetadataToCreatedCopy({
    ...onlinePublisher,enrichmentOnly:false,
  },copyFor()),true,
  'Explicitly synchronized metadata still applies across all copies');
  assert.equal(shouldApplyMetadataToCreatedCopy({
    ...onlinePublisher,isbn:SECOND,
  },copyFor({publisher:''})),false);
  const existing=db();
  existing.books.forEach(book=>{book.publisher='';});
  const enriched=source(0,{},{
    publisher:'Online uitgever',
  },{publisher:{source:'metadata',detail:'Google Books'}});
  const planResult=plan([enriched],existing,{parts:parts({books:true})});
  assert.equal(planResult.ok,true);
  assert.equal(planResult.metadata.updates[0].enrichmentOnly,true,
    'The preview carries the fill-only constraint all the way to confirmation');
}

// A complete loan snapshot must use the same physical assignment as the
// planner. An ISBN-only loan to Tim uses the free copy; Lisa's older loan
// is absent from the snapshot and must be offered for review.
{
  const current=db();
  const result=plan([source(0,loan('tim','Tim Leerling'))],current,{
    parts:parts({loans:true}),loanHistoryMode:'correct',fullLoanSnapshot:true,
  });
  assert.equal(result.ok,true);
  const changes=result.assignments.differences;
  assert.equal(changes.find(item=>item.after?.id==='tim')?.bookId,'copy-2');
  assert.equal(changes.find(item=>item.missingFromSnapshot)?.bookId,'copy-1');
  assert.equal(current.books[0].borrowedBy,'lisa',
    'A preview must never silently clear an existing loan');

  const unchanged=plan([source(0,loan('lisa','Lisa Leerling'))],db(),{
    parts:parts({loans:true}),loanHistoryMode:'correct',fullLoanSnapshot:true,
  });
  assert.equal(unchanged.ok,true);
  assert.equal(unchanged.assignments.differences.some(item=>
    item.missingFromSnapshot),false,
    'A matching ISBN-only borrower row represents the existing physical loan');
}


// A complete snapshot that adds a new physical copy must retain the exact
// reviewed synthetic row for Alice's missing loan. Reconstructing against
// old stock would wrongly allocate Bob's loan to Alice's copy instead.
{
  const current=db();
  current.books=[current.books[0]];
  const result=plan([
    source(0,loan('tim','Tim Leerling'),{barcode:''}),
    source(1,{},{barcode:''}),
  ],current,{
    parts:parts({books:true,loans:true}),
    loanHistoryMode:'correct',fullLoanSnapshot:true,
  });
  assert.equal(result.ok,true);
  assert.equal(result.summary.newCopies,1);
  const alice=result.assignments.differences.find(d=>d.missingFromSnapshot);
  assert.ok(alice,'Existing Alice loan must be checked against new stock');
  assert.equal(alice.bookId,'copy-1');
  const row=result.reviewedAssignmentRows.find(r=>r.index===alice.rowIndex);
  assert.ok(row,'Deferred task source must be the exact reviewed synthetic row');
  assert.equal(row.missingFromExcel,true);
  assert.equal(row.book.title,'Oorlogswinter');
  assert.equal(result.assignments.differences.find(d=>d.after?.id==='tim')
    ?.bookId.startsWith('unified-preview-copy:'),true);
}

console.log('Unified import: independent checkboxes, virtual copies, metadata and no implicit deletions OK');
