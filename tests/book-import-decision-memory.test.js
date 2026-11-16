'use strict';
const assert=require('node:assert/strict');
const {sourceIdentity,safeRowReplays,recordBookReviewChoices,
  recordMetadataReviewChoices}=require('../book-import-decision-memory');
const ISBN='9780306406157';
const initial={
  'Titel':'Ravelijn','Auteur':'Paul van Loon',
  'ISBN-nummer':ISBN,'Aantal':1,'naam leerling':'Lisa Leerling',
};
const source=[initial];
const db={books:[{
  id:'book-a',title:'Raveleijn',author:'Paul van Loon',editionIsbn:ISBN,
  status:'borrowed',borrowedBy:'lisa',
}],bookImportReports:[]};
const corrected={rows:[{book:{title:'Raveleijn',author:'Paul van Loon',editionIsbn:ISBN}}]};
assert.ok(sourceIdentity(initial));
const count=recordBookReviewChoices(db,source,[{index:0,fields:{title:'Raveleijn'}}],
  corrected,'confirmed-1','2026-11-16T20:00:00Z');
assert.equal(count,1);
assert.equal(db.bookImportDecisionMemory.length,1);
const remembered=safeRowReplays(db,source);
assert.equal(remembered.fieldsReused,1);
assert.equal(remembered.rowsReused,1);
assert.deepEqual(remembered.corrections,[{index:0,fields:{title:'Raveleijn'}}]);
assert.equal(db.books[0].status,'borrowed','Never alter the current circulation state');
assert.equal(db.books[0].borrowedBy,'lisa');

// Updating a loan or classroom note changes neither an ISBN nor a book
// correction, but never replays those administrative fields.
const changedLoan={...initial,'naam leerling':'Dex','Geleend door klas':'Structuur'};
const loanReplay=safeRowReplays(db,[changedLoan]);
assert.deepEqual(loanReplay.corrections,[{index:0,fields:{title:'Raveleijn'}}]);
assert.equal(Object.keys(loanReplay.corrections[0].fields).length,1);
const differentSource={...initial,Titel:'Raveleijn'};
assert.equal(safeRowReplays(db,[differentSource]).fieldsReused,0,
  'Changed original title requires a new review');
const differentIsbn={...initial,'ISBN-nummer':'9780439554930'};
assert.equal(safeRowReplays(db,[differentIsbn]).fieldsReused,0,
  'Changed edition identity invalidates approval');
const editedBook={...db,books:[{...db.books[0],title:'Nieuw handmatig aangepast'}]};
assert.equal(safeRowReplays(editedBook,source).fieldsReused,0,
  'More recent manual catalogue edit may never be overwritten');
const absentCopy={...db,books:[]};
assert.equal(safeRowReplays(absentCopy,source).fieldsReused,0,
  'Deleted physical edition invalidates the saved correction');
const cancelled={books:[{...db.books[0]}]};
recordBookReviewChoices(cancelled,source,[{
  index:0,skip:true,fields:{title:'Raveleijn',studentLoan:'Dex'},
}],corrected,'skip','2026-11-16T20:01:00Z');
assert.deepEqual(cancelled.bookImportDecisionMemory,[],
  'Postponed/skip rows never become automatic approval');
const fake={books:[{...db.books[0]}]};
recordBookReviewChoices(fake,source,[{index:0,fields:{
  studentLoan:'Dex',fixedClass:'Structuur',barcode:'4711002',quantity:'3',
}}],corrected,'unsafe','2026-11-16T20:01:00Z');
assert.deepEqual(fake.bookImportDecisionMemory,[],
  'Physical, loan and location choices must never be persisted as book values');
const contradictory={books:[{...db.books[0]}]};
recordBookReviewChoices(contradictory,[initial,{...initial}],[
  {index:0,fields:{title:'Raveleijn'}},
  {index:1,fields:{title:'Raveleijn (andere druk)'}},
],{rows:[corrected.rows[0],corrected.rows[0]]},'same-batch','2026-11-16T20:02:00Z');
assert.equal(contradictory.bookImportDecisionMemory.length,0,
  'Conflicting choices for indistinguishable physical copies must not be learned');
const metadataOnly={books:[db.books[0]]};
assert.equal(recordMetadataReviewChoices(metadataOnly,[{
  isbn:ISBN,field:'title',confidence:'manual',
  action:'keep',excel:'Ravelijn',after:'Raveleijn',
},{
  isbn:ISBN,field:'loan',confidence:'manual',after:'Dex',excel:'Lisa',
}], 'meta-1','2026-11-16T22:00:00Z'),1);
assert.deepEqual(metadataOnly.bookImportManualMetadataMemory.map(x=>x.field),
  ['title'],'No pupil/loan decisions may enter durable metadata memory');
// The school's actual source uses separate author columns and numeric ISBNs,
// while older saved copies may carry that ISBN only as their barcode.
const schoolRow={'Achternaam schrijver':'Abbema, van',
  'Voornaam schrijver':'Hinke','Titel':'Door jou ben ik mij',
  'ISBN-nummer':9789043531788,Examenmateriaal:'Ja'};
const schoolDb={books:[{
  id:'book-school',title:'Door jou ben ik mij',author:'Hinke van Abbema',
  barcode:'9789043531788',editionIsbn:'',metadataIsbn:'',
}]};
assert.equal(recordBookReviewChoices(schoolDb,[schoolRow],
  [{index:0,fields:{author:'Hinke van Abbema'}}],
  {rows:[{book:{editionIsbn:'9789043531788'}}]},
  'school-1','2026-11-16T22:30:00Z'),1);
assert.deepEqual(safeRowReplays(schoolDb,[schoolRow]).corrections,
  [{index:0,fields:{author:'Hinke van Abbema'}}],
  'Approved values from actual numeric-ISBN/split-author school sheets are reusable');
console.log('Durable book import memory: reuse, changed source, post-edit, skip, privacy and ambiguity OK');
