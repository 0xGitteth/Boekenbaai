'use strict';

const crypto = require('node:crypto');

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
  return { tasks, summary: {open: tasks.length} };
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
module.exports = {listDeferredBookTasks,resolveDeferredBookTask};
