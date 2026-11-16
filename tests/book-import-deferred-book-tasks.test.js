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
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'manual_done').ok,true);
assert.equal(listDeferredBookTasks(db).summary.open,1);
assert.equal(db.bookImportDeferredBookChecks[0].revision,2);
assert.equal(db.bookImportDeferredBookTaskHistory.length,1);
assert.equal(resolveDeferredBookTask(db,admin,'first',1,'manual_done').ok,false);
console.log('Persistent postponed book tasks: OK');
