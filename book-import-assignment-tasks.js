'use strict';

// Durable admin-only tasks for corrections intentionally postponed during
// "Administratie corrigeren". They are independent of the last 30 reports
// and NEVER interpret an empty Excel cell as evidence of a real return.
const crypto = require('node:crypto');
const { buildAssignmentPreview, applyAssignmentPreview } =
  require('./book-import-assignment-reconciliation');
const { circulationRevision, reportIsFullyReviewed } =
  require('./book-import-followups');
const {excelLoanReceiptKey}=require('./book-import-loan-migration');
const {studentLoanIds,isUnavailable}=require('./book-catalog-integrity');

const CLASS_CHOICES = new Set(['class_fixed', 'class_loan', 'class_unrelated']);
const CLOSING_CHOICES = new Set(['keep', 'manual_done', 'class_unrelated']);
const COMPLETE = new Set(['completed', 'cancelled']);
const clone = value => JSON.parse(JSON.stringify(value ?? null));
const norm = value => String(value ?? '').trim();

function savedRow(row) {
  if (!row || !row.book || !row.context) return null;
  return {
    status: row.status, sourceRowNumber: row.sourceRowNumber,
    book: {
      title: norm(row.book.title), author: norm(row.book.author),
      editionIsbn: norm(row.book.editionIsbn),
      barcode: norm(row.book.barcode),
      quantity: { valid: row.book.quantity?.valid === true,
        value: row.book.quantity?.value },
    },
    context: clone(row.context),
  };
}

function createDeferredAssignmentTasks(db, report, rows, differences, now) {
  if (!Array.isArray(db.bookImportAssignmentTasks))
    db.bookImportAssignmentTasks = [];
  const stored = [];
  for (const diff of differences.filter(item => item.choice === 'later')) {
    const source = rows.find(row => row.index === diff.rowIndex);
    const task = {
      id: crypto.randomUUID(), reportId: report.id, differenceId: diff.id,
      fileName: report.fileName || '', kind: diff.kind,
      worksheetRow: diff.worksheetRow,
      bookId: diff.bookId || null,
      title: norm(diff.title || source?.book?.title),
      author: norm(diff.author || source?.book?.author),
      editionIsbn: norm(diff.editionIsbn || source?.book?.editionIsbn),
      barcode: norm(diff.barcode || source?.book?.barcode),
      reason: norm(diff.reason), original: clone(diff),
      sourceRow: savedRow(source),
      loanHistoryMode:report.loanHistoryMode==='preserve'?'preserve':'correct',
      status: 'open', revision: 1, createdAt: now,
      resolvedAt: null, resolvedBy: null, resolution: null,
    };
    db.bookImportAssignmentTasks.push(task);
    stored.push(task);
  }
  return stored;
}

function legacyId(reportId, differenceId) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(['legacy-assignment', reportId, differenceId]))
    .digest('hex').slice(0, 32);
}

function migrateLegacyDeferredTasks(db) {
  // A pre-upgrade report could otherwise fall out of the last-30 reports
  // during ANY later database write (not only an assignment import).
  if (!Array.isArray(db.bookImportAssignmentTasks))
    db.bookImportAssignmentTasks = [];
  const seen = new Set(db.bookImportAssignmentTasks
    .map(task => reportKey(task.reportId, task.differenceId)));
  let migrated = 0;
  for (const report of db.bookImportReports || []) {
    if (report?.mode !== 'assignment_reconcile') continue;
    for (const item of report.deferredDifferences || []) {
      if (item?.status !== 'open') continue;
      const key = reportKey(report.id, item.id);
      if (seen.has(key)) continue;
      db.bookImportAssignmentTasks.push({
        id: legacyId(report.id, item.id), reportId: report.id,
        differenceId: item.id, fileName: report.fileName || '',
        kind: item.kind, worksheetRow: item.worksheetRow,
        bookId: item.bookId || null,
        title: norm(item.title), author: norm(item.author),
        editionIsbn: norm(item.editionIsbn), barcode: norm(item.barcode),
        reason: norm(item.reason), original: clone(item),
        sourceRow: null, legacy: true,
        status: 'open', revision: 1,
        createdAt: item.recordedAt || report.importedAt,
        resolvedAt: null, resolvedBy: null, resolution: null,
      });
      seen.add(key);
      migrated++;
    }
  }
  return migrated;
}


function loanEvidence(book, referenceOwners, students, classes) {
  if (!book) return null;
  const holderIds=[...(referenceOwners.get(book.id)||[])];
  const borrower=book.borrowedByClassId
    ?{type:'class',id:book.borrowedByClassId,
      name:classes.get(book.borrowedByClassId)?.name||'Onbekende klas'}
    :book.borrowedBy
      ?{type:'student',id:book.borrowedBy,
        name:students.get(book.borrowedBy)?.name||'Onbekende leerling'}
      :null;
  const holders=holderIds.map(id=>({
    id,name:students.get(id)?.name||'Onbekende leerling',
  }));
  const conflicts=(
    (book.status==='available'&&isUnavailable(book,referenceOwners))
    ||(book.borrowedBy&&(
      holderIds.length!==1||holderIds[0]!==book.borrowedBy))
    ||(book.borrowedByClassId&&holderIds.length>0)
    ||(holderIds.length>1)
  );
  return {
    bookId:book.id,title:book.title||'',barcode:book.barcode||'',
    editionIsbn:book.editionIsbn||book.metadataIsbn||'',
    fixedLocation:book.fixedLocation||'',
    storedStatus:book.status||'available',
    effectiveStatus:isUnavailable(book,referenceOwners)?'borrowed':'available',
    borrower,studentLoanReferences:holders,conflictingEvidence:Boolean(conflicts),
  };
}
function sourceEvidence(task) {
  const row=task.sourceRow;
  const diff=task.original||{};
  const ctx=row?.context||{};
  const explicitIssues=Array.isArray(diff.sourceIssues)
    ?diff.sourceIssues.filter(x=>typeof x==='string').slice(0,20):[];
  return {
    status:diff.sourceStatus||row?.status||'unknown',
    issueCodes:explicitIssues,
    originalReason:task.reason||'',
    description:typeof diff.description==='string'
      ?diff.description.slice(0,500):'',
    rowAvailable:Boolean(row),
    excelStudent:diff.excelStudent||ctx.studentLoan?.name||'',
    excelClass:diff.excelClass||ctx.classLoan?.name||
      ctx.studentClassHint?.label||(Array.isArray(ctx.classContext)
        ?ctx.classContext.join(', '):'')||'',
    excelFixedLocation:diff.excelFixedLocation||
      ctx.fixedLocation?.raw||ctx.fixedLocation?.label||'',
    excelBarcode:row?.book?.barcode||task.barcode||'',
    excelEditionIsbn:row?.book?.editionIsbn||task.editionIsbn||'',
    missingFromSnapshot:diff.missingFromSnapshot===true,
  };
}
const editionIdentity=(title,author,isbn)=>JSON.stringify([
  norm(title).toLocaleLowerCase('nl-NL'),
  norm(author).toLocaleLowerCase('nl-NL'),
  norm(isbn).replace(/[^0-9X]/gi,''),
]);
function copyIdentity(task, booksById, editionCounts) {
  const matches=task.bookId ?(booksById.get(task.bookId)||[]):[];
  const isbn=norm(task.editionIsbn).replace(/[^0-9X]/gi,'');
  const title=norm(task.title).toLocaleLowerCase('nl-NL');
  const author=norm(task.author).toLocaleLowerCase('nl-NL');
  // Edition evidence is a clue, never proof of a physical-copy identity.
  const editionCount=isbn&&title&&author
    ?editionCounts.get(editionIdentity(title,author,isbn))||0:0;
  return {
    status:task.bookId?(matches.length===1?'linked':
      matches.length===0?'missing':'ambiguous'):'no_physical_reference',
    bookId:task.bookId||null, matchingEditionCount:editionCount,
    // No candidate is automatically treated as the missing physical copy.
    requiresPhysicalReview:matches.length!==1,
  };
}

function listDeferredAssignmentTasks(db) {
  const existingBookIds=new Set((db.books || []).map(book=>book.id));
  const booksById=new Map();
  for(const book of db.books||[]) {
    if(!booksById.has(book.id))booksById.set(book.id,[]);
    booksById.get(book.id).push(book);
  }
  const referenceOwners=studentLoanIds(db);
  const studentsById=new Map((db.students||[]).map(student=>[student.id,student]));
  const classesById=new Map((db.classes||[]).map(klass=>[klass.id,klass]));
  const editionCounts=new Map();
  for(const book of db.books||[]){
    const isbns=new Set([book.editionIsbn,book.metadataIsbn,book.isbn]
      .map(v=>norm(v).replace(/[^0-9X]/gi,'')).filter(Boolean));
    for(const isbn of isbns){
      const key=editionIdentity(book.title,book.author,isbn);
      editionCounts.set(key,(editionCounts.get(key)||0)+1);
    }
  }
  const stored = Array.isArray(db.bookImportAssignmentTasks)
    ? db.bookImportAssignmentTasks : [];
  const known = new Set(stored.map(task => reportKey(task.reportId, task.differenceId)));
  // Show already saved, pre-upgrade report entries too. They can be closed
  // without reuploading Excel, but cannot be applied without a reviewed row.
  const legacy = (db.bookImportReports || [])
    .filter(report => report?.mode === 'assignment_reconcile')
    .flatMap(report => (report.deferredDifferences || [])
      .filter(item => item?.status === 'open'
        && !known.has(reportKey(report.id, item.id)))
      .map(item => ({
        id: legacyId(report.id, item.id), reportId: report.id,
        differenceId: item.id, fileName: report.fileName || '',
        kind: item.kind, worksheetRow: item.worksheetRow,
        bookId: item.bookId || null, title: norm(item.title),
        author: norm(item.author), editionIsbn: norm(item.editionIsbn),
        barcode: norm(item.barcode), reason: norm(item.reason),
        original: clone(item), sourceRow: null, legacy: true,
        status: 'open', revision: 1,
        createdAt: item.recordedAt || report.importedAt,
      })));
  const tasks = [...stored.filter(task => task?.status === 'open'), ...legacy]
    .map(task => ({
      id: task.id, reportId: task.reportId, differenceId: task.differenceId,
      worksheetRow: task.worksheetRow,
      fileName: task.fileName, kind: task.kind,
      bookId: task.bookId, title: task.title, author: task.author,
      editionIsbn: task.editionIsbn, barcode: task.barcode,
      reason: task.reason, before: task.original?.before ?? null,
      after: task.original?.after ?? null,
      className: task.original?.className || '',
      classId: task.original?.classId || null,
      hasExplicitLoan: task.original?.hasExplicitLoan === true,
      beforeLocation: task.original?.beforeLocation ?? null,
      beforeLoan: task.original?.beforeLoan ?? null,
      createdAt: task.createdAt, revision: task.revision,
      missingBook: Boolean(task.bookId && !existingBookIds.has(task.bookId)),
      canApply: Boolean(task.sourceRow && task.bookId
        && booksById.get(task.bookId)?.length===1
        && ['loan', 'location', 'class_context'].includes(task.kind)
        && !task.reason),
      legacy: task.legacy === true,
      sourceEvidence:sourceEvidence(task),
      physicalIdentity:copyIdentity(task,booksById,editionCounts),
      currentBook:booksById.get(task.bookId)?.length===1
        ?loanEvidence(booksById.get(task.bookId)[0],referenceOwners,
          studentsById,classesById):null,
    }))
    .sort((a,b)=>norm(a.createdAt).localeCompare(norm(b.createdAt)));
  return { tasks, summary: { open: tasks.length } };
}

function reportKey(reportId, differenceId) {
  return JSON.stringify([reportId, differenceId]);
}

function findTask(db, id) {
  const existing = (db.bookImportAssignmentTasks || []).find(task => task.id === id);
  if (existing) return existing;
  return listLegacyTask(db, id);
}

function listLegacyTask(db, id) {
  for (const report of db.bookImportReports || []) {
    if (report?.mode !== 'assignment_reconcile') continue;
    for (const diff of report.deferredDifferences || []) {
      if (diff.status !== 'open' || legacyId(report.id, diff.id) !== id) continue;
      return {
        id, reportId: report.id, differenceId: diff.id,
        kind: diff.kind, original: clone(diff),
        status: 'open', revision: 1, legacy: true,
      };
    }
  }
  return null;
}

function updateDeferredReport(db, task, choice, actorId, now) {
  const report = (db.bookImportReports || []).find(item => item.id === task.reportId);
  const record = report?.deferredDifferences?.find(item => item.id === task.differenceId);
  if (record && record.status === 'open') {
    record.status = 'completed';
    record.resolution = choice;
    record.resolvedBy = actorId;
    record.resolvedAt = now;
  }
  if (report) report.fullyReviewed = reportIsFullyReviewed(db, report.id);
}

function reconstruct(task) {
  if (!task.sourceRow) return null;
  const row = clone(task.sourceRow);
  row.index = 0;
  row.sourceRowNumber = task.worksheetRow;
  return row;
}

function correctionPreview(db, task, choice) {
  if (!task.sourceRow || !task.bookId || task.kind === 'issue'
      || (task.reason && task.reason !== '')) {
    return { ok:false, error:'manual_review_required' };
  }
  const row = reconstruct(task);
  // Preserve the exact physical identity assigned during the original
  // multirow import. Replanning a single row without its siblings would
  // otherwise pick another available copy of the same shared ISBN.
  const formerlyInExcel=task.kind==='loan'
    &&task.original?.previouslyRecordedInExcel===true
    &&task.original?.after?.type==='none';
  const missingSnapshot=(formerlyInExcel
    &&task.original?.missingFromSnapshot===true)
    ||(task.kind==='location'&&task.original?.classFixedToLoan===true);
  const borrower=task.original?.before;
  const receipt=formerlyInExcel
    ?excelLoanReceiptKey(task.bookId,borrower):null;
  const options={preferredCopyByRow:{0:task.bookId},
    ...(receipt?{reviewMissingLoans:true,loanReceipts:[receipt]}:{}),
    ...(missingSnapshot?{reviewAllBlankLoans:true}:{})};
  const initial = buildAssignmentPreview({ ok:true, rows:[row] }, db, [], options);
  if (!initial.ok) return {ok:false,error:'review_no_longer_safe'};
  const diff = initial.differences.find(item =>
    item.kind === task.kind && item.bookId === task.bookId);
  if (!diff) return {ok:false,error:'review_no_longer_matches'};
  const old = task.original;
  // Edition identity, target, location and borrower must still mean exactly
  // what the administrator reviewed when postponing this record.
  if (norm(diff.editionIsbn) !== norm(old.editionIsbn)) {
    return {ok:false,error:'review_no_longer_matches'};
  }
  if (task.kind === 'loan') {
    if (JSON.stringify(diff.before) !== JSON.stringify(old.before)
      || JSON.stringify(diff.after) !== JSON.stringify(old.after)
      || diff.circulationRevision !== old.circulationRevision
      || diff.loanBorrowedAt !== old.loanBorrowedAt
      || diff.loanDueDate !== old.loanDueDate) {
      return {ok:false,error:'review_no_longer_matches'};
    }
  }
  if (task.kind === 'location'
    && (norm(diff.before) !== norm(old.before)
      || norm(diff.after) !== norm(old.after))) {
    return {ok:false,error:'review_no_longer_matches'};
  }
  if (task.kind === 'class_context') {
    if (norm(diff.className) !== norm(old.className)
      || norm(diff.classId) !== norm(old.classId)
      || norm(diff.beforeLocation) !== norm(old.beforeLocation)
      || (choice === 'class_loan'
        && (JSON.stringify(diff.beforeLoan) !== JSON.stringify(old.beforeLoan)
          || diff.circulationRevision !== old.circulationRevision
          || diff.loanBorrowedAt !== old.loanBorrowedAt
          || diff.loanDueDate !== old.loanDueDate))) {
      return {ok:false,error:'review_no_longer_matches'};
    }
  }
  const resolutions = initial.differences.map(item =>
    ({id:item.id,action:item===diff?choice:'keep'}));
  const checked = buildAssignmentPreview({ok:true,rows:[row]},db,resolutions,options);
  if (!checked.ok || !checked.summary.readyToApply)
    return {ok:false,error:'unsafe_correction'};
  if (checked.differences.find(item => item.id===diff.id)?.choice !== choice)
    return {ok:false,error:'unsafe_correction'};
  return checked;
}

function resolveDeferredAssignmentTask(db, task, actor, payload, now=new Date().toISOString()) {
  if (actor?.role !== 'admin' || !task || task.status !== 'open'
    || !Number.isSafeInteger(payload?.revision)
    || task.revision !== payload.revision
    || !['keep','manual_done','apply','class_fixed','class_loan','class_unrelated']
      .includes(payload.choice)) return {ok:false,error:'stale_or_invalid_choice'};
  const choice = payload.choice;
  if (CLASS_CHOICES.has(choice) && task.kind !== 'class_context')
    return {ok:false,error:'invalid_task_choice'};
  if (choice === 'apply' && !['loan','location'].includes(task.kind))
    return {ok:false,error:'invalid_task_choice'};
  if (!CLASS_CHOICES.has(choice) && !CLOSING_CHOICES.has(choice) && choice !== 'apply')
    return {ok:false,error:'invalid_task_choice'};
  let changed = null;
  if (choice==='apply' || choice==='class_fixed' || choice==='class_loan') {
    if (payload.confirm !== true) return {ok:false,error:'confirmation_required'};
    const plan=correctionPreview(db,task,choice);
    if(!plan.ok)return plan;
    changed=applyAssignmentPreview(db,plan,actor.id,now,crypto.randomUUID(),
      {loanHistoryMode:task.loanHistoryMode==='preserve'?'preserve':'correct'});
    if(changed.applied !== 1)return {ok:false,error:'unsafe_correction'};
  }
  // A migrated legacy task is also persistent; only a virtual fallback
  // without backing task storage must skip the status mutation.
  const persisted=(db.bookImportAssignmentTasks || [])
    .some(item=>item.id===task.id);
  if (persisted) {
    task.status='completed';task.revision+=1;
    task.resolvedAt=now;task.resolvedBy=actor.id;task.resolution=choice;
  }
  updateDeferredReport(db,task,choice,actor.id,now);
  if(!Array.isArray(db.bookImportAssignmentTaskHistory))
    db.bookImportAssignmentTaskHistory=[];
  db.bookImportAssignmentTaskHistory.push({
    id:crypto.randomUUID(),taskId:task.id,reportId:task.reportId,
    differenceId:task.differenceId,bookId:task.original?.bookId||null,
    choice,actorId:actor.id,at:now,correctionCount:changed?.applied||0,
  });
  return {ok:true,taskId:task.id,choice,corrected:changed?.applied||0};
}

module.exports={
  createDeferredAssignmentTasks, migrateLegacyDeferredTasks, listDeferredAssignmentTasks,
  findTask, resolveDeferredAssignmentTask,
};
