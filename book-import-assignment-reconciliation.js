'use strict';

// Opt-in administrative correction of existing physical copies only.
// Never infer a return or removal from an empty Excel cell. Every difference
// needs an explicit administrator decision, and every applied difference is
// recomputed against current persisted book/student/class state.
const crypto = require('node:crypto');
const { canonicalizeBookIsbn13, normalizeBookIdentityComparable } = require('./book-edition-core');
const { normalizeRuntimeBarcode } = require('./book-import-analysis-values');
const { matchEntityByName } = require('./book-import-analysis-context');
const { noteLoanActivity } = require('./book-import-followups');
const { excelLoanReceiptKey, persistExcelLoanReceipts } = require('./book-import-loan-migration');

const ACTIONS = new Set(['apply', 'keep', 'later']);
const norm = value => normalizeBookIdentityComparable(value || '');
const bookKey = book => [
  norm(book?.title), norm(book?.author),
];
const edition = book => canonicalizeBookIsbn13(book?.editionIsbn)
  || canonicalizeBookIsbn13(book?.metadataIsbn)
  || canonicalizeBookIsbn13(book?.isbn13);
const borrowedId = loan => typeof loan === 'string' ? loan : loan?.bookId;

function normalizeResolutions(input) {
  if (input === undefined) return { ok:true,values:[] };
  if (!Array.isArray(input) || input.length > 4500) return { ok:false,error:'invalid_assignment_choices' };
  const seen = new Set(), values = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.id !== 'string' || !/^\d+:(loan|location|issue)$/.test(entry.id)
      || !ACTIONS.has(entry.action) || seen.has(entry.id))
      return { ok:false,error:'invalid_assignment_choices' };
    seen.add(entry.id);
    values.push({ id:entry.id,action:entry.action });
  }
  values.sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true}));
  return { ok:true,values };
}

function borrowerOf(copy, db) {
  const student = copy?.borrowedBy;
  const klass = copy?.borrowedByClassId;
  if (student && klass) return { error:'conflicting_current_borrowers' };
  if (copy?.status === 'borrowed' && !student && !klass)
    return { error:'borrowed_without_borrower' };
  if (copy?.status !== 'borrowed' && (student || klass))
    return { error:'borrower_status_disagrees' };
  if (!student && !klass) return { type:'none',id:'',name:'Niet uitgeleend' };
  if (student) {
    const person=(db.students||[]).find(item=>item.id===student);
    if(!person)return {error:'missing_existing_student'};
    return { type:'student',id:student,name:person.name||'Leerling' };
  }
  const group=(db.classes||[]).find(item=>item.id===klass);
  if(!group)return {error:'missing_existing_class'};
  return { type:'class',id:klass,name:group.name||'Klas' };
}
function desiredLoan(row, db) {
  const c=row.context||{}, student=c.studentLoan, klass=c.classLoan;
  if (student && klass) return {error:'conflicting_excel_borrowers'};
  if (student || klass) {
    const item=student||klass, type=student?'student':'class';
    const candidates=type==='student'?db.students:db.classes;
    const matched=matchEntityByName(item.name,candidates);
    if(item.status!=='matched' || matched.status!=='matched'
      || matched.matches[0].id!==item.id)
      return {error:'borrower_not_uniquely_matched'};
    const person=candidates.find(candidate=>candidate.id===item.id);
    if(type==='student'&&(person?.active===false||person?.status==='inactive'))
      return {error:'inactive_student'};
    return {type,id:item.id,name:matched.matches[0].name};
  }
  return {type:'none',id:'',name:'Geen leerling of klas ingevuld'};
}
function desiredLocation(row, db) {
  const info=row.context?.fixedLocation;
  // A generic "Klas" column does not say whether this is a fixed shelf
  // location or a temporary classroom loan. Never silently choose one.
  if (!info) return (row.context?.classContext||[]).length
    ? {error:'class_context_requires_classification'}
    : {value:null,provided:false};
  if(info.status==='resolved'&&typeof info.label==='string'&&info.label.trim())
    return {value:info.label.trim(),provided:true};
  const tokens=row.context?.classContext||[];
  if(info.status==='needs_review'&&tokens.length===1){
    const match=matchEntityByName(tokens[0],db.classes||[]);
    if(match.status==='matched')
      return {value:match.matches[0].name,provided:true};
  }
  return {error:'fixed_location_needs_manual_identification'};
}
function findCopy(row, db, byBarcode, byIsbn) {
  const book=row.book||{},barcode=normalizeRuntimeBarcode(book.barcode);
  if(book.barcode && !barcode)return {error:'invalid_physical_barcode'};
  const isbn=canonicalizeBookIsbn13(book.editionIsbn);
  if(!isbn)return {error:'missing_valid_isbn'};
  const candidates=barcode?byBarcode.get(barcode)||[]:byIsbn.get(isbn)||[];
  if(candidates.length!==1)
    return {error:candidates.length?'ambiguous_physical_copy':'physical_copy_not_found'};
  const copy=candidates[0];
  if(edition(copy)!==isbn)return {error:'edition_identity_mismatch'};
  if(bookKey(copy).join('|')!==bookKey(book).join('|'))
    return {error:'title_author_mismatch'};
  if(book.quantity?.valid!==true||book.quantity.value!==1)
    return {error:'copy_requires_single_excel_row'};
  return {copy};
}
function buildAssignmentPreview(analysis, db, input=[]) {
  if(!analysis?.ok||!Array.isArray(analysis.rows))return {ok:false,error:'invalid_review'};
  const normalized=normalizeResolutions(input);
  if(!normalized.ok)return normalized;
  const selected=new Map(normalized.values.map(item=>[item.id,item.action]));
  const byBarcode=new Map(),byIsbn=new Map();
  for(const copy of db.books||[]) {
    const barcode=normalizeRuntimeBarcode(copy.barcode);
    if(barcode){
      if(!byBarcode.has(barcode))byBarcode.set(barcode,[]);
      byBarcode.get(barcode).push(copy);
    }
    const isbn=edition(copy);
    if(isbn){
      if(!byIsbn.has(isbn))byIsbn.set(isbn,[]);
      byIsbn.get(isbn).push(copy);
    }
  }
  const matched=new Map(),found=[];
  for(const row of analysis.rows) {
    if(row.status==='skipped')continue;
    const context=row.context||{};
    const located=['ready','warning'].includes(row.status)
      ? findCopy(row,db,byBarcode,byIsbn)
      : {error:'unreviewed_source_row'};
    const relevant=Boolean(context.studentLoan||context.classLoan
      ||context.fixedLocation||context.classContext?.length
      ||context.libraryPresence);
    if(located.error) {
      if(relevant)found.push({id:row.index+':issue',rowIndex:row.index,
        worksheetRow:row.sourceRowNumber,title:row.book?.title||'',
        kind:'issue',reason:located.error,bookId:null});
      continue;
    }
    const previous=matched.get(located.copy.id);
    matched.set(located.copy.id,previous?[...previous,row]:[row]);
    found.push({row,copy:located.copy});
  }
  const duplicateIds=new Set([...matched].filter(([,rows])=>rows.length>1).map(([id])=>id));
  const differences=found.filter(item=>item.kind==='issue');
  for(const {row,copy} of found.filter(item=>!item.kind)) {
    const base={rowIndex:row.index,worksheetRow:row.sourceRowNumber,
      title:copy.title,author:copy.author,barcode:copy.barcode||'',
      bookId:copy.id,editionIsbn:edition(copy)||''};
    if(duplicateIds.has(copy.id)) {
      differences.push({...base,id:row.index+':issue',kind:'issue',
        reason:'duplicate_copy_rows'});
      continue;
    }
    const current=borrowerOf(copy,db);
    const desired=desiredLoan(row,db);
    const info=row.context||{};
    if(current.error || desired.error) {
      differences.push({...base,id:row.index+':issue',kind:'issue',
        reason:current.error||desired.error});
      continue;
    }
    const currentStudentHolders=(db.students||[]).filter(student=>
      (student.borrowedBooks||[]).some(loan=>borrowedId(loan)===copy.id));
    if((current.type==='student' &&
        (currentStudentHolders.length!==1||currentStudentHolders[0].id!==current.id))
      ||(current.type!=='student'&&currentStudentHolders.length>0)){
      differences.push({...base,id:row.index+':issue',kind:'issue',
        reason:'student_loan_records_disagree'});
      continue;
    }
    // No borrower in Excel means unknown, not "returned". Show a separate
    // optional correction when the copy is recorded as borrowed.
    if(current.type!==desired.type || current.id!==desired.id) {
      if(current.type!=='none'||desired.type!=='none') {
        const claim=desired.type==='student'
          ? (db.students||[]).find(x=>x.id===desired.id) : null;
        const otherEditionBorrowed=claim&&(claim.borrowedBooks||[]).some(loan=>{
          const b=(db.books||[]).find(item=>item.id===borrowedId(loan));
          return b && b.id!==copy.id && edition(b)===edition(copy);
        });
        const conflictingCopy=(db.books||[]).some(b=>b.id!==copy.id
          && edition(b)===edition(copy) && b.borrowedBy===desired.id && desired.type==='student');
        differences.push({...base,id:row.index+':loan',kind:'loan',
          before:current,after:desired,
          reason:otherEditionBorrowed||conflictingCopy?'student_already_borrowed_edition':'',
          blankSource:desired.type==='none',
          description:desired.type==='none'
            ? 'Excel vermeldt geen uitlening. Dit bewijst niet dat het boek is ingeleverd.'
            : 'Excel noemt een andere leerling of klas.'});
      }
    }
    const location=desiredLocation(row,db);
    if(location.error){
      differences.push({...base,id:row.index+':issue',kind:'issue',reason:location.error});
    }else{
      const old=String(copy.fixedLocation||'').trim();
      const next=String(location.value||'').trim();
      if(old!==next&&(old||next)){
        differences.push({...base,id:row.index+':location',kind:'location',
          before:old,after:next,blankSource:!location.provided,reason:'',
          description:location.provided?'Excel vermeldt een andere vaste plek.'
            :'Excel vermeldt geen vaste plek. Dit bewijst niet dat de plek is vervallen.'});
      }
    }
  }
  differences.sort((a,b)=>a.rowIndex-b.rowIndex
    ||a.kind.localeCompare(b.kind));
  const valid=new Set(differences.map(x=>x.id));
  for(const choice of normalized.values){
    if(!valid.has(choice.id))return {ok:false,error:'stale_assignment_choice'};
    const diff=differences.find(x=>x.id===choice.id);
    if(choice.action==='apply' && (diff.kind==='issue'||diff.reason))
      return {ok:false,error:'unsafe_assignment_choice'};
  }
  // No selected row may give two physical copies of the same edition to
  // one pupil. Compare both the current state and all proposed changes.
  const selectedStudentEditions = new Set();
  for (const diff of differences) {
    if (selected.get(diff.id)!=='apply' || diff.kind!=='loan'
      || diff.after?.type!=='student') continue;
    const key=JSON.stringify([diff.after.id,diff.editionIsbn]);
    if(selectedStudentEditions.has(key))
      return {ok:false,error:'duplicate_corrected_student_edition'};
    selectedStudentEditions.add(key);
  }
  for(const d of differences) d.choice=selected.get(d.id)||'pending';
  const pending=differences.filter(x=>x.choice==='pending').length;
  const apply=differences.filter(x=>x.choice==='apply').length;
  const issues=differences.filter(x=>x.kind==='issue'||x.reason).length;
  return {ok:true,differences,summary:{
    differences:differences.length,pending,apply,
    kept:differences.filter(x=>x.choice==='keep').length,
    deferred:differences.filter(x=>x.choice==='later').length,
    issues,readyToApply:pending===0&&differences.length>0,
  }};
}
function applyAssignmentPreview(db, preview, actorId, now=new Date().toISOString(), batchId=crypto.randomUUID()) {
  if(!preview?.ok||!preview.summary?.readyToApply)
    throw Error('assignment_review_not_ready');
  const audit=[],receiptPairs=[];
  for(const entry of preview.differences.filter(d=>d.choice==='apply')){
    const copy=(db.books||[]).find(b=>b.id===entry.bookId);
    if(!copy)throw Error('assignment_book_missing');
    if(entry.kind==='loan'){
      const before=borrowerOf(copy,db);
      if(before.error||before.id!==entry.before.id||before.type!==entry.before.type)
        throw Error('assignment_loan_changed');
      if(before.type!=='none')receiptPairs.push({bookId:copy.id,
        borrower:{type:before.type,id:before.id}});
      for(const person of db.students||[]){
        if(!Array.isArray(person.borrowedBooks))continue;
        person.borrowedBooks=person.borrowedBooks.filter(item=>borrowedId(item)!==copy.id);
      }
      const target=entry.after;
      if(target.type==='none'){
        copy.status='available';
        copy.borrowedBy=null;
        copy.borrowedByClassId=null;
        copy.borrowedAt=null;
        copy.dueDate=null;
      }else{
        copy.status='borrowed';
        copy.borrowedBy=target.type==='student'?target.id:null;
        copy.borrowedByClassId=target.type==='class'?target.id:null;
        // This is a correction, not an observed new checkout. A due date
        // or checkout date belonging to the previous borrower is invalid.
        copy.borrowedAt=null;
        copy.dueDate=null;
        if(target.type==='student'){
          const person=(db.students||[]).find(s=>s.id===target.id);
          if(!person)throw Error('assignment_student_missing');
          if(!Array.isArray(person.borrowedBooks))person.borrowedBooks=[];
          person.borrowedBooks.push({bookId:copy.id,borrowedAt:copy.borrowedAt||null,
            dueDate:copy.dueDate||null,source:'excel_admin_correction'});
        }
        receiptPairs.push({bookId:copy.id,borrower:{type:target.type,id:target.id}});
      }
      noteLoanActivity(db,copy.id);
    }else if(entry.kind==='location'){
      copy.fixedLocation=entry.after||null;
    }else throw Error('unsupported_assignment_kind');
    audit.push({id:crypto.randomUUID(),importBatchId:batchId,
      bookId:copy.id,kind:entry.kind,worksheetRow:entry.worksheetRow,
      before:entry.before,after:entry.after,performedBy:actorId,createdAt:now,
      administrativeCorrection:true});
  }
  if(receiptPairs.length)persistExcelLoanReceipts(db,receiptPairs);
  if(!Array.isArray(db.bookAssignmentCorrectionLog))db.bookAssignmentCorrectionLog=[];
  db.bookAssignmentCorrectionLog.push(...audit);
  return {applied:audit.length,loans:audit.filter(x=>x.kind==='loan').length,
    locations:audit.filter(x=>x.kind==='location').length,audit};
}
module.exports={normalizeResolutions,buildAssignmentPreview,applyAssignmentPreview};
