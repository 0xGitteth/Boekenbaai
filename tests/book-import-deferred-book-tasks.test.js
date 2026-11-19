'use strict';
const assert=require('node:assert/strict');
const {listDeferredBookTasks,resolveDeferredBookTask}=
  require('../book-import-deferred-book-tasks');
const admin={role:'admin',id:'admin-1'};
const db={bookImportDeferredBookChecks:[
  {id:'first',batchId:'b1',fileName:'bibliotheek.xlsx',
    worksheetRow:75,title:'Het zwarte gat',author:'Donald Duck',
    excelIdentifier:'9789663058674',status:'open',
    createdAt:'2026-11-16T15:00:00Z'},
  {id:'second',batchId:'b1',fileName:'bibliotheek.xlsx',
    worksheetRow:248,title:'Julius zebra',author:'Gary Northfield',
    status:'open',createdAt:'2026-11-16T15:10:00Z'},
  {id:'old',status:'completed',createdAt:'2026-11-16T15:00:00Z'},
]};
assert.equal(listDeferredBookTasks(db).summary.open,2);
assert.equal(resolveDeferredBookTask(db,{role:'teacher',id:'t'},'first',1,'manual_done').ok,false);
assert.equal(resolveDeferredBookTask(db,admin,'first',2,'manual_done').ok,false);
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'keep_deferred').unchanged,true);
assert.equal(listDeferredBookTasks(db).summary.open,2);
// An administrative conclusion is not a physical observation. It requires
// an explicit catalogue copy, a current revision and written source evidence.
const reviewed={
  books:[{id:'book-1',title:'Matilda',author:'Roald Dahl',
    metadataIsbn:'9780582401983',barcode:'582401984'}],
  bookImportDeferredBookChecks:[{id:'admin-row',batchId:'batch-one',
    worksheetRow:61,title:'Matilda',author:'Roald Dahl',
    excelIdentifier:'582401984',status:'open',revision:1}],
};
const candidates=listDeferredBookTasks(reviewed).tasks[0].catalogCandidates;
assert.equal(candidates.length,1);
assert.equal(candidates[0].id,'book-1');
const evidence={bookId:'book-1',reason:'source_identifier_corrected',
  evidenceNote:'Excelrij 61 correspondeert met de unieke bewaarde barcode.',
  confirmed:true};
assert.equal(resolveDeferredBookTask(reviewed,admin,'admin-row',1,
  'administrative_done',undefined,{...evidence,confirmed:false}).ok,false);
assert.equal(resolveDeferredBookTask(reviewed,admin,'admin-row',1,
  'administrative_done',undefined,{...evidence,bookId:'wrong'}).ok,false);
assert.equal(resolveDeferredBookTask(reviewed,admin,'admin-row',1,
  'administrative_done',undefined,evidence).ok,true);
assert.equal(reviewed.bookImportDeferredBookChecks[0].resolution,'administrative_done');
assert.equal(reviewed.bookImportDeferredBookChecks[0].administrativeEvidence.bookId,'book-1');
assert.equal(reviewed.bookImportDeferredBookTaskHistory[0].action,'administrative_done');
assert.equal(reviewed.books[0].barcode,'582401984',
  'Administrative closure must never mutate an actual catalogue book');
const mismatch={
  books:[{id:'other-edition',title:'Het web',author:'Johan Heyink',
    metadataIsbn:'9789026997471'}],
  bookImportDeferredBookChecks:[{id:'conflict',title:'Het web',
    author:'Johan Heyink',editionIsbn:'9789001561383',
    status:'open',revision:1}],
};
assert.equal(listDeferredBookTasks(mismatch).tasks[0].catalogCandidates.length,0);
assert.equal(resolveDeferredBookTask(mismatch,admin,'conflict',1,
  'administrative_done',undefined,{...evidence,bookId:'other-edition'}).ok,false,
  'Known conflicting ISBN editions must not be closed as administratively verified');
const duplicateId={
  books:[{id:'duplicate-copy',title:'Matilda',author:'Roald Dahl'},
    {id:'duplicate-copy',title:'Matilda',author:'Roald Dahl'}],
  bookImportDeferredBookChecks:[{id:'source-copy',title:'Matilda',
    author:'Roald Dahl',status:'open',revision:1}],
};
assert.equal(resolveDeferredBookTask(duplicateId,admin,'source-copy',1,
  'administrative_done',undefined,{...evidence,bookId:'duplicate-copy'}).ok,false,
  'An ambiguous or duplicated physical ID must never be accepted');
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'manual_done').ok,true);
assert.equal(listDeferredBookTasks(db).summary.open,1);
assert.equal(db.bookImportDeferredBookChecks[0].revision,2);
assert.equal(db.bookImportDeferredBookTaskHistory.length,1);
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'manual_done').ok,false);
console.log('Persistent postponed book tasks: OK');
