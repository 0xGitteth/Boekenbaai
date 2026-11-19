'use strict';

const crypto = require('node:crypto');
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const {sameBookIdentity,sameBookTitle}=require('./book-import-autonomy');
const {buildImportReportIndex,latestImportForTask}=require('./book-import-task-reconciliation');

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
// Candidate identification is for human review, NEVER automatic closure.
// Historical Excel values may be an ISBN (including a leading zero dropped
// by Excel) or a local barcode. Search both without inventing an edition.
const compactIdentifier=value=>String(value??'').normalize('NFKC')
  .replace(/[\s-]+/g,'').toUpperCase();
function normalizedSourceIsbn(value){
  const direct=canonicalizeBookIsbn13(value);
  if(direct)return direct;
  const text=compactIdentifier(value);
  return /^\d{9}$/.test(text)
    ?canonicalizeBookIsbn13('0'+text):'';
}
function candidateMatches(db,item){
  const source=compactIdentifier(item.excelIdentifier);
  const wantedIsbn=normalizedSourceIsbn(item.editionIsbn)
    ||normalizedSourceIsbn(item.excelIdentifier);
  const taskEdition=normalizedSourceIsbn(item.editionIsbn);
  const results=[];
  for(const book of db.books||[]){
    if(!book?.id||!sameBookTitle(item.title,book.title))continue;
    const fields=[book.editionIsbn,book.metadataIsbn,book.isbn,book.isbn13];
    const isbnFields=[...fields,book.barcode].map(normalizedSourceIsbn).filter(Boolean);
    if(taskEdition&&isbnFields.some(value=>value!==taskEdition))continue;
    const sourceIsbnMatch=Boolean(wantedIsbn
      &&[...fields,book.barcode].some(value=>normalizedSourceIsbn(value)===wantedIsbn));
    const rawBarcodeMatch=Boolean(source&&compactIdentifier(book.barcode)===source);
    // Don't make title-only or author-only candidates actionable.
    if(!sourceIsbnMatch&&!rawBarcodeMatch)continue;
    // A conflicting confirmed edition must not be hidden by a matching
    // barcode on a different physical edition.
    if(wantedIsbn&&isbnFields.some(value=>value!==wantedIsbn))continue;
    results.push({book,matchReason:sourceIsbnMatch
      ?'isbn_exact':'source_barcode_exact',
      authorMatches:sameBookIdentity(item,book)});
  }
  return results;
}
function matchingCatalogBooks(db,item){
  return candidateMatches(db,item).map(candidate=>candidate.book);
}
function candidateSummary(book){
  return {id:book.id,title:String(book.title||'').slice(0,220),
    author:String(book.author||'').slice(0,180),
    publisher:String(book.publisher||'').slice(0,120),
    isbn:[book.editionIsbn,book.metadataIsbn,book.isbn,book.isbn13]
      .map(canonicalizeBookIsbn13).find(Boolean)||'',
    barcode:String(book.barcode||'').slice(0,80)};
}
function listDeferredBookTasks(db) {
  const reportIndex=buildImportReportIndex(db);
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
    const candidates=candidateMatches(db,task);
    task.catalogCandidateCount=candidates.length;
    task.catalogCandidates=candidates.slice(0,20).map(({book,matchReason,authorMatches})=>({
      ...candidateSummary(book),matchReason,authorMatches,
    }));
    task.needsAdministrativeReview=candidates.length>0;
    // A newer import is a diagnostic hint, never evidence on its own that
    // the skipped physical item was identified or that a loan ended.
    task.newerImport=latestImportForTask(db,task,reportIndex);
    // Candidates are suggestions only. Source-row quantities, edition and
    // current circulation still require review before choosing a copy.
  }
  const recentResolutions=items.filter(item=>item&&item.status==='completed'
    &&['administrative_done','auto_newer_import_verified_copy',
      'manual_done'].includes(item.resolution))
    .sort((a,b)=>String(b.completedAt||'').localeCompare(String(a.completedAt||'')))
    .slice(0,30).map(item=>({
      id:item.id,title:item.title||'',fileName:item.fileName||'',
      worksheetRow:item.worksheetRow||null,
      resolution:item.resolution,completedAt:item.completedAt||null,
      completedBy:item.completedBy||null,
      evidenceNote:String(item.administrativeEvidence?.evidenceNote||'').slice(0,800),
      bookId:item.administrativeEvidence?.bookId
        ||item.newerImportEvidence?.bookId||null,
      proofReportId:item.newerImportEvidence?.reportId||null,
    }));
  return { tasks, recentResolutions,summary: {
    open:tasks.length,
    groups:sameEditionCounts.size,
    repeatedChecks:tasks.length-sameEditionCounts.size,
  } };
}
function resolveDeferredBookTask(db, actor, id, revision, choice,
  now = new Date().toISOString(), details = {}) {
  if (actor?.role !== 'admin') return {ok:false,error:'forbidden'};
  if (!['manual_done','keep_deferred','administrative_done'].includes(choice)
    || !Number.isSafeInteger(revision)) return {ok:false,error:'invalid_choice'};
  const task = (db.bookImportDeferredBookChecks || [])
    .find(item => item.id === id && item.status === 'open');
  if (!task) return {ok:false,error:'not_found'};
  const current = Number.isSafeInteger(task.revision) ? task.revision : 1;
  if (revision !== current) return {ok:false,error:'stale_choice'};
  if (choice === 'keep_deferred') return {ok:true,unchanged:true};
  let administrativeEvidence=null;
  if(choice==='administrative_done'){
    const reason=details?.reason;
    const note=typeof details?.evidenceNote==='string'
      ?details.evidenceNote.trim():'';
    const bookId=details?.bookId;
    if(details?.confirmed!==true || ![
      'catalog_registration_verified','source_identifier_corrected',
      'earlier_import_reconciled',
    ].includes(reason) || note.length<20 || note.length>800
      || typeof bookId!=='string'||!bookId)
      return {ok:false,error:'administrative_evidence_required'};
    const matches=matchingCatalogBooks(db,task)
      .filter(book=>book.id===bookId);
    if(matches.length!==1 || (db.books||[]).filter(book=>book.id===bookId).length!==1)
      return {ok:false,error:'catalog_copy_not_proven'};
    const book=matches[0];
    administrativeEvidence={
      reason,bookId,evidenceNote:note,
      catalogSnapshot:candidateSummary(book),
    };
  }
  task.status = 'completed';
  task.revision = current + 1;
  task.completedAt = now;
  task.completedBy = actor.id;
  task.resolution = choice;
  if(administrativeEvidence)task.administrativeEvidence=administrativeEvidence;
  if (!Array.isArray(db.bookImportDeferredBookTaskHistory))
    db.bookImportDeferredBookTaskHistory = [];
  db.bookImportDeferredBookTaskHistory.push({
    id: crypto.randomUUID(), taskId: task.id, action: choice,
    actorId: actor.id, timestamp: now,
    ...(administrativeEvidence ? {administrativeEvidence} : {}),
  });
  return {ok:true,id:task.id,status:'completed'};
}
function retainDeferredBookChecks(db, candidates) {
  if (!Array.isArray(db.bookImportDeferredBookChecks)) db.bookImportDeferredBookChecks=[];
  const fields=['batchId','worksheetRow','title','author','excelIdentifier','editionIsbn',
    'bookId','barcode','sourcePrintedBarcode','sourceQuantity','sourceEvidence'];
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
