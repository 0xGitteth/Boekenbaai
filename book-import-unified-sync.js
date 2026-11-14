'use strict';

// All enabled domains are planned against the same library snapshot. New
// copies remain virtual until the single confirmed database transaction.
const { canonicalizeBookIsbn13 } = require('./book-edition-core');
const { buildInventorySyncPreview, normalizeInventoryResolutions } = require('./book-import-inventory-sync');
const { buildAssignmentPreview, normalizeResolutions } = require('./book-import-assignment-reconciliation');
const { excelLoanReceiptKey } = require('./book-import-loan-migration');
const sourceConfidence=require('./book-import-source-confidence');

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
// Older copies may store the edition ISBN in isbn13 or barcode alone.
// An ISBN-valued barcode is a fallback only when edition fields are absent.
function existingEdition(book){
  return canonicalizeBookIsbn13(book?.editionIsbn)
    ||canonicalizeBookIsbn13(book?.metadataIsbn)
    ||canonicalizeBookIsbn13(book?.isbn13)
    ||canonicalizeBookIsbn13(book?.barcode);
}
function isIsbnBarcode(value,isbn){return Boolean(value)&&canonicalizeBookIsbn13(value)===canonicalizeBookIsbn13(isbn);}
// The workbook analyzer necessarily sees ALL columns. Each selected import
// domain must only be blocked by errors which can affect that domain.
// Edition identity problems remain blocking in every mode.
const LOAN_ISSUES=new Set([
  'student_loan_unmatched','student_loan_ambiguous',
  'class_loan_unmatched','class_loan_ambiguous',
]);
const LOCATION_ISSUES=new Set(['fixed_location_needs_review']);
const COLUMN_WARNINGS={
  invalid_published_year:'publishedYear',
  invalid_page_count:'pageCount',
  language_hint_conflict:'language',
  nonstandard_easy_reading_value:'easyReading',
};
// Classify each diagnostic by the import section it can actually affect.
// Unknown diagnostics remain blocking until explicitly reviewed, so future
// error codes cannot silently bypass safety checks.
const NONBLOCKING_DIAGNOSTICS=new Set([
  'isbn_repaired','isbn_resolved_from_metadata','isbn_repair_suggested',
  'ambiguous_identifier_interpreted_as_isbn',
  'ambiguous_identifier_interpreted_as_barcode',
  'metadata_lookup_failed','metadata_not_usable','metadata_not_strict_match',
  'title_author_metadata_missing_edition_isbn',
  'nonstandard_easy_reading_value','dangerous_headers_ignored',
  'ml_structuurbb_fixed_location','own_book_excluded',
]);
const STOCK_DIAGNOSTICS=new Set([
  'invalid_quantity','copy_limit_exceeded',
]);
const PHYSICAL_DIAGNOSTICS=new Set([
  'invalid_physical_barcode','conflicting_physical_barcodes',
  'duplicate_physical_barcode','barcode_with_multiple_copies',
]);
function selectedMetadata(parts){
  return Object.values(parts.fields||{}).some(Boolean);
}
function issueAffectsSelection(issue,parts,domain){
  if(issue?.reviewLevel==='informational')return false;
  const code=issue?.code||'';
  if(NONBLOCKING_DIAGNOSTICS.has(code))return false;
  if(code==='metadata_differs_from_excel'){
    return issue.sourceInvalid===true &&domain==='metadata'
      &&parts.fields?.[issue.field]===true;
  }
  if(LOAN_ISSUES.has(code))
    return domain==='assignment'&&parts.loans;
  if(LOCATION_ISSUES.has(code))
    return domain==='assignment'&&parts.locations;
  if(code==='class_context_needs_review')
    return domain==='assignment'&&parts.loans&&parts.locations;
  if(code==='library_presence_needs_review')return false;
  if(code==='unexpected_exam_material_value')
    return domain==='metadata'&&parts.fields?.suitableForExamList===true;
  if(STOCK_DIAGNOSTICS.has(code))return domain==='stock';
  if(PHYSICAL_DIAGNOSTICS.has(code))
    return domain==='stock'||(domain==='assignment'&&(parts.loans||parts.locations));
  if(COLUMN_WARNINGS[code])
    return domain==='metadata'&&parts.fields?.[COLUMN_WARNINGS[code]]===true;
  if(code==='conflicting_source_columns'){
    if(['studentLoan','classLoan'].includes(issue.field))
      return domain==='assignment'&&parts.loans;
    if(issue.field==='fixedClass')
      return domain==='assignment'&&parts.locations;
    if(issue.field==='classes')
      return domain==='assignment'&&parts.loans&&parts.locations;
    if(issue.field==='libraryPresence')return false;
    if(issue.field==='quantity')return domain==='stock';
    if(['barcode','ambiguousIdentifier'].includes(issue.field))
      return domain==='stock'||(domain==='assignment'&&(parts.loans||parts.locations));
    if(METADATA_FIELDS.includes(issue.field))
      return ['title','author'].includes(issue.field)
        ||(domain==='metadata'&&parts.fields?.[issue.field]===true);
  }
  // An ISBN or identity conflict is relevant to every selected domain.
  // Unknown issues likewise keep their conservative behavior.
  return true;
}
function actionableSourceIssues(analysis,parts){
  const active=[];
  for(const row of analysis.rows||[]){
    const issues=(row.issues||[]).filter(issue=>
      ['conflict','warning'].includes(issue.severity)
      &&( (parts.books&&issueAffectsSelection(issue,parts,'stock'))
        ||((parts.loans||parts.locations)&&issueAffectsSelection(issue,parts,'assignment'))
        ||(selectedMetadata(parts)&&issueAffectsSelection(issue,parts,'metadata')) ));
    if(issues.length)active.push({index:row.index,worksheetRow:row.sourceRowNumber,issues});
  }
  return active;
}
function scopedRow(row,parts,domain){
  const issues=(row.issues||[]).filter(issue=>issueAffectsSelection(issue,parts,domain));
  const status=row.status==='skipped'||row.context?.excludeFromSchoolCollection
    ?'skipped'
    // A pre-reviewed/custom row may supply a status without individual
    // diagnostic objects. With no evidence of what caused that status,
    // preserve it rather than silently upgrading a warning to "ready".
    :!(row.issues||[]).length
      &&['warning','conflict','unresolved'].includes(row.status)?row.status
    :issues.some(issue=>issue.severity==='conflict')?'conflict'
    :(!row.book?.title||!row.book?.author||!row.book?.editionIsbn)?'unresolved'
    :issues.some(issue=>issue.severity==='warning')?'warning':'ready';
  return {...row,issues,status};
}
function stockAnalysis(analysis,db,parts,effectiveIdentityUpdates=new Set()){
  const known=new Map();
  for(const book of db.books||[]){
    const isbn=existingEdition(book);
    if(isbn&&!known.has(isbn))known.set(isbn,book);
  }
  return {...analysis,rows:analysis.rows.map(original=>{
    const row=scopedRow(original,parts,'stock');
    const isbn=canonicalizeBookIsbn13(row.book?.editionIsbn);
    const old=known.get(isbn);
    // Relax edition identity only if the reviewed plan WILL actually update
    // that field. Ticking a checkbox is not sufficient: the admin may choose
    // "keep", or the Excel value may be blank or only enriched metadata.
    const title=old&&effectiveIdentityUpdates.has(isbn+':title')
      ?old.title:row.book?.title;
    const author=old&&effectiveIdentityUpdates.has(isbn+':author')
      ?old.author:row.book?.author;
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
function assignmentSource(analysis,parts,db,inventory=null,effectiveIdentityUpdates=new Set()){
  const oldByIsbn=new Map();
  for(const book of db.books||[]){
    const isbn=existingEdition(book);
    if(isbn&&!oldByIsbn.has(isbn))oldByIsbn.set(isbn,book);
  }
  return {...analysis,rows:analysis.rows.map(original=>{
    const row=scopedRow(original,parts,'assignment');
    const old=oldByIsbn.get(canonicalizeBookIsbn13(row.book?.editionIsbn));
    const book={...row.book,
      title:old&&effectiveIdentityUpdates.has(row.book?.editionIsbn+':title')
        ?old.title:row.book?.title,
      author:old&&effectiveIdentityUpdates.has(row.book?.editionIsbn+':author')
        ?old.author:row.book?.author};
    const context={...row.context};
    if(!parts.loans){delete context.studentLoan;delete context.classLoan;delete context.studentClassHint;}
    if(!parts.locations)delete context.fixedLocation;
    if(!parts.locations||!parts.loans)delete context.classContext;
    // A brand-new multi-copy ISBN has its fixed location initialized on
    // EVERY proposed physical copy by projectCopies(). Sending its quantity
    // row to the single-copy assignment planner would create a false issue.
    // Never apply this exception to active loans or existing copies.
    if(parts.books&&parts.locations&&inventory?.proposedAdds
      &&row.book?.quantity?.valid===true&&row.book.quantity.value>1
      &&context.fixedLocation?.status==='resolved'
      &&!context.studentLoan&&!context.classLoan
      &&!context.classContext?.length
      &&!(db.books||[]).some(copy=>
        existingEdition(copy)===row.book.editionIsbn)){
      const proposed=inventory.proposedAdds
        .filter(item=>item.index===row.index)
        .reduce((sum,item)=>sum+item.quantity,0);
      if(proposed===row.book.quantity.value)delete context.fixedLocation;
    }
    delete context.libraryPresence;
    return {...row,book,context};
  })};
}
function projectCopies(analysis,inventory,parts,db,effectiveIdentityUpdates=new Set()){
  const copies=[];
  for(const addition of inventory.proposedAdds){
    const row=analysis.rows[addition.index];
    if(!row)throw Error('unified_source_row_missing');
    const old=(db.books||[]).find(book=>
      existingEdition(book)===addition.editionIsbn);
    // Projected copy identity must match the actual selected metadata
    // update; creation itself continues to use the reviewed Excel fields.
    // Physical copies of an already identified edition must be comparable
    // to existing copies while the preview runs. Source-confirmed metadata
    // updates are applied atomically during confirmation.
    const title=old?old.title:row.book.title;
    const author=old?old.author:row.book.author;
    for(let n=0;n<addition.quantity;n++)copies.push({
      id:virtualId(addition.index,n),title,author,
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
  if(field==='tags' && Array.isArray(row.provenance?.tags?.explicitValues)
    &&((row.provenance.tags.source==='excel'
      &&row.provenance.tags.includesDerivedValues)
      ||(row.provenance.tags.source==='manual'
        &&row.provenance.tags.detail==='review_correction'))){
    // A separate "Examenmateriaal: Strip" cell can add a derived tag.
    // Only Tags column entries may update stored tags.
    return row.provenance.tags.explicitValues||[];
  }
  const value=row.book?.[field];
  if(field==='author')return {value,authors:row.book?.authors};
  return value;
}
function normalizedMetadataChoice(input){
  if(input===undefined)return {ok:true,values:[]};
  if(!Array.isArray(input)||input.length>METADATA_FIELDS.length*1500)return {ok:false,error:'invalid_metadata_choices'};
  const seen=new Set(),values=[];
  for(const item of input){
    if(!item||typeof item!=='object'||Array.isArray(item)
      ||typeof item.id!=='string'||!/^[0-9]{13}:(title|author|description|publisher|publishedYear|pageCount|language|coverUrl|easyReading|suitableForExamList|tags|manualThemes)$/.test(item.id)
      ||!['keep','apply','excel'].includes(item.action)||seen.has(item.id))
      return {ok:false,error:'invalid_metadata_choices'};
    seen.add(item.id);
    values.push({id:item.id,action:item.action});
  }
  values.sort((a,b)=>a.id.localeCompare(b.id));
  return {ok:true,values};
}
function metadataSourceSafe(row,field,acceptWarnings){
  if(row.status==='skipped'||!row.book?.editionIsbn
    ||!row.book?.title||!row.book?.author)return false;
  const issues=row.issues||[];
  // Legacy reviewed/test rows can carry a conservative warning status
  // without diagnostic objects. Do not silently accept such a warning.
  if(!issues.length)
    return row.status==='ready'
      ||(row.status==='warning'&&acceptWarnings);
  // Reuse the exact same domain-specific diagnostic policy that the
  // source-warning panel uses. Otherwise a benign metadata lookup timeout or
  // an unrelated invalid Excel column silently prevents valid updates.
  const onlySelectedField={books:false,loans:false,locations:false,
    fields:{[field]:true}};
  const relevant=issues.filter(issue=>
    issueAffectsSelection(issue,onlySelectedField,'metadata'));
  return !relevant.some(issue=>issue.severity==='conflict'
    ||(issue.severity==='warning'&&!acceptWarnings));
}
function metadataPlan(analysis,db,parts,choices=[],acceptWarnings=false){
  const selected=new Map(choices.map(c=>[c.id,c.action]));
  const editions=new Map();
  for(const book of db.books||[]){
    const isbn=existingEdition(book);
    if(!isbn)continue;
    if(!editions.has(isbn))editions.set(isbn,[]);
    editions.get(isbn).push(book);
  }
  const groups=new Map();
  for(const original of analysis.rows){
    const row=scopedRow(original,parts,'metadata');
    const isbn=canonicalizeBookIsbn13(row.book?.editionIsbn);
    if(!isbn||row.status==='skipped'||!editions.has(isbn))continue;
    if(!groups.has(isbn))groups.set(isbn,[]);
    groups.get(isbn).push(row);
  }
  const updates=[],issues=[],automaticDecisions=[],valid=new Set();
  for(const [isbn,rows] of groups){
    const copies=editions.get(isbn);
    for(const field of METADATA_FIELDS.filter(field=>parts.fields[field])){
      const sourceRows=rows.filter(row=>{
        const source=row.provenance?.[field];
        // A value explicitly corrected in the import review is authoritative
        // for a selected column. Automatic enrichment is not.
        // A value derived from another column (e.g. Examenmateriaal:
        // Engels => language=en) is not a populated selected Excel cell.
        // Combined first/last-name author columns remain valid sources.
        const composedTags=field==='tags' && source?.source==='excel'
          &&source.includesDerivedValues;
        const derivedFromOther=Boolean(source?.includesDerivedValues)
          &&!composedTags
          ||(Boolean(source?.derived) && !(
            field==='author'&&source.derived==='combined_name_parts'
          ) && !(composedTags && source.derived==='exam_material_strip_tag'));
        const fromExcel=source?.source==='excel'&&!derivedFromOther;
        const reviewed=source?.source==='manual'
          &&source.detail==='review_correction';
        return (fromExcel||reviewed)
          &&(reviewed?(field==='tags'
              ?nonempty(source.explicitValues):nonempty(row.book?.[field]))
            :composedTags?nonempty(source.explicitValues)
            :nonempty(source.raw??(field==='author'
              ?(source.headers||[]).length?'combined-author':'':null)));
      });
      if(!sourceRows.length)continue;
      const id=isbn+':'+field;
      // Multiple Excel rows of one ISBN may differ only in punctuation or
      // accents. That is one bibliographic value, not multiple contradictory
      // title/author identities requiring a manual decision.
      const variants=new Map(sourceRows.map(row=>{
        const value=metadataKey(field,row);
        const signature=field==='title'
          ?'title:'+sourceConfidence.comparison(value)
          :field==='author'
            ?'author:'+sourceConfidence.comparison(value?.value)+'|'
              +(value?.authors||[]).map(sourceConfidence.comparison).sort().join('|')
            :JSON.stringify(value);
        return [signature,value];
      }));
      const validSources=sourceRows.every(row=>
        metadataSourceSafe(row,field,acceptWarnings));
      const next=variants.size===1?[...variants.values()][0]:null;
      // Invalid years/page-counts parse to null even when the Excel cell
      // contains text. A general warning acknowledgement never authorizes
      // erasing existing, valid numeric metadata.
      const unparsedNumeric=['publishedYear','pageCount'].includes(field)
        &&(next===null||next===undefined||!Number.isFinite(Number(next)));
      const conflict=variants.size!==1||!validSources||unparsedNumeric;
      const currentDifferent=copies.some(copy=>{
        const current=field==='author'?{value:copy.author,authors:copy.authors}:copy[field];
        return !equal(current,next);
      });
      const hasIndependentEvidence=['title','author','publisher'].includes(field)
        &&rows.some(row=>Array.isArray(row.sourceEvidence)
          &&row.sourceEvidence.length>0);
      if(!currentDifferent&&!conflict&&!hasIndependentEvidence)continue;
      valid.add(id);
      const current=field==='author'?copies[0].author:copies[0][field];
      const important=['title','author'].includes(field);
      if(selected.get(id)==='keep'){
        // A deliberate override is an auditable decision, even when it
        // results in no database write. Preserve the consulted providers.
        const sourceDecision=sourceConfidence.decide({
          isbn,field,excel:important?(field==='author'?next?.value:next):next,
          current,evidence:rows.flatMap(row=>row.sourceEvidence||[]),
        });
        automaticDecisions.push({
          id,isbn,field,title:rows[0].book?.title,action:'keep',
          confidence:'manual',
          reason:'Bestaande waarde expliciet behouden door beheerder',
          before:current,after:current,excel:next,
          sources:sourceDecision.agreeingSources,
          sourceCount:sourceDecision.sourceCount,
          canUseExcel:!conflict,
          worksheetRows:sourceRows.map(row=>row.sourceRowNumber),
        });
        continue;
      }
      const structural=sourceRows.some(row=>(row.issues||[]).some(issue=>
        issue.severity==='conflict'&&!COLUMN_WARNINGS[issue.code]
        &&issue.code!=='metadata_differs_from_excel'));
      // Distinct titles/authors under the same ISBN, or an unsafe edition
      // identity, still need a human decision. Other ambiguous/invalid
      // columns can simply leave the existing value unchanged.
      if((variants.size>1&&important)||structural){
        if(['apply','excel'].includes(selected.get(id)))return {ok:false,error:'unsafe_metadata_override'};
        issues.push({id,isbn,field,title:rows[0].book?.title,
          reason:variants.size>1?'conflicting_excel_values':'source_row_requires_review',
          worksheetRows:sourceRows.map(row=>row.sourceRowNumber),copies:copies.length});
        continue;
      }
      const correctedByAdmin=sourceRows.some(row=>
        row.provenance?.[field]?.source==='manual'
        &&row.provenance[field].detail==='review_correction');
      const manualExcel=correctedByAdmin
        ||['apply','excel'].includes(selected.get(id));
      const decision=sourceConfidence.decide({
        isbn,field,excel:important?(field==='author'?next?.value:next):next,
        current, evidence:rows.flatMap(row=>row.sourceEvidence||[]),
      });
      if(['apply','excel'].includes(selected.get(id))&&conflict)
        return {ok:false,error:'unsafe_metadata_override'};
      if(conflict || (decision.action==='keep'&&!manualExcel)){
        automaticDecisions.push({
          id,isbn,field,title:rows[0].book?.title,action:'keep',
          confidence:'medium',
          reason:conflict
            ?'Onvoldoende veilige gegevens; bestaande waarde blijft behouden'
            :decision.reason,
          before:current,after:current,excel:next,
          sources:decision.agreeingSources,
          sourceCount:decision.sourceCount,canUseExcel:!conflict,
          worksheetRows:sourceRows.map(row=>row.sourceRowNumber),
        });
        continue;
      }
      let chosen=next;
      if(!manualExcel && decision.action==='source' && important){
        chosen=field==='author'
          ?{value:decision.value,authors:Array.isArray(decision.authors)
              &&decision.authors.length
                ?[...decision.authors]:[...(next?.authors||[])]}
          :decision.value;
      }else if(!manualExcel && decision.action==='source')chosen=decision.value;
      const changed=copies.some(copy=>!equal(
        field==='author'?{value:copy.author,authors:copy.authors}:copy[field],
        chosen));
      automaticDecisions.push({
        id,isbn,field,title:rows[0].book?.title,
        action:changed?'apply':'keep',
        confidence:manualExcel?'manual':decision.confidence,
        reason:manualExcel?'Excelwaarde expliciet gekozen door beheerder':decision.reason,
        before:current,after:chosen,excel:next,
        sources:decision.agreeingSources,sourceCount:decision.sourceCount,
        canUseExcel:true,
        worksheetRows:sourceRows.map(row=>row.sourceRowNumber),
      });
      if(!changed)continue;
      updates.push({id,isbn,field,value:chosen,title:rows[0].book?.title,
        bookIds:copies.map(copy=>copy.id),copies:copies.length,
        confidence:manualExcel?'manual':decision.confidence,
        chosenSource:manualExcel?'excel':decision.action,
        reason:manualExcel?'Excelwaarde expliciet gekozen door beheerder':decision.reason,
        sources:decision.agreeingSources,
        sourceCount:decision.sourceCount,
        // Concurrent changes to a selected field invalidate confirmation.
        beforeValues:copies.map(copy=>({
          bookId:copy.id,
          value:field==='author'?{value:copy.author,authors:copy.authors}:copy[field],
          ...(field==='coverUrl'?{
            localCoverUrl:copy.localCoverUrl||'',coverCrop:copy.coverCrop??null,
          }:{}),
          ...(field==='manualThemes'?{
            importedThemes:copy.importedThemes||[],themes:copy.themes||[],
          }:{}),
        })),
        worksheetRows:sourceRows.map(row=>row.sourceRowNumber)});
    }
  }
  if(choices.some(c=>!valid.has(c.id)))return {ok:false,error:'stale_metadata_choice'};
  return {ok:true,updates,issues,automaticDecisions,kept:choices.length,
    summary:{updates:updates.length,issues:issues.length,
      autoHigh:automaticDecisions.filter(item=>item.confidence==='high').length,
      autoMedium:automaticDecisions.filter(item=>item.confidence==='medium').length,
      autoKept:automaticDecisions.filter(item=>item.action==='keep').length,
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
  // Determine which title/author edits will truly be applied BEFORE
  // considering additional copies. A kept, invalid or unselected change
  // cannot justify introducing copies with a different edition identity.
  const metadata=metadataPlan(analysis,db,use,metaChoices.values,acceptWarnings);
  if(!metadata.ok)return metadata;
  const effectiveIdentityUpdates=new Set(metadata.updates
    .filter(update=>update.field==='title'||update.field==='author')
    .map(update=>update.id));
  let inventory=inventoryNotSelected(analysis);
  if(use.books){
    const stock=stockAnalysis(analysis,db,use,effectiveIdentityUpdates);
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
  const projected=projectCopies(analysis,inventory,use,db,effectiveIdentityUpdates);
  const assignmentDb={...db,books:[...(db.books||[]),...projected]};
  const source=use.loans||use.locations
    ?assignmentSource(analysis,use,db,inventory,effectiveIdentityUpdates):{...analysis,rows:[]};
  let assignments=buildAssignmentPreview(source,assignmentDb,assignmentChoices.values);
  if(!assignments.ok)return assignments;
  // Receipt IDs survive loan returns and truncated import reports. Re-uploading
  // an old sheet must never issue another loan to its former borrower.
  const receipts=new Set(loanReceipts);
  const manuallyChosen=new Set(assignmentChoices.values.map(choice=>choice.id));
  const previouslyImported=assignments.differences.filter(diff=>{
    if(diff.kind!=='loan'||diff.choice!=='apply'
      ||manuallyChosen.has(diff.id))return false;
    const borrower={type:diff.after?.type,id:diff.after?.id};
    // ISBNs identify interchangeable physical copies. Historical receipts
    // refer to the particular copy last time, which may now be borrowed by
    // somebody else. Check EVERY copy of the edition before recreating an
    // old worksheet loan on another free copy.
    return (db.books||[]).some(book=>
      existingEdition(book)===diff.editionIsbn
      &&receipts.has(excelLoanReceiptKey(book.id,borrower)));
  });
  if(previouslyImported.length){
    assignments=buildAssignmentPreview(source,assignmentDb,[
      ...assignmentChoices.values,
      ...previouslyImported.map(diff=>({id:diff.id,action:'keep'})),
    ]);
    if(!assignments.ok)return assignments;
    const ignored=new Set(previouslyImported.map(diff=>diff.id));
    for(const diff of assignments.differences)
      if(ignored.has(diff.id))diff.previouslyImported=true;
    assignments.summary.previouslyImportedLoans=ignored.size;
  }else assignments.summary.previouslyImportedLoans=0;
  const total=inventory.summary.addCopies+assignments.summary.apply
    +metadata.summary.updates+assignments.summary.deferred
    +assignments.summary.kept+metadata.kept
    // A review containing only automatic keep decisions is still worth
    // confirming, so the exact choices can be recorded in its import report.
    +metadata.summary.autoKept;
  return {ok:true,parts:use,inventory,assignments,metadata,
    actionableSourceIssues:actionableSourceIssues(analysis,use),summary:{
    newCopies:inventory.summary.addCopies,
    proposedLoans:assignments.differences.filter(d=>d.kind==='loan'&&d.choice==='apply').length,
    proposedLocations:assignments.differences.filter(d=>d.kind==='location'&&d.choice==='apply').length,
    metadataFields:metadata.summary.updates,
    confidentMetadata:metadata.summary.autoHigh,
    consideredMetadata:metadata.summary.autoMedium,
    preservedMetadata:metadata.summary.autoKept,
    affectedMetadataCopies:metadata.summary.affectedCopies,
    pending:assignments.summary.pending+inventory.summary.blockedEditions+metadata.summary.issues,
    blockedStock:inventory.summary.blockedEditions,pendingAssignments:assignments.summary.pending,
    pendingMetadata:metadata.summary.issues,
    missingStockGroups:assignments.summary.notInCollection,
    missingStockCopies:assignments.summary.notInCollectionCopies,
    preservedOldCopies:inventory.summary.omittedExistingCopies,
    automatic:assignments.summary.automatic,
    previouslyImportedLoans:assignments.summary.previouslyImportedLoans,
    deferred:assignments.summary.deferred,
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
  DEFAULT_PARTS,METADATA_FIELDS,normalizeParts,virtualId,assignmentSource,
  normalizedMetadataChoice,issueAffectsSelection,actionableSourceIssues,
  buildUnifiedBookImport,actualAssignmentPreview,
};
