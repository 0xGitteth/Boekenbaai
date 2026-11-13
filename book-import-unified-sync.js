'use strict';

// All enabled domains are planned against the same library snapshot. New
// copies remain virtual until the single confirmed database transaction.
const { canonicalizeBookIsbn13 } = require('./book-edition-core');
const { buildInventorySyncPreview, normalizeInventoryResolutions } = require('./book-import-inventory-sync');
const { buildAssignmentPreview, normalizeResolutions } = require('./book-import-assignment-reconciliation');

const METADATA_FIELDS=Object.freeze([
  'title','author','description','publisher','publishedYear','pageCount',
  'language','coverUrl','easyReading','suitableForExamList','tags','manualThemes',
]);
const DEFAULT_PARTS=Object.freeze({books:true,loans:true,locations:true,
  fields:Object.fromEntries(METADATA_FIELDS.map(field=>[field,false]))});
function normalizeParts(input) {
  if(input===undefined)return {ok:true,value:{...DEFAULT_PARTS,fields:{...DEFAULT_PARTS.fields}}};
  if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,error:'invalid_sync_parts'};
  if(Object.keys(input).some(key=>!['books','loans','locations','fields'].includes(key)))
    return {ok:false,error:'invalid_sync_parts'};
  if(['books','loans','locations'].some(key=>typeof input[key]!=='boolean'))
    return {ok:false,error:'invalid_sync_parts'};
  const fields=input.fields===undefined?{}:input.fields;
  if(!fields||typeof fields!=='object'||Array.isArray(fields)
    ||Object.keys(fields).some(key=>!METADATA_FIELDS.includes(key))
    ||Object.values(fields).some(value=>typeof value!=='boolean'))
    return {ok:false,error:'invalid_sync_parts'};
  const selected=Object.fromEntries(METADATA_FIELDS.map(key=>[key,fields[key]===true]));
  if(!input.books&&!input.loans&&!input.locations&&!Object.values(selected).some(Boolean))
    return {ok:false,error:'no_sync_parts_selected'};
  return {ok:true,value:{books:input.books,loans:input.loans,locations:input.locations,fields:selected}};
}
function virtualId(index,n){return 'unified-preview-copy:'+index+':'+n;}
function isIsbnBarcode(value,isbn){return Boolean(value)&&canonicalizeBookIsbn13(value)===canonicalizeBookIsbn13(isbn);}
function stockAnalysis(analysis,db,parts){
  const known=new Map();
  for(const book of db.books||[]){
    const isbn=canonicalizeBookIsbn13(book.editionIsbn)
      ||canonicalizeBookIsbn13(book.metadataIsbn);
    if(isbn&&!known.has(isbn))known.set(isbn,book);
  }
  return {...analysis,rows:analysis.rows.map(row=>{
    const isbn=canonicalizeBookIsbn13(row.book?.editionIsbn);
    const old=known.get(isbn);
    // When title or author was explicitly selected for updating, an
    // existing edition may legitimately have older metadata. Only the
    // inventory identity comparison uses the stored values; the actual new
    // copies and the selected field update use the reviewed Excel values.
    const title=old&&parts.fields.title?old.title:row.book?.title;
    const author=old&&parts.fields.author?old.author:row.book?.author;
    return {...row,
      book:{...row.book,title,author,
        barcode:isIsbnBarcode(row.book?.barcode,row.book?.editionIsbn)
          ?'':row.book?.barcode},
      context:{},
    };
  })};
}
function inventoryNotSelected(analysis){
  return {ok:true,rows:analysis.rows.map(row=>({index:row.index,
    worksheetRow:row.sourceRowNumber,action:'not_selected',reason:'',
    existingCopies:0,borrowedCopies:0,targetCopies:0,addCopies:0,rowAddCopies:0,
  })),proposedAdds:[],loanAssignments:[],classFollowups:[],omittedEditions:[],
  summary:{addCopies:0,restoreLoans:0,alreadyRecordedLoans:0,previouslyImportedLoans:0,
    blockedEditions:0,classFollowups:0,classContextsAlreadyReviewed:0,
    unchangedEditions:0,acknowledgedEditions:0,skippedRows:0,omittedExistingCopies:0,
    readyToApply:true}};
}
function assignmentSource(analysis,parts){
  return {...analysis,rows:analysis.rows.map(row=>{
    const context={...row.context};
    if(!parts.loans){delete context.studentLoan;delete context.classLoan;delete context.studentClassHint;}
    if(!parts.locations)delete context.fixedLocation;
    if(!parts.locations||!parts.loans)delete context.classContext;
    delete context.libraryPresence;
    return {...row,context};
  })};
}
function projectCopies(analysis,inventory,parts){
  const copies=[];
  for(const addition of inventory.proposedAdds){
    const row=analysis.rows[addition.index];
    if(!row)throw Error('unified_source_row_missing');
    for(let n=0;n<addition.quantity;n++)copies.push({
      id:virtualId(addition.index,n),title:row.book.title,author:row.book.author,
      editionIsbn:addition.editionIsbn,metadataIsbn:addition.editionIsbn,
      barcode:addition.barcode,status:'available',borrowedBy:null,
      borrowedByClassId:null,borrowedAt:null,dueDate:null,
      fixedLocation:parts.locations&&row.context?.fixedLocation?.status==='resolved'
        ?row.context.fixedLocation.label:null,
    });
  }
  return copies;
}
function equal(left,right){return JSON.stringify(left)===JSON.stringify(right);}
function nonempty(value){return value!==null&&value!==undefined
  &&(typeof value!=='string'||value.trim()!=='')
  &&(!Array.isArray(value)||value.length>0);}
function metadataKey(field,row){
  const value=row.book?.[field];
  if(field==='author')return {value,authors:row.book?.authors};
  return value;
}
function normalizedMetadataChoice(input){
  if(input===undefined)return {ok:true,values:[]};
  if(!Array.isArray(input)||input.length>6000)return {ok:false,error:'invalid_metadata_choices'};
  const seen=new Set(),values=[];
  for(const item of input){
    if(!item||typeof item!=='object'||Array.isArray(item)
      ||typeof item.id!=='string'||!/^[0-9]{13}:(title|author|description|publisher|publishedYear|pageCount|language|coverUrl|easyReading|suitableForExamList|tags|manualThemes)$/.test(item.id)
      ||item.action!=='keep'||seen.has(item.id))
      return {ok:false,error:'invalid_metadata_choices'};
    seen.add(item.id);
    values.push({id:item.id,action:'keep'});
  }
  values.sort((a,b)=>a.id.localeCompare(b.id));
  return {ok:true,values};
}
function metadataPlan(analysis,db,parts,choices=[]){
  const selected=new Set(choices.map(c=>c.id));
  const editions=new Map();
  for(const book of db.books||[]){
    const isbn=canonicalizeBookIsbn13(book.editionIsbn)
      ||canonicalizeBookIsbn13(book.metadataIsbn);
    if(!isbn)continue;
    if(!editions.has(isbn))editions.set(isbn,[]);
    editions.get(isbn).push(book);
  }
  const groups=new Map();
  for(const row of analysis.rows){
    const isbn=canonicalizeBookIsbn13(row.book?.editionIsbn);
    if(!isbn||row.status==='skipped'||!editions.has(isbn))continue;
    if(!groups.has(isbn))groups.set(isbn,[]);
    groups.get(isbn).push(row);
  }
  const updates=[],issues=[],valid=new Set();
  for(const [isbn,rows] of groups){
    const copies=editions.get(isbn);
    for(const field of METADATA_FIELDS.filter(field=>parts.fields[field])){
      const sourceRows=rows.filter(row=>row.provenance?.[field]?.source==='excel'
        &&nonempty(row.provenance[field].raw??(field==='author'
          ?(row.provenance[field].headers||[]).length?'combined-author':'':null)));
      if(!sourceRows.length)continue;
      const id=isbn+':'+field;
      const variants=new Map(sourceRows.map(row=>
        [JSON.stringify(metadataKey(field,row)),metadataKey(field,row)]));
      const validSources=sourceRows.every(row=>['ready','warning'].includes(row.status));
      const conflict=variants.size!==1||!validSources;
      const next=variants.size===1?[...variants.values()][0]:null;
      const currentDifferent=copies.some(copy=>{
        const current=field==='author'?{value:copy.author,authors:copy.authors}:copy[field];
        return !equal(current,next);
      });
      if(!currentDifferent&&!conflict)continue;
      valid.add(id);
      if(selected.has(id))continue;
      if(conflict){
        issues.push({id,isbn,field,title:rows[0].book?.title,
          reason:validSources?'conflicting_excel_values':'source_row_requires_review',
          worksheetRows:sourceRows.map(row=>row.sourceRowNumber),copies:copies.length});
      }else{
        updates.push({id,isbn,field,value:next,title:rows[0].book?.title,
          bookIds:copies.map(copy=>copy.id),copies:copies.length,
          worksheetRows:sourceRows.map(row=>row.sourceRowNumber)});
      }
    }
  }
  if(choices.some(c=>!valid.has(c.id)))return {ok:false,error:'stale_metadata_choice'};
  return {ok:true,updates,issues,kept:choices.length,
    summary:{updates:updates.length,issues:issues.length,
      affectedCopies:new Set(updates.flatMap(update=>update.bookIds)).size}};
}
function buildUnifiedBookImport(analysis,db,{
  parts=DEFAULT_PARTS,acceptWarnings=false,inventoryResolutions=[],
  assignmentResolutions=[],metadataResolutions=[],loanReceipts=[],existingFollowups=[],
}={}){
  if(!analysis?.ok||!Array.isArray(analysis.rows))return {ok:false,error:'invalid_review'};
  const configured=normalizeParts(parts);
  const inventoryChoices=normalizeInventoryResolutions(inventoryResolutions);
  const assignmentChoices=normalizeResolutions(assignmentResolutions);
  const metaChoices=normalizedMetadataChoice(metadataResolutions);
  for(const candidate of [configured,inventoryChoices,assignmentChoices,metaChoices])
    if(!candidate.ok)return candidate;
  const use=configured.value;
  let inventory=inventoryNotSelected(analysis);
  if(use.books){
    const stock=stockAnalysis(analysis,db,use);
    const parameters={acceptWarnings,students:db.students||[],classes:db.classes||[],
      loanReceipts,existingFollowups};
    let preview=buildInventorySyncPreview(stock,db.books||[],{
      ...parameters,resolutions:inventoryChoices.values,
    });
    if(!preview.ok)return preview;
    const autoKeep=(preview.rows||[]).filter(entry=>entry.canKeepExisting
      &&entry.action==='blocked'&&entry.reason==='reduction_requires_manual_review')
      .map(entry=>({isbn:entry.editionIsbn,action:'keep_existing'}));
    const merged=[...new Map([...autoKeep,...inventoryChoices.values]
      .map(choice=>[choice.isbn,choice])).values()];
    inventory=autoKeep.length
      ?buildInventorySyncPreview(stock,db.books||[],{...parameters,resolutions:merged})
      :preview;
    if(!inventory.ok)return inventory;
  }else if(inventoryChoices.values.length)return {ok:false,error:'inventory_not_selected'};
  const projected=projectCopies(analysis,inventory,use);
  const assignmentDb={...db,books:[...(db.books||[]),...projected]};
  const assignments=(use.loans||use.locations)
    ?buildAssignmentPreview(assignmentSource(analysis,use),assignmentDb,assignmentChoices.values)
    :buildAssignmentPreview({...analysis,rows:[]},assignmentDb,assignmentChoices.values);
  if(!assignments.ok)return assignments;
  const metadata=metadataPlan(analysis,db,use,metaChoices.values);
  if(!metadata.ok)return metadata;
  const total=inventory.summary.addCopies+assignments.summary.apply+metadata.summary.updates;
  return {ok:true,parts:use,inventory,assignments,metadata,summary:{
    newCopies:inventory.summary.addCopies,
    proposedLoans:assignments.differences.filter(d=>d.kind==='loan'&&d.choice==='apply').length,
    proposedLocations:assignments.differences.filter(d=>d.kind==='location'&&d.choice==='apply').length,
    metadataFields:metadata.summary.updates,
    affectedMetadataCopies:metadata.summary.affectedCopies,
    pending:assignments.summary.pending+inventory.summary.blockedEditions+metadata.summary.issues,
    blockedStock:inventory.summary.blockedEditions,pendingAssignments:assignments.summary.pending,
    pendingMetadata:metadata.summary.issues,
    missingStockGroups:assignments.summary.notInCollection,
    missingStockCopies:assignments.summary.notInCollectionCopies,
    preservedOldCopies:inventory.summary.omittedExistingCopies,
    automatic:assignments.summary.automatic,
    readyToApply:inventory.summary.readyToApply
      &&assignments.summary.pending===0&&metadata.summary.issues===0&&total>0,
  }};
}
function actualAssignmentPreview(preview,createdByRow){
  const ids=new Map();
  for(const [index,copies] of createdByRow)
    copies.forEach((copy,n)=>ids.set(virtualId(index,n),copy.id));
  return {...preview,differences:preview.differences.map(diff=>({
    ...diff,bookId:ids.get(diff.bookId)||diff.bookId,
  }))};
}
module.exports={
  DEFAULT_PARTS,METADATA_FIELDS,normalizeParts,virtualId,
  normalizedMetadataChoice,buildUnifiedBookImport,actualAssignmentPreview,
};
