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
  assert.deepEqual(mapped.unknown,[]);
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
  // A first name initially identified within a class may not be silently
  // upgraded to the canonical full name when the pupil later moves class.
  // Revalidation must still use the exact source cell "Dex".
  assert.equal(a[3].context.studentLoan.excelName,'Dex');
  const movedDex=students.map(person=>person.id==='dex-other'
    ?{...person,classIds:['skbb']}:person);
  const movedClasses=classes.map(klass=>klass.id==='obkt'
    ?{...klass,studentIds:['nena']}:klass.id==='skbb'
      ?{...klass,studentIds:[...klass.studentIds,'dex-other']}:klass);
  assert.equal(resolveReviewedLoan(a[3],{
    students:movedDex,classes:movedClasses,
  }).ok,false,'A stale first-name-only match must not become a loan');

  const sameFullName=[
    {id:'same-1',name:'Sam Smith',firstName:'Sam',active:true,classIds:['skbb']},
    {id:'same-2',name:'Sam Smith',firstName:'Sam',active:true,classIds:['obkt']},
  ];
  const sameAnalysis=await analyzeBookImportRows([book('Gelijke volledige naam',{
    'Geleend door klas':'OndBKT','naam leerling':'Sam',
  })],{students:sameFullName,classes});
  assert.equal(sameAnalysis.rows[0].context.studentLoan.id,'same-2');
  assert.deepEqual(resolveReviewedLoan(sameAnalysis.rows[0],
    {students:sameFullName,classes}).borrower,
    {type:'student',id:'same-2',name:'Sam Smith'},
    'A global full-name collision must not block a class-qualified loan');
  assert.equal(sameAnalysis.rows[0].context.classLoan,undefined);

  // A current pupil may have moved class since the Excel was created.
  // Real uploaded workbook: row 234, H@CK het instituut, Rik Meerhoff,
  // old BK4 class label. The unique full name must not be silently dropped.
  const newClass={id:'current-t4',name:'VMBO theoretisch 4',studentIds:['rik']};
  const oldClass={id:'old-bk4',name:'VMBO basis-kader 4',studentIds:[]};
  const rik={id:'rik',name:'Rik Meerhoff',firstName:'Rik',
    lastName:'Meerhoff',active:true,classIds:['current-t4'],borrowedBooks:[]};
  const bookRik={
    'Achternaam schrijver':'Mous','Voornaam schrijver':'Mirjam',
    Titel:'H@CK het instituut ','ISBN-nummer':9789000366293,
    'Geleend door klas':'BK4','naam leerling':'Rik Meerhoff',
    Kolom1:'gaat van de lijst',
  };
  const rikImport=await analyzeBookImportRows([bookRik],{
    students:[rik],classes:[newClass,oldClass],lookupIsbn:async()=>null,
    lookupTitleAuthor:async()=>null,
  });
  assert.equal(rikImport.rows[0].context.studentLoan.id,'rik',
    'A uniquely identified full name must survive an outdated class hint');
  assert.ok(rikImport.rows[0].issues.some(issue=>
    issue.code==='student_class_hint_outdated'),
    'Warn that the Excel class and the current class differ');
  assert.equal(rikImport.rows[0].context.excludeFromSchoolCollection,undefined,
    'An unknown Excel note must not delete the book');
  assert.deepEqual(resolveReviewedLoan(rikImport.rows[0],{
    students:[rik],classes:[newClass,oldClass],
  }).borrower,{type:'student',id:'rik',name:'Rik Meerhoff'});
  const unsafeShort=await analyzeBookImportRows([book('Onzekere voornaam',{
    'Geleend door klas':'BK4','naam leerling':'Rik',
  })],{students:[rik],classes:[newClass,oldClass]});
  assert.notEqual(unsafeShort.rows[0].context.studentLoan.status,'matched',
    'A class mismatch cannot be bypassed with only a first name');
  const duplicateFull=await analyzeBookImportRows([book('Twee dezelfde namen',{
    'Geleend door klas':'BK4','naam leerling':'Rik Meerhoff',
  })],{students:[rik,{...rik,id:'rik-other'}],classes:[newClass,oldClass]});
  assert.equal(duplicateFull.rows[0].context.studentLoan.status,'ambiguous',
    'Duplicate full names must not create an automatic loan');
  
  // Ensure the editor exposes the filled source fields rather than blank
  // boxes that could trick staff into clearing or overwriting valid context.
  const fs=require('node:fs'),path=require('node:path');
  const ui=fs.readFileSync(path.join(__dirname,'..','public/admin-book-import-review.js'),'utf8');
  assert.match(ui,/field === 'fixedClass'/);
  assert.match(ui,/row.context\.fixedLocation\.raw/);
  assert.match(ui,/row.context\?\.studentClassHint\?\.label/);

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
