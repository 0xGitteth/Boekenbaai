'use strict';

// Recheck old, postponed Excel rows against later ACCEPTED import reports.
// A newer timestamp, matching title or matching ISBN is not physical-copy
// evidence. Automatic closure requires the SAME explicit physical barcode,
// a single copy on BOTH source rows, one valid edition, and a unique current
// catalogue record. Neither copies nor circulation are ever modified.
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const {normalized,equivalentAuthorName}=require('./book-import-autonomy');

const accepted=new Set(['unchanged','reconciled','add_copies','combined']);
const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value||'').trim();
function filename(value){
  let result=text(value);
  try{result=decodeURIComponent(result);}catch{/* preserve literal name */}
  return result.normalize('NFKC').toLocaleLowerCase('nl-NL');
}
const barcode=value=>text(value).replace(/\s+/g,'').toUpperCase();
const title=value=>normalized(value);
function sameIdentity(a,b){
  return Boolean(title(a?.title)&&title(a.title)===title(b?.title)
    &&title(a?.author)&&equivalentAuthorName(a.author,b?.author));
}
function distinctReportAfter(report,task){
  const sourceReport=task?.batchId||task?.reportId;
  if(!report?.id||!sourceReport||report.id===sourceReport)return false;
  const old=Date.parse(task.createdAt||'');
  const later=Date.parse(report.importedAt||'');
  return Number.isFinite(old)&&Number.isFinite(later)&&later>old;
}
function sourceRows(report){
  return list(report?.rows).filter(row=>row&&Number.isSafeInteger(row.worksheetRow));
}
function latestImportForTask(db,task){
  if(!filename(task?.fileName)||!Number.isSafeInteger(task?.worksheetRow)
    ||!text(task?.title))return null;
  const matches=[];
  for(const report of list(db?.bookImportReports)){
    if(!distinctReportAfter(report,task))continue;
    for(const row of sourceRows(report)){
      if(title(row.title)!==title(task.title))continue;
      const sameSourceRow=filename(report.fileName)===filename(task.fileName)
        &&row.worksheetRow===task.worksheetRow;
      const taskIsbn=canonicalizeBookIsbn13(task.editionIsbn);
      const exactEdition=Boolean(taskIsbn
        &&taskIsbn===canonicalizeBookIsbn13(row.editionIsbn));
      const barcodeAndAuthor=Boolean(task.sourcePrintedBarcode
        &&row.sourcePrintedBarcode
        &&barcode(task.sourcePrintedBarcode)===barcode(row.sourcePrintedBarcode)
        &&row.author&&equivalentAuthorName(task.author,row.author));
      const exactRawAndAuthor=Boolean(task.excelIdentifier
        &&row.sourceIdentifier
        &&barcode(task.excelIdentifier)===barcode(row.sourceIdentifier)
        &&row.author&&equivalentAuthorName(task.author,row.author));
      // Across DIFFERENT workbook versions only match an exact edition,
      // a printed physical barcode or a matching explicit source identifier.
      // Similar titles on their own never establish continuity.
      if(!sameSourceRow&&!exactEdition&&!barcodeAndAuthor&&!exactRawAndAuthor)
        continue;
      // Legacy reports do not have the author or original quantity. Their
      // row status is only an indication of later work, not proof of a copy.
      const authorConfirmed=Boolean(row.author&&equivalentAuthorName(row.author,task.author));
      const sourceIdentifierConfirmed=Boolean(row.sourceIdentifier
        &&barcode(row.sourceIdentifier)===barcode(task.excelIdentifier));
      matches.push({reportId:report.id,at:report.importedAt,
        rowStatus:row.status,authorConfirmed,sourceIdentifierConfirmed,
        sameSourceRow,exactEdition,
        hasPhysicalEvidence:Boolean(row.sourcePrintedBarcode
          &&row.sourceQuantity===1&&row.editionIsbn)});
    }
  }
  matches.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return matches[0]||null;
}
function exactCurrentCopy(db,task,row){
  if(task.sourceQuantity!==1||row.sourceQuantity!==1)return null;
  const printed=barcode(task.sourcePrintedBarcode);
  if(!printed||printed!==barcode(row.sourcePrintedBarcode))return null;
  const taskIsbn=canonicalizeBookIsbn13(task.editionIsbn);
  const rowIsbn=canonicalizeBookIsbn13(row.editionIsbn);
  if(!taskIsbn||rowIsbn!==taskIsbn||!sameIdentity(task,row))return null;
  // The source barcode must appear on precisely one current physical copy.
  const copies=list(db.books).filter(copy=>barcode(copy?.barcode)===printed);
  if(copies.length!==1)return null;
  const copy=copies[0];
  if(!copy.id||!sameIdentity(task,copy)
    ||(task.bookId&&task.bookId!==copy.id)
    ||list(db.books).filter(item=>item.id===copy.id).length!==1)return null;
  const registered=[copy.editionIsbn,copy.metadataIsbn,copy.isbn,copy.isbn13]
    .map(canonicalizeBookIsbn13).filter(Boolean);
  // A physical barcode alone is never a bibliographic edition identifier.
  if(!registered.length||registered.some(value=>value!==taskIsbn))return null;
  return copy;
}
function confirmedNewerImport(db,task,report){
  if(!distinctReportAfter(report,task))return null;
  if(!barcode(task.sourcePrintedBarcode)||task.sourceQuantity!==1)return null;
  // A barcode used twice in the newer workbook is not a uniquely identified
  // physical source row, even if one of the rows looks compatible.
  const sameBarcodeRows=sourceRows(report).filter(row=>
    barcode(row.sourcePrintedBarcode)===barcode(task.sourcePrintedBarcode));
  if(sameBarcodeRows.length!==1)return null;
  const row=sameBarcodeRows[0];
  if(!accepted.has(row.status))return null;
  const book=exactCurrentCopy(db,task,row);
  return book?{reportId:report.id,at:report.importedAt,
    worksheetRow:row.worksheetRow,bookId:book.id,
    physicalBarcode:barcode(book.barcode),
    editionIsbn:canonicalizeBookIsbn13(row.editionIsbn),
    decision:row.status}:null;
}
function findNewerProof(db,task){
  const evidence=list(db?.bookImportReports).flatMap(report=>{
    const proved=confirmedNewerImport(db,task,report);
    return proved?[proved]:[];
  }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return evidence[0]||null;
}
function closeTasksProvenByImport(db,report,{actorId='system:import',
  now=new Date().toISOString()}={}){
  const tasks=list(db.bookImportDeferredBookChecks);
  const decisions=[];
  for(const task of tasks){
    if(task?.status!=='open')continue;
    const proof=confirmedNewerImport(db,task,report);
    if(!proof)continue;
    // A source may correspond to multiple historical notifications, but
    // distinct physical IDs or unverified quantities are never merged.
    decisions.push({task,proof});
  }
  if(!decisions.length)return {closed:0,taskIds:[]};
  if(!Array.isArray(db.bookImportDeferredBookTaskHistory))
    db.bookImportDeferredBookTaskHistory=[];
  for(const {task,proof} of decisions){
    const previousRevision=Number.isSafeInteger(task.revision)&&task.revision>0
      ?task.revision:1;
    task.status='completed';
    task.resolution='auto_newer_import_verified_copy';
    task.revision=previousRevision+1;
    task.completedAt=now;
    task.completedBy=actorId;
    task.newerImportEvidence=proof;
    db.bookImportDeferredBookTaskHistory.push({
      id:require('node:crypto').randomUUID(),taskId:task.id,
      action:'auto_newer_import_verified_copy',actorId,timestamp:now,
      proof,previousRevision,revision:task.revision,
    });
  }
  return {closed:decisions.length,taskIds:decisions.map(x=>x.task.id)};
}
module.exports={latestImportForTask,findNewerProof,closeTasksProvenByImport,
  confirmedNewerImport};
