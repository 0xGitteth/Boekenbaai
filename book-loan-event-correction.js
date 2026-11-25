'use strict';
// Correct a demonstrably artificial check-in followed by a checkout of the
// SAME physical copy to the SAME pupil, without ending the original loan.
const crypto=require('node:crypto');
const {borrowEvents}=require('./book-loan-history-admin');
const {circulationRevision,noteLoanActivity}=require('./book-import-followups');
const norm=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('nl-NL');
const time=value=>Date.parse(value||'');
const close=(a,b)=>Number.isFinite(time(a))&&Number.isFinite(time(b))
  &&Math.abs(time(a)-time(b))<=120000;
const ownLoan=loan=>(typeof loan==='string'?loan:loan?.bookId);
const errorMessages={
  ambiguous_copy:'Dit fysieke exemplaar is niet uniek te identificeren.',
  student_missing:'De leerlinggegevens zijn niet uniek te identificeren.',
  loan_inactive:'Dit exemplaar staat niet als actuele uitlening bij deze leerling.',
  borrower_conflict:'De gegevens over de huidige lener spreken elkaar tegen.',
  missing_events:'De inlevering en heruitlening zijn niet allebei vastgelegd voor dit exemplaar.',
  conflicting_events:'De laatste uitleengebeurtenissen horen niet bij één doorlopende uitlening.',
  unmatched_loan:'De huidige uitleendatum komt niet overeen met de laatste uitlening.',
  reading_missing:'Er is geen unieke leesregistratie gekoppeld aan deze inlevering.',
  reading_changed:'Het leesantwoord is later gewijzigd en mag niet automatisch worden verwijderd.',
  original_unknown:'De oorspronkelijke uitleendatum is niet betrouwbaar vast te stellen.',
  original_conflict:'Er staan andere uitleenbewegingen tijdens de oorspronkelijke leenperiode.',
  period_conflict:'Een geïmporteerde leenperiode overlapt en vereist afzonderlijke controle.',
  exam_conflict:'De examenleeslijst bevat gegevens die niet automatisch veilig kunnen worden hersteld.',
};
function inspect(db,studentId,bookId){
  const blocked=(reason)=>({studentId,bookId,canCorrect:false,
    reason,errorMessage:errorMessages[reason]||'Onvoldoende betrouwbare gegevens.'});
  const copies=(db.books||[]).filter(b=>b?.id===bookId);
  const students=(db.students||[]).filter(s=>s?.id===studentId);
  if(copies.length!==1)return blocked('ambiguous_copy');
  if(students.length!==1)return blocked('student_missing');
  const book=copies[0],student=students[0];
  const info={studentId,studentName:student.name||'',bookId,
    title:book.title||'',barcode:book.barcode||book.editionIsbn||''};
  const stop=reason=>({...info,...blocked(reason)});
  if(book.status!=='borrowed'||book.borrowedBy!==studentId||book.borrowedByClassId)
    return stop('loan_inactive');
  const holders=(db.students||[]).flatMap(s=>(s.borrowedBooks||[])
    .filter(x=>ownLoan(x)===bookId).map(x=>({studentId:s.id,loan:x})));
  if(holders.length!==1||holders[0].studentId!==studentId
    ||typeof holders[0].loan!=='object'||!holders[0].loan
    ||!close(holders[0].loan.borrowedAt,book.borrowedAt))
    return stop('borrower_conflict');
  const events=borrowEvents(db).filter(e=>e.bookId===bookId);
  if(events.length<2||events.some(e=>!e.id||!Number.isFinite(time(e.timestamp))))
    return stop('missing_events');
  events.sort((a,b)=>time(a.timestamp)-time(b.timestamp));
  const [returned,reissued]=events.slice(-2);
  if(returned.type!=='check_in'||reissued.type!=='check_out'
    ||returned.studentId!==studentId||reissued.studentId!==studentId
    ||returned.classId||reissued.classId
    ||!(time(returned.timestamp)<time(reissued.timestamp))
    ||time(reissued.timestamp)-time(returned.timestamp)>48*60*60*1000)
    return stop('conflicting_events');
  if(!close(reissued.timestamp,book.borrowedAt))return stop('unmatched_loan');
  const readings=(db.readingRecords||[]).filter(r=>r.subjectType==='student'
    &&r.subjectId===studentId&&r.bookId===bookId
    &&close(r.reportedAt,returned.timestamp));
  if(readings.length!==1)return stop('reading_missing');
  const reading=readings[0];
  if((reading.revision||1)!==1||(Array.isArray(reading.changes)&&reading.changes.length))
    return stop('reading_changed');
  // Imported loans may have a real earlier checkout date recorded on the
  // compulsory return answer even if no historical checkout EVENT exists.
  // This is evidence of the original loan, not a licence to fabricate events.
  const prior=events.slice(0,-2);
  const claimedAt=time(reading.loanBorrowedAt);
  const latestCheckout=[...prior].reverse().find(e=>
    e.type==='check_out'&&e.studentId===studentId&&!e.classId);
  // If a checkout event exists, it must agree with the immutable return record.
  // Only the absence of such an event permits the imported-loan fallback.
  if(latestCheckout&&Number.isFinite(claimedAt)
    &&!close(latestCheckout.timestamp,reading.loanBorrowedAt))
    return stop('original_conflict');
  const originalAt=Number.isFinite(claimedAt)&&claimedAt<time(returned.timestamp)
    ?reading.loanBorrowedAt
    :latestCheckout?.timestamp;
  if(!Number.isFinite(time(originalAt))||time(originalAt)>=time(returned.timestamp)
    ||time(originalAt)>=time(reissued.timestamp))
    return stop('original_unknown');
  if(Number.isFinite(claimedAt)&&!close(reading.loanBorrowedAt,originalAt))
    return stop('original_conflict');
  const matchingCheckout=prior.filter(e=>e.type==='check_out'
    &&e.studentId===studentId&&close(e.timestamp,originalAt));
  if(matchingCheckout.length>1)return stop('original_conflict');
  // A historical return or another checkout after the genuine loan began
  // requires a human to inspect the full loan chain.
  if(prior.some(e=>time(e.timestamp)>=time(originalAt)-120000
    &&!(e.type==='check_out'&&e.studentId===studentId
      &&matchingCheckout[0]?.id===e.id)))
    return stop('original_conflict');
  const periods=(db.bookLoanPeriods||[]).filter(p=>p.bookId===bookId);
  if(periods.some(p=>{
    const at=time(p.borrowedAt),end=time(p.returnedAt);
    // If a period could overlap the corrected interval, refuse to infer
    // whether its close was a real event.
    return !Number.isFinite(at)||!Number.isFinite(end)
      ||end>=time(originalAt)-120000;
  }))return stop('period_conflict');
  const relevantExam=(db.examReadingLists||[]).filter(x=>x.studentId===studentId
    &&(x.bookId===bookId||x.autoLoanBookId===bookId));
  if(relevantExam.some(x=>x.autoCurrentLoan===true&&x.autoLoanBookId===bookId
    &&!close(x.autoLoanBorrowedAt,reissued.timestamp)))return stop('exam_conflict');
  if(relevantExam.some(x=>x.manualStatus==='gelezen'&&x.addedManually!==true))
    return stop('exam_conflict');
  const autoEntries=relevantExam.filter(x=>x.autoCurrentLoan===true
    &&x.autoLoanBookId===bookId&&close(x.autoLoanBorrowedAt,reissued.timestamp));
  const snapshot={
    bookId,studentId,bookBorrowedAt:book.borrowedAt,
    loanBorrowedAt:holders[0].loan.borrowedAt,
    circulationRevision:circulationRevision(db,bookId),
    events:events.map(e=>[e.id,e.type,e.timestamp,e.studentId,e.classId||'']),
    reading:[reading.id,reading.revision||1,reading.finished,
      reading.updatedAt||'',reading.loanBorrowedAt||''],
    periods:periods.map(p=>[p.id,p.borrowedAt,p.returnedAt]),
    autoEntries:relevantExam.map(e=>[e.id,e.revision||1,e.autoLoanBorrowedAt,
      e.autoCurrentLoan,e.manualStatus,e.addedManually]),
  };
  const fingerprint=crypto.createHash('sha256')
    .update(JSON.stringify(snapshot)).digest('hex');
  return {...info,canCorrect:true,reason:null,errorMessage:'',
    originalCheckoutAt:originalAt,
    // Old Excel loans need not have a checkout event. Do not create one.
    originalCheckoutLogged:matchingCheckout.length===1,
    incorrectReturnAt:returned.timestamp,recheckoutAt:reissued.timestamp,
    incorrectReturnId:returned.id,recheckoutId:reissued.id,
    readingRecordId:reading.id,fingerprint};
}
function candidate(db,studentId,bookId){
  const result=inspect(db,studentId,bookId);
  return result.canCorrect?result:null;
}
function listCandidates(db,{borrower='',book='',limit=60}={}){
  const qStudent=norm(borrower),qBook=norm(book);
  const students=new Map((db.students||[]).map(s=>[s.id,s]));
  const result=[];
  for(const copy of db.books||[]){
    if(copy?.status!=='borrowed'||!copy.borrowedBy)continue;
    if(qBook&&!norm(copy.title).includes(qBook))continue;
    if(qStudent&&!norm(students.get(copy.borrowedBy)?.name).includes(qStudent))continue;
    result.push(inspect(db,copy.borrowedBy,copy.id));
    if(result.length>=Math.min(100,Math.max(1,limit)))break;
  }
  return result;
}
function correctContinuousLoan(db,actor,input,now=new Date().toISOString()){
  if(actor?.role!=='admin')return {ok:false,error:'forbidden'};
  if(!input||input.confirm!==true||input.reason!=='false_return_and_recheckout'
    ||typeof input.studentId!=='string'||typeof input.bookId!=='string'
    ||typeof input.expectedFingerprint!=='string')
    return {ok:false,error:'invalid_request'};
  const verified=candidate(db,input.studentId,input.bookId);
  if(!verified||verified.fingerprint!==input.expectedFingerprint)
    return {ok:false,error:'changed_or_ambiguous'};
  const copy=db.books.find(b=>b.id===verified.bookId);
  const student=db.students.find(s=>s.id===verified.studentId);
  const current=student.borrowedBooks.find(x=>ownLoan(x)===verified.bookId);
  // All validations above precede the first mutation.
  const ids=new Set([verified.incorrectReturnId,verified.recheckoutId]);
  db.history=(db.history||[]).filter(e=>!ids.has(e.id));
  db.bookLoanEvents=(db.bookLoanEvents||[]).filter(e=>!ids.has(e.id));
  db.readingRecords=(db.readingRecords||[]).filter(r=>r.id!==verified.readingRecordId);
  copy.borrowedAt=verified.originalCheckoutAt;
  current.borrowedAt=verified.originalCheckoutAt;
  for(const entry of db.examReadingLists||[]){
    if(entry.studentId===verified.studentId&&entry.autoCurrentLoan===true
      &&entry.autoLoanBookId===verified.bookId
      &&close(entry.autoLoanBorrowedAt,verified.recheckoutAt)){
      entry.autoLoanBorrowedAt=verified.originalCheckoutAt;
      entry.revision=(entry.revision||1)+1;
      entry.updatedAt=now;
      entry.updatedBy=actor.id;
    }
  }
  noteLoanActivity(db,verified.bookId);
  if(!Array.isArray(db.bookLoanEventCorrectionAudit))db.bookLoanEventCorrectionAudit=[];
  db.bookLoanEventCorrectionAudit.push({
    id:crypto.randomUUID(),performedBy:actor.id,at:now,
    reason:'false_return_and_recheckout',studentId:verified.studentId,
    bookId:verified.bookId,originalCheckoutAt:verified.originalCheckoutAt,
    incorrectReturnAt:verified.incorrectReturnAt,recheckoutAt:verified.recheckoutAt,
    removedEventIds:[verified.incorrectReturnId,verified.recheckoutId],
    removedReadingRecordId:verified.readingRecordId,
    originalLoanStillActive:true,
  });
  return {ok:true,removedEvents:2,removedReadingRecords:1,
    originalLoanStillActive:true,bookId:verified.bookId};
}
module.exports={candidate,listCandidates,correctContinuousLoan};
