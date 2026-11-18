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
function candidate(db,studentId,bookId){
  const copies=(db.books||[]).filter(b=>b?.id===bookId);
  const students=(db.students||[]).filter(s=>s?.id===studentId);
  if(copies.length!==1||students.length!==1)return null;
  const book=copies[0],student=students[0];
  if(book.status!=='borrowed'||book.borrowedBy!==studentId||book.borrowedByClassId)
    return null;
  const holders=(db.students||[]).flatMap(s=>(s.borrowedBooks||[])
    .filter(x=>ownLoan(x)===bookId).map(x=>({studentId:s.id,loan:x})));
  if(holders.length!==1||holders[0].studentId!==studentId
    ||typeof holders[0].loan!=='object'||!holders[0].loan
    ||!close(holders[0].loan.borrowedAt,book.borrowedAt))return null;
  const events=borrowEvents(db).filter(e=>e.bookId===bookId)
    .sort((a,b)=>time(a.timestamp)-time(b.timestamp));
  if(events.length<3||events.some(e=>!Number.isFinite(time(e.timestamp))))return null;
  const [original,returned,reissued]=events.slice(-3);
  if(original.type!=='check_out'||returned.type!=='check_in'
    ||reissued.type!=='check_out'||!original.id||!returned.id||!reissued.id
    ||[original,returned,reissued].some(e=>e.studentId!==studentId||e.classId)
    ||!(time(original.timestamp)<time(returned.timestamp)
      &&time(returned.timestamp)<time(reissued.timestamp))
    ||time(reissued.timestamp)-time(returned.timestamp)>48*60*60*1000
    ||!close(reissued.timestamp,book.borrowedAt))return null;
  // A previously imported loan interval could depend on the same events.
  // Do not rewrite an ambiguous historical interval.
  if((db.bookLoanPeriods||[]).some(p=>p.bookId===bookId
    &&(!Number.isFinite(time(p.returnedAt||p.borrowedAt))
      ||time(p.returnedAt||p.borrowedAt)>=time(original.timestamp))))return null;
  const records=(db.readingRecords||[]).filter(r=>r.subjectType==='student'
    &&r.subjectId===studentId&&r.bookId===bookId
    &&close(r.reportedAt,returned.timestamp));
  if(records.length!==1)return null;
  const reading=records[0];
  if(!close(reading.loanBorrowedAt,original.timestamp)
    ||(reading.revision||1)!==1
    ||(Array.isArray(reading.changes)&&reading.changes.length))return null;
  // An explicit exam-list status is never deleted or guessed. Only a current
  // automatic loan timestamp may be restored to the original checkout.
  const autoEntries=(db.examReadingLists||[]).filter(x=>x.studentId===studentId
    &&x.autoCurrentLoan===true&&x.autoLoanBookId===bookId
    &&close(x.autoLoanBorrowedAt,reissued.timestamp));
  if((db.examReadingLists||[]).some(x=>x.studentId===studentId
    &&x.autoCurrentLoan===true&&x.autoLoanBookId===bookId
    &&!close(x.autoLoanBorrowedAt,reissued.timestamp)))return null;
  const snapshot={
    bookId,studentId,bookBorrowedAt:book.borrowedAt,
    loanBorrowedAt:holders[0].loan.borrowedAt,
    circulationRevision:circulationRevision(db,bookId),
    events:[original,returned,reissued].map(e=>[e.id,e.type,e.timestamp,e.studentId]),
    reading:[reading.id,reading.revision||1,reading.finished,reading.updatedAt||''],
    autoEntries:autoEntries.map(e=>[e.id,e.revision||1,e.autoLoanBorrowedAt]),
  };
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return {studentId,studentName:student.name||'',bookId,title:book.title||'',
    originalCheckoutAt:original.timestamp,incorrectReturnAt:returned.timestamp,
    recheckoutAt:reissued.timestamp,incorrectReturnId:returned.id,
    recheckoutId:reissued.id,readingRecordId:reading.id,fingerprint};
}
function listCandidates(db,{borrower='',book='',limit=60}={}){
  const qStudent=norm(borrower),qBook=norm(book);
  const students=new Map((db.students||[]).map(s=>[s.id,s]));
  const result=[];
  for(const copy of db.books||[]){
    if(copy?.status!=='borrowed'||!copy.borrowedBy)continue;
    if(qBook&&!norm(copy.title).includes(qBook))continue;
    if(qStudent&&!norm(students.get(copy.borrowedBy)?.name).includes(qStudent))continue;
    const entry=candidate(db,copy.borrowedBy,copy.id);
    if(entry)result.push(entry);
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
