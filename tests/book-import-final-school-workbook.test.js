'use strict';

const assert = require('node:assert/strict');
const { analyzeBookImportRows } = require('../book-import-analysis');
const { mapImportRow } = require('../book-import-workbook');
const { resolveReviewedLoan } = require('../book-import-loan-migration');
const { analyzeReviewedImport } = require('../book-import-review');
const ISBN='9789044611038';
let isbnCounter=0;
function nextValidIsbn(){
  const stem='978902'+String(++isbnCounter).padStart(6,'0');
  const weighted=stem.split('').reduce((sum,ch,index)=>sum+Number(ch)*(index%2?3:1),0);
  return stem+String((10-weighted%10)%10);
}
const classes=[
  {id:'skbb',name:'Bovenbouw structuur',studentIds:['dex','amelia','dex-duplicate']},
  {id:'obkt',name:'Onderbouw BKT',studentIds:['nena','dex-other']},
  {id:'skpro',name:'Onderbouw structuur pro-basis',studentIds:[]},
  {id:'t4',name:'VMBO theoretisch 4',studentIds:[]},
];
const students=[
  {id:'dex',name:'Dex Rombouts',firstName:'Dex',active:true,classIds:['skbb']},
  {id:'dex-other',name:'Dex Jansen',firstName:'Dex',active:true,classIds:['obkt']},
  {id:'nena',name:'Nena Bakker',firstName:'Nena',active:true,classIds:['obkt']},
  {id:'amelia',name:'Amelia De Wit',firstName:'Amelia',active:true,classIds:['skbb']},
];
const book=(title,overrides={})=>({
  Titel:title,Auteur:'Voorbeeld Auteur','ISBN-nummer':nextValidIsbn(),...overrides,
});
(async()=>{
  const original={
    'Achternaam schrijver':'Alexander','Voornaam schrijver':'Robert',
    Titel:'Bickerton Neveis','ISBN-nummer':'9789076106489',
    'Vast in de klas van:':'StructuurBB','Geleend door klas':'',
    'naam leerling':'',Kolom1:'a',
  };
  const mapped=mapImportRow(original);
  assert.equal(mapped.fields.fixedClass,'StructuurBB');
  assert.equal(mapped.fields.classLoan,'');
  assert.deepEqual(mapped.unknown.map(x=>x.header),['Kolom1']);
  const samples=[
    original,
    book('Vaste plek met leerling',{
      'Vast in de klas van:':'SKOBPRO',
      'naam leerling':'Amelia De Wit',
    }),
    book('In handen van leerling',{
      'Geleend door klas':'OndBKT','naam leerling':'Nena',
    }),
    book('Dex uit onderbouw',{
      'Geleend door klas':'OndBKT','naam leerling':'Dex',
    }),
    book('Klas leent',{
      'Geleend door klas':'T4',
    }),
    book('Vast en klassikaal uitgeleend',{
      'Vast in de klas van:':'StructuurBB','Geleend door klas':'T4',
    }),
    book('Persoonlijk exemplaar',{
      'Geleend door klas':'SKOBPRO','naam leerling':'eigen boek',
    }),
    book('Vaste locatie als notitie',{
      'Vast in de klas van:':'SKOBPRO','naam leerling':'vast in de klas',
    }),
    book('Onbekende leerling',{
      'Geleend door klas':'OndBKT','naam leerling':'Onbekend',
    }),
    book('Ongerelateerde extra column',{
      Kolom1:'gaat van de lijst',
    }),
  ];
  const analysis=await analyzeBookImportRows(samples,{
    students,classes,lookupIsbn:async()=>null,lookupTitleAuthor:async()=>null,
  });
  assert.equal(analysis.ok,true);
  const a=analysis.rows;
  assert.equal(a[0].context.fixedLocation.status,'resolved');
  assert.equal(a[0].context.fixedLocation.label,'Bovenbouw structuur');
  assert.equal(a[0].context.classLoan,undefined);
  assert.equal(a[1].context.fixedLocation.label,'Onderbouw structuur pro-basis');
  assert.equal(a[1].context.studentLoan.id,'amelia');
  assert.equal(a[2].context.studentLoan.id,'nena');
  assert.equal(a[2].context.classLoan,undefined,
    'The class of a named reader must not generate a second loan');
  assert.equal(a[2].context.studentClassHint.label,'OndBKT');
  assert.deepEqual(resolveReviewedLoan(a[2],{students,classes}).borrower,
    {type:'student',id:'nena',name:'Nena Bakker'});
  assert.equal(a[3].context.studentLoan.id,'dex-other',
    'A first name shared across classes should resolve only within the Excel class');
  assert.equal(a[4].context.classLoan.id,'t4');
  assert.equal(a[4].context.studentLoan,undefined);
  assert.equal(a[5].context.fixedLocation.label,'Bovenbouw structuur');
  assert.equal(a[5].context.classLoan.id,'t4');
  assert.equal(a[6].context.excludeFromSchoolCollection,true);
  assert.equal(a[7].context.fixedLocation.label,'Onderbouw structuur pro-basis');
  assert.equal(a[7].context.studentLoan,undefined);
  assert.equal(a[8].status,'conflict','Unknown current borrower must block, not fabricate a loan');
  assert.equal(a[9].context.excludeFromSchoolCollection,undefined,
    'Unknown note must never remove a school collection book');
  assert.equal(a[9].status,'ready','Unknown note is nonblocking');

  const ambiguous=await analyzeBookImportRows([book('Dubbel voornaam',{
    'Geleend door klas':'StructuurBB','naam leerling':'Dex',
  })],{
    students:[...students,{id:'dex-duplicate',name:'Dex Tweede',
      firstName:'Dex',active:true,classIds:['skbb']}],classes,
  });
  assert.equal(ambiguous.rows[0].status,'conflict');
  assert.equal(ambiguous.rows[0].context.studentLoan.status,'ambiguous');
  const corrected=await analyzeReviewedImport([book('Oude locatie',{
    'Vast in de klas van:':'StructuurBB',
  })],[{index:0,fields:{fixedClass:'T4'}}],{
    students,classes,lookupIsbn:async()=>null,lookupTitleAuthor:async()=>null,
    acceptWarnings:true,
  });
  assert.equal(corrected.ok,true);
  assert.equal(corrected.rows[0].context.fixedLocation.label,'VMBO theoretisch 4');
  console.log('Fixed classes, pupil+class hints, class loans, private books and ignored extra column OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
