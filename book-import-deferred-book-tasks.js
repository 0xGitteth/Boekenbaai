'use strict';

const crypto = require('node:crypto');

const identity = value => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL')
  .replace(/\s+/g,' ').trim();
function editionGroupKey(item) {
  // Never group two unresolved books without enough identity evidence.
  const identifier=identity(item.editionIsbn || item.excelIdentifier);
  const title=identity(item.title),author=identity(item.author);
  if (!identifier || !title || !author)
    return JSON.stringify(['unverified',item.id]);
  // Different ISBN editions must never be grouped as the same edition.
  return JSON.stringify([identifier,title,author]);
}
function inCurrentCollection(db,item) {
  const title=identity(item.title),author=identity(item.author);
  const isbn=identity(item.editionIsbn);
  return Boolean(title && author && isbn && (db.books || []).some(book =>
    identity(book.title)===title && identity(book.author)===author
      && [book.metadataIsbn,book.barcode,book.isbn]
        .some(candidate=>identity(candidate)===isbn)));
}
function listDeferredBookTasks(db) {
  const items = Array.isArray(db.bookImportDeferredBookChecks)
    ? db.bookImportDeferredBookChecks : [];
  const tasks = items.filter(item => item && item.status === 'open')
    .map(item => ({
      id: item.id, reportId: item.batchId || null,
      title: item.title || '', author: item.author || '',
      excelIdentifier: item.excelIdentifier || '',
      editionIsbn: item.editionIsbn || '',
      worksheetRow: item.worksheetRow,
      fileName: item.fileName || '', createdAt: item.createdAt || null,
      revision: Number.isSafeInteger(item.revision) ? item.revision : 1,
      kind: 'book_identity',
    }))
    .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const sameEditionCounts=new Map();
  for(const task of tasks) {
    const key=editionGroupKey(task);
    sameEditionCounts.set(key,(sameEditionCounts.get(key)||0)+1);
  }
  for(const task of tasks) {
    task.sameEditionGroup=editionGroupKey(task);
    task.sameEditionCount=sameEditionCounts.get(task.sameEditionGroup)||1;
    // This is a HINT, never proof that the original physical copy was
    // identified. Do not auto-close tasks or edit book/loan data.
    task.possibleExistingEdition=inCurrentCollection(db,task);
  }
  return { tasks, summary: {
    open:tasks.length,
    groups:sameEditionCounts.size,
    repeatedChecks:tasks.length-sameEditionCounts.size,
  } };
}
function resolveDeferredBookTask(db, actor, id, revision, choice,
  now = new Date().toISOString()) {
  if (actor?.role !== 'admin') return {ok:false,error:'forbidden'};
  if (!['manual_done','keep_deferred'].includes(choice)
    || !Number.isSafeInteger(revision)) return {ok:false,error:'invalid_choice'};
  const task = (db.bookImportDeferredBookChecks || [])
    .find(item => item.id === id && item.status === 'open');
  if (!task) return {ok:false,error:'not_found'};
  const current = Number.isSafeInteger(task.revision) ? task.revision : 1;
  if (revision !== current) return {ok:false,error:'stale_choice'};
  if (choice === 'keep_deferred') return {ok:true,unchanged:true};
  task.status = 'completed';
  task.revision = current + 1;
  task.completedAt = now;
  task.completedBy = actor.id;
  task.resolution = 'manual_done';
  if (!Array.isArray(db.bookImportDeferredBookTaskHistory))
    db.bookImportDeferredBookTaskHistory = [];
  db.bookImportDeferredBookTaskHistory.push({
    id: crypto.randomUUID(), taskId: task.id, action: 'manual_done',
    actorId: actor.id, timestamp: now,
  });
  return {ok:true,id:task.id,status:'completed'};
}
function retainDeferredBookChecks(db, candidates) {
  if (!Array.isArray(db.bookImportDeferredBookChecks)) db.bookImportDeferredBookChecks=[];
  const fields=['batchId','worksheetRow','title','author','excelIdentifier','editionIsbn','bookId','barcode','sourceEvidence'];
  for (const candidate of candidates) {
    // Only repeated emission of the SAME source event can be suppressed.
    // A filename/row/ISBN match in a later import is not physical identity.
    const duplicate=candidate.batchId && Number.isSafeInteger(candidate.worksheetRow)
      && db.bookImportDeferredBookChecks.some(item=>item.status==='open'
        && fields.every(field=>JSON.stringify(item[field]??null)===JSON.stringify(candidate[field]??null)));
    if(!duplicate) db.bookImportDeferredBookChecks.push(candidate);
  }
}
module.exports = {listDeferredBookTasks,resolveDeferredBookTask,retainDeferredBookChecks};
