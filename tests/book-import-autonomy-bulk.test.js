'use strict';
const assert=require('node:assert/strict');
const {buildUnifiedBookImport}=require('../book-import-unified-sync');

function isbn13(n){
  const base='97812345'+String(n).padStart(4,'0');
  const sum=[...base].reduce((total,digit,i)=>
    total+Number(digit)*(i%2?3:1),0);
  return base+String((10-sum%10)%10);
}
const rows=[],books=[];
for(let i=0;i<120;i++){
  const isbn=isbn13(i),part=String(i);
  books.push({
    id:'copy-'+i,editionIsbn:isbn,metadataIsbn:isbn,
    title:'Het schoolavontuurr deel '+part,author:'Jan Terlouw',
    authors:['Jan Terlouw'],barcode:'4711'+String(i).padStart(6,'0'),
    status:'available',borrowedBy:null,borrowedByClassId:null,
    fixedLocation:null,pageCount:210,
  });
  rows.push({
    index:i,sourceRowNumber:i+2,status:'warning',
    book:{
      title:'Het schoolavontuur deel '+part,author:'Jan Térlouw',
      authors:['Jan Térlouw'],
      editionIsbn:isbn,metadataIsbn:isbn,barcode:'',
      pageCount:214,quantity:{valid:true,value:1},
    },
    context:{classContext:['Klas A']},
    provenance:{pageCount:{source:'excel',raw:214}},
    issues:[
      {code:'metadata_differs_from_excel',field:'title',
        severity:'warning',reviewLevel:'informational'},
      {code:'class_context_needs_review',severity:'warning'},
    ],
  });
}
const db={books,students:[],classes:[{id:'a',name:'Klas A'}]};
const result=buildUnifiedBookImport({ok:true,rows},db,{
  parts:{books:true,loans:true,locations:true,
    fields:{pageCount:true}},
  acceptWarnings:false,
});
assert.equal(result.ok,true,JSON.stringify(result));
assert.equal(result.summary.pending,0,
  '120 bibliographic near matches and vague class notes must not create 120 manual tasks');
assert.equal(result.summary.blockedStock,0);
assert.equal(result.summary.pendingMetadata,0);
assert.equal(result.summary.pendingAssignments,0);
assert.equal(result.summary.preservedMetadata,120,
  'Small differences in pages are automatically retained and audited');
assert.equal(result.assignments.differences.filter(x=>x.autoKept).length,120);
assert.equal(result.summary.newCopies,0,
  'Reimporting existing ISBNs must not duplicate physical stock');
assert.equal(result.actionableSourceIssues.length,0,
  'Informative online data and unclassified class notes require no warning approval');
assert.equal(result.summary.readyToApply,true);
assert.equal(db.books[0].title,'Het schoolavontuurr deel 0',
  'Preview never changes stored copies');
console.log('Bulk import autonomy: 120 harmless discrepancies, 0 manual reviews, no duplicate copies');
