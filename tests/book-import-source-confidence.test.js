'use strict';
const assert=require('node:assert/strict');
const {equivalentSpelling,independentVotes,sourceConsensus,decide}=
  require('../book-import-source-confidence');
const {buildUnifiedBookImport}=require('../book-import-unified-sync');
const ISBN='9780306406157';
const votes=[
 {source:'googlebooks',editionIsbn:ISBN,author:'René van Dijk',title:'De Avonturen'},
 {source:'openlibrary',editionIsbn:ISBN,author:'René van Dijk',title:'De Avonturen'},
 {source:'isbnbarcode.org',editionIsbn:ISBN,author:'René van Dijk',title:'De Avonturen'},
];
assert.equal(equivalentSpelling('Rene van Dijk','René van Dijk'),true);
assert.equal(equivalentSpelling('Rene van Dijk','René van Dijk Jr.'),false);
assert.equal(sourceConsensus(ISBN,'author',votes).agreeing,3);
assert.equal(decide({isbn:ISBN,field:'author',excel:'Rene van Dijk',
  current:'Rene van Dijk',evidence:votes}).confidence,'high');
assert.equal(decide({isbn:ISBN,field:'author',excel:'Rene van Dijk',
  current:'Rene van Dijk',evidence:votes}).value,'René van Dijk');
assert.equal(decide({isbn:ISBN,field:'author',excel:'Rene van Dijk',
  current:'Rene van Dijk',evidence:[votes[0]]}).confidence,'medium');
assert.equal(sourceConsensus(ISBN,'author',[
 votes[0],votes[0],{...votes[1],editionIsbn:'9780439554930'},
]).agreeing,1,'Duplicate or wrong ISBN evidence cannot create consensus');
assert.equal(independentVotes(ISBN,'description',votes).length,0,
  'No automatic source voting for unsupported or sensitive fields');
const substantive=decide({isbn:ISBN,field:'title',excel:'Een heel ander boek',
  current:'De Avonturen',evidence:votes});
assert.equal(substantive.action,'keep');
assert.equal(substantive.confidence,'medium');

const row=(index,extra={})=>({
  index,sourceRowNumber:index+2,status:'ready',
  book:{title:'De Avonturen',author:'Rene van Dijk',
    authors:['Rene van Dijk'],editionIsbn:ISBN,metadataIsbn:ISBN,
    quantity:{valid:true,value:1},...extra.book},
  provenance:{author:{source:'excel',raw:'Rene van Dijk'},
    ...(extra.provenance||{})},
  sourceEvidence:extra.sourceEvidence===undefined?votes:extra.sourceEvidence,
  context:{},issues:[],
});
const database=()=>({books:[{
  id:'copy-1',title:'De Avonturen',author:'Rene van Dijk',
  authors:['Rene van Dijk'],editionIsbn:ISBN,metadataIsbn:ISBN,
  status:'available',
}],students:[],classes:[]});
const parts=(fields)=>({books:false,loans:false,locations:false,fields});
const plan=(rows,db,fields,extra={})=>buildUnifiedBookImport(
  {ok:true,rows},db,{parts:parts(fields),...extra});
{
  const result=plan([row(0)],database(),{author:true});
  assert.equal(result.ok,true);
  assert.equal(result.summary.confidentMetadata,1);
  assert.equal(result.summary.pendingMetadata,0);
  assert.equal(result.metadata.updates[0].value.value,'René van Dijk');
  assert.equal(result.metadata.updates[0].sourceCount,3);
  assert.deepEqual(result.metadata.updates[0].sources,
    ['googlebooks','isbnbarcode.org','openlibrary']);
  assert.equal(result.metadata.automaticDecisions[0].confidence,'high');
  assert.equal(result.summary.readyToApply,true);
  assert.equal(database().books[0].author,'Rene van Dijk',
    'A preview cannot modify the persisted library');
}
{
  const result=plan([row(0,{sourceEvidence:[]})],database(),{author:true});
  assert.equal(result.ok,true);
  assert.equal(result.summary.confidentMetadata,0);
  assert.equal(result.summary.pendingMetadata,0);
  assert.equal(result.summary.metadataFields,0,
    'No independent evidence must not invent an accent correction');
}
{
  const db=database();
  const incoming=row(0,{book:{title:'Een heel ander boek'},
    provenance:{title:{source:'excel',raw:'Een heel ander boek'}}});
  const prediction=plan([incoming],db,{title:true});
  assert.equal(prediction.ok,true);
  assert.equal(prediction.summary.pendingMetadata,0);
  assert.equal(prediction.summary.preservedMetadata,1);
  assert.equal(prediction.summary.metadataFields,0,
    'Substantive uncertainty can safely keep current title');
  const selected=plan([incoming],db,{title:true},
    {metadataResolutions:[{id:ISBN+':title',action:'excel'}]});
  assert.equal(selected.ok,true);
  assert.equal(selected.summary.metadataFields,1,
    'Admin can explicitly replace a safe automatic keep with Excel');
  assert.equal(selected.metadata.updates[0].value,'Een heel ander boek');
}
{
  const db=database();
  db.books[0].pageCount=200;
  const bad=row(0,{book:{pageCount:null},provenance:{
    pageCount:{source:'excel',raw:'geen getal'},
  },sourceEvidence:[]});
  bad.status='warning';
  bad.issues=[{code:'invalid_page_count',severity:'warning',raw:'geen getal'}];
  const result=plan([bad],db,{pageCount:true});
  assert.equal(result.ok,true);
  assert.equal(result.summary.pendingMetadata,0);
  assert.equal(result.summary.preservedMetadata,1);
  assert.equal(result.summary.readyToApply,true,
    'Invalid nonessential metadata should not require a manual choice');
  assert.equal(plan([bad],db,{pageCount:true},{
    metadataResolutions:[{id:ISBN+':pageCount',action:'excel'}],
  }).error,'unsafe_metadata_override');
}
{
  const db=database();
  const a=row(0,{book:{title:'Eerste boek'},sourceEvidence:[],
    provenance:{title:{source:'excel',raw:'Eerste boek'}}});
  const b=row(1,{book:{title:'Ander boek'},sourceEvidence:[],
    provenance:{title:{source:'excel',raw:'Ander boek'}}});
  const result=plan([a,b],db,{title:true});
  assert.equal(result.summary.pendingMetadata,1,
    'Two different titles for one ISBN are genuine, not silently dropped');
}

{
  const voted=[
    {source:'Bureau ISBN',editionIsbn:ISBN,
      author:'René van Dijk & Piet Jansen',
      authors:['René van Dijk','Piet Jansen']},
    {source:'Google Books',editionIsbn:ISBN,
      author:'René van Dijk & Piet Jansen',
      authors:['René van Dijk','Piet Jansen']},
  ];
  const db=database();
  db.books[0].author='Rene van Dijk & Piet Jansen';
  db.books[0].authors=['Rene van Dijk','Piet Jansen'];
  const rowValue=row(0,{book:{
    author:'Rene van Dijk & Piet Jansen',
    authors:['Rene van Dijk','Piet Jansen'],
  },sourceEvidence:voted,
    provenance:{author:{source:'excel',raw:'Rene van Dijk & Piet Jansen'}}});
  const result=plan([rowValue],db,{author:true});
  assert.equal(result.summary.confidentMetadata,1);
  assert.deepStrictEqual(result.metadata.updates[0].value.authors,
    ['René van Dijk','Piet Jansen'],
    'Source spelling corrections must preserve individual author records');
}
{
  const result=plan([row(0)],database(),{author:true},{
    metadataResolutions:[{id:ISBN+':author',action:'keep'}],
  });
  assert.equal(result.ok,true);
  assert.equal(result.metadata.updates.length,0);
  assert.equal(result.metadata.automaticDecisions.length,1,
    'An explicit keep must be included in the saved decision audit');
  assert.equal(result.metadata.automaticDecisions[0].action,'keep');
  assert.equal(result.metadata.automaticDecisions[0].confidence,'manual');
  assert.equal(result.metadata.automaticDecisions[0].sourceCount,3);
  assert.equal(result.metadata.automaticDecisions[0].before,'Rene van Dijk');
  assert.equal(result.metadata.automaticDecisions[0].after,'Rene van Dijk');
  assert.equal(result.summary.readyToApply,true,
    'A keep-only review must be confirmable to persist the audit');
}
{
  const tie=[
    {source:'Bureau ISBN',editionIsbn:ISBN,title:'Een ander boek'},
    {source:'Google Books',editionIsbn:ISBN,title:'Een derde boek'},
  ];
  const result=decide({isbn:ISBN,field:'title',excel:'Een ander boek',
    current:'De Avonturen',evidence:tie});
  assert.equal(result.action,'keep',
    'Tied source votes must not override a substantively different stored title');
}
console.log('Verified ISBN source consensus, automatic keeps and manual overrides OK');

// Complete worksheet rows must still consult providers when the user opts in
// to ISBN enrichment. Previously, the missing-fields guard skipped these.
const {resolveMetadata}=require('../book-import-analysis-metadata');
(async()=>{
  let calls=0;
  const complete=row(0,{book:{
    title:'De Avonturen',author:'René van Dijk',authors:['René van Dijk'],
    publisher:'Uitgever',publishedYear:2020,pageCount:220,language:'nl',
    coverUrl:'https://example.org/cover.jpg',description:'Beschrijving',
    tags:['spannend'],themes:['avontuur'],
  }});
  await resolveMetadata(complete,{});
  assert.equal(calls,0,'No lookup occurs without a provided opt-in resolver');
  await resolveMetadata(complete,{lookupIsbn:async()=>{
    calls++;
    return {found:true,metadata:{isbn13:ISBN,title:'De Avonturen',
      author:'René van Dijk',publisher:'Uitgever'},
      sourceCandidates:[
        {source:'Google Books',isbn13:ISBN,title:'De Avonturen',
          author:'René van Dijk'},
        {source:'Open Library',isbn13:ISBN,title:'De Avonturen',
          author:'René van Dijk'},
      ]};
  }});
  assert.equal(calls,1,'Complete rows still need opted-in verification');
  assert.equal(complete.sourceEvidence.length,2,
    'Independent providers remain visible for confidence decisions');
})().catch(error=>{console.error(error);process.exitCode=1;});
