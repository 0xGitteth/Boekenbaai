'use strict';

// Plan all selected import domains against one immutable library snapshot.
// Virtual books represent proposed stock additions during review. They are
// never persisted: final application replaces their IDs with actual copy IDs.
const { canonicalizeBookIsbn13 } = require('./book-edition-core');
const { buildInventorySyncPreview, normalizeInventoryResolutions } =
  require('./book-import-inventory-sync');
const { buildAssignmentPreview, normalizeResolutions } =
  require('./book-import-assignment-reconciliation');

const DEFAULT_PARTS=Object.freeze({books:true,loans:true,locations:true});
function normalizeParts(parts) {
  if(parts===undefined)return {ok:true,value:{...DEFAULT_PARTS}};
  if(!parts || typeof parts!=='object' || Array.isArray(parts))return {ok:false,error:'invalid_sync_parts'};
  const keys=['books','loans','locations'];
  if(Object.keys(parts).some(key=>!keys.includes(key))
    || keys.some(key=>typeof parts[key]!=='boolean')
    || !keys.some(key=>parts[key]))return {ok:false,error:'invalid_sync_parts'};
  return {ok:true,value:Object.fromEntries(keys.map(key=>[key,parts[key]]))};
}
function virtualId(rowIndex, ordinal) {
  return 'unified-preview-copy:'+rowIndex+':'+ordinal;
}
function isIsbnBarcode(value, isbn) {
  return Boolean(value) && canonicalizeBookIsbn13(value)===canonicalizeBookIsbn13(isbn);
}
function inventoryAnalysis(analysis) {
  // Neither a changed borrower nor a generic 'Klassen' remark should make
  // a valid stock count impossible to reconcile. The assignment planner
  // reviews those fields independently after stock is projected.
  return {...analysis,rows:analysis.rows.map(row=>({
    ...row,book:{...row.book,barcode:isIsbnBarcode(row.book?.barcode,row.book?.editionIsbn)
      ? '' : row.book?.barcode},
    context:{}, 
  }))};
}
function inventoryNotSelected(analysis) {
  return {ok:true,rows:analysis.rows.map(row=>({
    index:row.index,worksheetRow:row.sourceRowNumber,action:'not_selected',reason:'',
    existingCopies:0,borrowedCopies:0,targetCopies:0,addCopies:0,rowAddCopies:0,
  })),proposedAdds:[],loanAssignments:[],classFollowups:[],omittedEditions:[],
  summary:{addCopies:0,restoreLoans:0,alreadyRecordedLoans:0,previouslyImportedLoans:0,
    blockedEditions:0,classFollowups:0,classContextsAlreadyReviewed:0,
    unchangedEditions:0,acknowledgedEditions:0,skippedRows:0,
    omittedExistingCopies:0,readyToApply:true}};
}
function maskedAssignments(analysis,parts) {
  return {...analysis,rows:analysis.rows.map(row=>{
    const context={...row.context};
    if(!parts.loans) {
      delete context.studentLoan;
      delete context.classLoan;
      delete context.studentClassHint;
    }
    if(!parts.locations)delete context.fixedLocation;
    // A generic class remark requires a location/loan classification.
    // It stays reviewable only when both domains are selected.
    if(!parts.loans||!parts.locations)delete context.classContext;
    delete context.libraryPresence;
    return {...row,context};
  })};
}
function projectCopies(analysis, inventory, parts) {
  const copies=[];
  for(const addition of inventory.proposedAdds) {
    const row=analysis.rows[addition.index];
    if(!row)throw Error('unified_source_row_missing');
    for(let n=0;n<addition.quantity;n++)copies.push({
      id:virtualId(addition.index,n),title:row.book.title,author:row.book.author,
      editionIsbn:addition.editionIsbn,metadataIsbn:addition.editionIsbn,
      barcode:addition.barcode,status:'available',borrowedBy:null,
      borrowedByClassId:null,borrowedAt:null,dueDate:null,
      fixedLocation:parts.locations && row.context?.fixedLocation?.status==='resolved'
        ? row.context.fixedLocation.label : null,
    });
  }
  return copies;
}
function buildUnifiedBookImport(analysis,db,{
  parts=DEFAULT_PARTS,acceptWarnings=false,inventoryResolutions=[],
  assignmentResolutions=[],loanReceipts=[],existingFollowups=[],
}={}) {
  if(!analysis?.ok||!Array.isArray(analysis.rows))return {ok:false,error:'invalid_review'};
  const validParts=normalizeParts(parts);
  if(!validParts.ok)return validParts;
  const use=validParts.value;
  const stockChoices=normalizeInventoryResolutions(inventoryResolutions);
  const assignmentChoices=normalizeResolutions(assignmentResolutions);
  if(!stockChoices.ok||!assignmentChoices.ok)
    return {ok:false,error:stockChoices.error||assignmentChoices.error};
  const stock=inventoryAnalysis(analysis);
  const parameters={acceptWarnings,students:db.students||[],classes:db.classes||[],
    loanReceipts,existingFollowups};
  let inventory=inventoryNotSelected(analysis);
  if(use.books){
    const first=buildInventorySyncPreview(stock,db.books||[],{
      ...parameters,resolutions:stockChoices.values,
    });
    if(!first.ok)return first;
    // A smaller Excel total does not authorize deletion. Silently preserve
    // extra existing copies rather than asking to reconfirm each old ISBN.
    const automaticKeep=(first.rows||[]).filter(entry=>
      entry.canKeepExisting && entry.action==='blocked'
      && entry.reason==='reduction_requires_manual_review'
    ).map(entry=>({isbn:entry.editionIsbn,action:'keep_existing'}));
    const byIsbn=new Map([...automaticKeep,...stockChoices.values]
      .map(value=>[value.isbn,value]));
    inventory=automaticKeep.length
      ?buildInventorySyncPreview(stock,db.books||[],{
        ...parameters,resolutions:[...byIsbn.values()],
      })
      :first;
    if(!inventory.ok)return inventory;
  }else if(stockChoices.values.length){
    return {ok:false,error:'inventory_not_selected'};
  }
  const virtual=projectCopies(analysis,inventory,use);
  const assignmentDb={...db,books:[...(db.books||[]),...virtual]};
  const assignmentSource=maskedAssignments(analysis,use);
  const assignments=(use.loans||use.locations)
    ?buildAssignmentPreview(assignmentSource,assignmentDb,assignmentChoices.values)
    :buildAssignmentPreview({...assignmentSource,rows:[]},assignmentDb,assignmentChoices.values);
  if(!assignments.ok)return assignments;
  const total=inventory.summary.addCopies+assignments.summary.apply;
  const pending=assignments.summary.pending+inventory.summary.blockedEditions;
  return {ok:true,parts:use,inventory,assignments,summary:{
    newCopies:inventory.summary.addCopies,
    proposedLoans:assignments.differences.filter(d=>d.kind==='loan'&&d.choice==='apply').length,
    proposedLocations:assignments.differences.filter(d=>d.kind==='location'&&d.choice==='apply').length,
    pending,blockedStock:inventory.summary.blockedEditions,
    pendingAssignments:assignments.summary.pending,
    preservedOldCopies:inventory.summary.omittedExistingCopies,
    unchangedEditions:inventory.summary.unchangedEditions,
    automatic:assignments.summary.automatic,
    readyToApply:inventory.summary.readyToApply&&assignments.summary.pending===0&&total>0,
  }};
}
function actualAssignmentPreview(preview,createdByRow) {
  const map=new Map();
  for(const [index,copies] of createdByRow){
    copies.forEach((copy,n)=>map.set(virtualId(index,n),copy.id));
  }
  const differences=preview.differences.map(diff=>({
    ...diff,bookId:map.get(diff.bookId)||diff.bookId,
  }));
  return {...preview,differences};
}
module.exports={
  DEFAULT_PARTS,normalizeParts,virtualId,buildUnifiedBookImport,
  actualAssignmentPreview,
};
