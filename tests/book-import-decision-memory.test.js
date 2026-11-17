'use strict';
const assert=require('node:assert/strict');
const {sourceIdentity,safeRowReplays,recordBookReviewChoices,
  recordMetadataReviewChoices,revalidateRememberedCorrections}
  =require('../book-import-decision-memory');
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
  {rows:[{book:{editionIsbn:'9789043531788',author:'Hinke van Abbema'}}]},
  'school-1','2026-11-16T22:30:00Z'),1);
assert.deepEqual(safeRowReplays(schoolDb,[schoolRow]).corrections,
  [{index:0,fields:{author:'Hinke van Abbema'}}],
  'Approved values from actual numeric-ISBN/split-author school sheets are reusable');

// Codex P2: URLs with differently cased paths can point to different cover
// images. A later manual correction must not be overwritten.
{
  const original={...initial,'Cover URL':'https://example.org/Cover.jpg'};
  const coverDb={books:[{...db.books[0],coverUrl:'https://example.org/Cover.jpg'}]};
  const fields=[{index:0,fields:{coverUrl:'https://example.org/Cover.jpg'}}];
  assert.equal(recordBookReviewChoices(coverDb,[original],fields,
    {rows:[{book:{...corrected.rows[0].book,coverUrl:'https://example.org/Cover.jpg'}}]},
    'cover-1','2026-11-16T20:00:00Z'),1);
  assert.equal(safeRowReplays(coverDb,[original]).fieldsReused,1);
  coverDb.books[0].coverUrl='https://example.org/cover.jpg';
  assert.equal(safeRowReplays(coverDb,[original]).fieldsReused,0,
    'Newer differently cased URL is a distinct manual choice');
  coverDb.books[0].coverUrl='https://example.org/Cover.jpg';
  assert.equal(safeRowReplays(coverDb,[{...original,
    'Cover URL':'https://example.org/cover.jpg'}]).fieldsReused,0,
    'A changed worksheet URL must not inherit an earlier approval');
}
// Codex P2: duplicated mapped columns must be included in the source
// fingerprint even when the first cell has not changed.
{
  const source={...initial,Tags:'avontuur'};
  const tagged={books:[{...db.books[0],tags:['mysterie']}]};
  const correctedTags=[{index:0,fields:{tags:'mysterie'}}];
  recordBookReviewChoices(tagged,[source],correctedTags,
    {rows:[{book:{...corrected.rows[0].book,tags:['mysterie']}}]},
    'tags-1','2026-11-16T20:00:00Z');
  assert.equal(safeRowReplays(tagged,[source]).fieldsReused,1);
  assert.equal(safeRowReplays(tagged,[{...source,
    Tags_1:'geschiedenis'}]).fieldsReused,0,
    'Adding a second source tags column must invalidate the old permission');
  assert.equal(safeRowReplays(tagged,[{...source,
    Tags_1:'avontuur'}]).fieldsReused,0,
    'Even an extra identical source column must be revalidated');
  const authorSource={...initial};
  const authors={books:[{...db.books[0],author:'Paul van Loon'}]};
  recordBookReviewChoices(authors,[authorSource],
    [{index:0,fields:{author:'Paul van Loon'}}],corrected,
    'author-1','2026-11-16T20:00:00Z');
  assert.equal(safeRowReplays(authors,[authorSource]).fieldsReused,1);
  assert.equal(safeRowReplays(authors,[{...authorSource,
    Auteur_1:'Andere auteur'}]).fieldsReused,0,
    'A new conflicting author column is never hidden by an old correction');
}
// Codex P2: an inherited correction remains clearly distinguishable from a
// subsequent genuine manual edit, including for a resumed import draft.
{
  const staged=remembered.corrections;
  const edited={...db,books:[{...db.books[0],title:'Handmatig nieuwe titel'}]};
  const rejected=revalidateRememberedCorrections(edited,source,staged,staged);
  assert.equal(rejected.invalidated,1);
  assert.deepEqual(rejected.corrections,[],
    'Older approval is not consent to revert the updated library title');
  const deliberate=revalidateRememberedCorrections(edited,source,[{
    index:0,fields:{title:'Bewust nieuwe keuze',publisher:'Uitgever'},
  }],staged);
  assert.equal(deliberate.invalidated,0);
  assert.deepEqual(deliberate.corrections,[{
    index:0,fields:{title:'Bewust nieuwe keuze',publisher:'Uitgever'},
  }],'A real review edit must be retained');
  const stillValid=revalidateRememberedCorrections(db,source,staged,staged);
  assert.equal(stillValid.invalidated,0);
  assert.deepEqual(stillValid.corrections,staged);
}

// The saved input is not necessarily the value stored in the library.
// Language and list fields are parsed into canonical values at import time.
{
  const original={...initial,Taal:'Nederlands',Tags:'avontuur'};
  const canonical={books:[{...db.books[0],language:'nl',
    tags:['fantasie','mysterie']}]};
  const rows=[{book:{...corrected.rows[0].book,
    language:'nl',tags:['fantasie','mysterie']}}];
  const saved=recordBookReviewChoices(canonical,[original],[{
    index:0,fields:{language:'Nederlands',tags:'fantasie, mysterie'},
  }],{rows},'canonical-1','2026-11-17T07:00:00Z');
  assert.equal(saved,2);
  assert.deepEqual(safeRowReplays(canonical,[original]).corrections,[{
    index:0,fields:{language:'Nederlands',tags:'fantasie, mysterie'},
  }],'The original correction must replay after catalog normalization');
  canonical.books[0].language='en';
  assert.deepEqual(safeRowReplays(canonical,[original]).corrections,[{
    index:0,fields:{tags:'fantasie, mysterie'},
  }],'A more recent manual language change must still be protected');
}
// Two successive ISBN choices for the same source row cannot combine a
// title approved for edition A with a later ISBN correction to edition B.
{
  const raw={...initial,'ISBN-nummer':'9780306406156'};
  const editionA={...db.books[0],title:'Correct voor A'};
  const editionB={...db.books[0],id:'book-b',title:'Correct voor B',
    editionIsbn:'9780439554930'};
  const library={books:[editionA,editionB]};
  recordBookReviewChoices(library,[raw],[{
    index:0,fields:{editionIsbn:ISBN,title:'Correct voor A'},
  }],{rows:[{book:{...corrected.rows[0].book,title:'Correct voor A',
    editionIsbn:ISBN}}]},'edition-a','2026-11-16T22:00:00Z');
  recordBookReviewChoices(library,[raw],[{
    index:0,fields:{editionIsbn:'9780439554930'},
  }],{rows:[{book:{...corrected.rows[0].book,title:'Correct voor B',
    editionIsbn:'9780439554930'}}]},'edition-b','2026-11-17T06:00:00Z');
  assert.deepEqual(safeRowReplays(library,[raw]).corrections,[{
    index:0,fields:{editionIsbn:'9780439554930'},
  }],'Never pair a remembered title for edition A with edition B');
}

console.log('Durable book import memory: reuse, changed source, post-edit, skip, privacy and ambiguity OK');
