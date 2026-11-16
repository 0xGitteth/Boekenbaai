'use strict';

// Durable circulation events and privacy-conscious correction of provably
// wrong historical student-book relationships. Current live loans are never
// touched by these operations.
const crypto = require('node:crypto');
const {noteLoanActivity,circulationRevision}=require('./book-import-followups');
const {persistExcelLoanReceipts}=require('./book-import-loan-migration');
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const norm = x => String(x || '').normalize('NFKC').trim().toLocaleLowerCase('nl-NL');
const eventTypes = new Set(['check_out','check_in','check_out_class','check_in_class']);
function borrowEvents(db){
  const durable=Array.isArray(db.bookLoanEvents)?db.bookLoanEvents:[];
  const recent=Array.isArray(db.history)?db.history:[];
  const byId=new Map();
  for(const event of [...recent,...durable]){
    if(event && eventTypes.has(event.type) && event.id)
      byId.set(event.id,event);
  }
  return [...byId.values()];
}
function borrowCountEvents(db){
  const events=borrowEvents(db);
  // Every actual check-out is already one occurrence. A confirmed
  // historical Excel period counts only when no corresponding recorded
  // check-out is available for the same physical copy, borrower and date.
  const issued=events.filter(event=>
    event.type==='check_out'||event.type==='check_out_class');
  const matches=(event,period)=>{
    if(event.bookId!==period.bookId)return false;
    const sameStudent=period.studentId&&event.studentId===period.studentId;
    const sameClass=period.classId&&event.classId===period.classId;
    if(!sameStudent&&!sameClass)return false;
    // Without timestamps, matching an identical physical copy and borrower
    // is more conservative than inflating the count.
    if(!period.borrowedAt||!event.timestamp)return true;
    const start=Date.parse(period.borrowedAt),time=Date.parse(event.timestamp);
    return !Number.isFinite(start)||!Number.isFinite(time)
      ||Math.abs(start-time)<=120000;
  };
  const remaining=[...issued];
  const missing=(db.bookLoanPeriods||[]).filter(period=>{
    const index=remaining.findIndex(event=>matches(event,period));
    if(index>=0){remaining.splice(index,1);return false;}
    return true;
  }).map(period=>({type:'check_out',bookId:period.bookId,
    studentId:period.studentId||null,classId:period.classId||null}));
  return [...events,...missing];
}
function appendDurableLoanEvent(db,event){
  if(!event || !eventTypes.has(event.type) || !event.id)return false;
  if(!Array.isArray(db.bookLoanEvents))db.bookLoanEvents=[];
  if(db.bookLoanEvents.some(item=>item.id===event.id))return false;
  db.bookLoanEvents.push({...event});
  return true;
}
function pair(db,studentId,bookId){
  const logs=borrowEvents(db).filter(entry=>
    entry.studentId===studentId && entry.bookId===bookId);
  const readings=(db.readingRecords||[]).filter(record=>
    record.subjectType==='student'&&record.subjectId===studentId
    &&record.bookId===bookId);
  const exams=(db.examReadingLists||[]).filter(item=>
    item.studentId===studentId&&item.bookId===bookId
      &&item.addedManually!==true&&item.externalSource!==true);
  const periods=(db.bookLoanPeriods||[]).filter(period=>
    period.studentId===studentId&&period.bookId===bookId);
  return {logs,readings,periods,exams};
}
function fingerprint(group){
  return crypto.createHash('sha256').update(JSON.stringify([
    group.logs.map(x=>x.id).sort(),
    group.readings.map(x=>x.id).sort(),
    group.periods.map(x=>x.id).sort(),
    group.exams.map(x=>x.id).sort(),
  ])).digest('hex');
}
function activeFingerprint(db,copy){
  return crypto.createHash('sha256').update(JSON.stringify([
    copy.id,copy.status,copy.borrowedBy||'',
    copy.borrowedByClassId||'',copy.borrowedAt||'',copy.dueDate||'',
    circulationRevision(db,copy.id),
  ])).digest('hex');
}
function listCurrentLoans(db,{borrower='',book='',limit=100}={}){
  const people=new Map((db.students||[]).map(item=>[item.id,item]));
  const classes=new Map((db.classes||[]).map(item=>[item.id,item]));
  const owner=norm(borrower),title=norm(book);
  const current=[];
  for(const copy of db.books||[]){
    if(copy.status!=='borrowed')continue;
    const type=copy.borrowedBy?'student':copy.borrowedByClassId?'class':null;
    if(!type)continue;
    const holder=type==='student'?people.get(copy.borrowedBy)
      :classes.get(copy.borrowedByClassId);
    const name=String(holder?.name||'Onbekende lener');
    if(owner&&!norm(name).includes(owner))continue;
    if(title&&!norm(copy.title).includes(title))continue;
    current.push({
      bookId:copy.id,title:copy.title||'',author:copy.author||'',
      barcode:copy.barcode||'',borrowerType:type,
      borrowerId:type==='student'?copy.borrowedBy:copy.borrowedByClassId,
      borrowerName:name,borrowedAt:copy.borrowedAt||null,
      fingerprint:activeFingerprint(db,copy),
    });
  }
  return current.sort((a,b)=>a.borrowerName.localeCompare(b.borrowerName,'nl')
    ||a.title.localeCompare(b.title,'nl')).slice(0,Math.max(1,Math.min(limit,250)));
}
function removeFalseCurrentLoan(db,actor,input,now=new Date().toISOString()){
  if(actor?.role!=='admin')return {ok:false,error:'forbidden'};
  if(input?.confirm!==true||!input.bookId||!input.borrowerId
    ||!['student','class'].includes(input.borrowerType)
    ||typeof input.expectedFingerprint!=='string')
    return {ok:false,error:'invalid_request'};
  const copy=(db.books||[]).find(book=>book.id===input.bookId);
  if(!copy||copy.status!=='borrowed')
    return {ok:false,error:'loan_not_active'};
  const actualType=copy.borrowedBy?'student':copy.borrowedByClassId?'class':null;
  const actualId=actualType==='student'?copy.borrowedBy:copy.borrowedByClassId;
  if(actualType!==input.borrowerType||actualId!==input.borrowerId
    ||activeFingerprint(db,copy)!==input.expectedFingerprint)
    return {ok:false,error:'loan_changed'};
  if(actualType==='student'){
    const student=(db.students||[]).find(item=>item.id===actualId);
    if(!student||!Array.isArray(student.borrowedBooks)
      ||!student.borrowedBooks.some(item=>
        (typeof item==='string'?item:item?.bookId)===copy.id))
      return {ok:false,error:'student_record_mismatch'};
    student.borrowedBooks=student.borrowedBooks.filter(item=>
      (typeof item==='string'?item:item?.bookId)!==copy.id);
  }
  persistExcelLoanReceipts(db,[{
    bookId:copy.id,borrower:{type:actualType,id:actualId},
  }]);
  copy.status='available';
  copy.borrowedBy=null;
  copy.borrowedByClassId=null;
  copy.borrowedAt=null;
  copy.dueDate=null;
  noteLoanActivity(db,copy.id);
  if(!Array.isArray(db.bookLoanCurrentCorrectionAudit))
    db.bookLoanCurrentCorrectionAudit=[];
  db.bookLoanCurrentCorrectionAudit.push({
    id:crypto.randomUUID(),bookId:copy.id,borrowerId:actualId,
    borrowerType:actualType,performedBy:actor.id,at:now,
    reason:'incorrect_current_loan',
  });
  return {ok:true,bookId:copy.id,activeLoanRemoved:true,
    historyUnchanged:true};
}
function searchHistory(db,{student='',book='',limit=100}={}){
  const studentQuery=norm(student),bookQuery=norm(book);
  const students=new Map((db.students||[]).map(item=>[item.id,item]));
  const books=new Map((db.books||[]).map(item=>[item.id,item]));
  const grouped=new Map();
  const groupFor=(studentId,bookId)=>{
    const key=JSON.stringify([studentId,bookId]);
    if(!grouped.has(key))grouped.set(key,{
      studentId,bookId,logs:[],readings:[],periods:[],exams:[],
    });
    return grouped.get(key);
  };
  // One linear scan per source. Do not scan all history again for
  // each candidate: school-sized histories can contain thousands of pairs.
  for(const event of borrowEvents(db)){
    if(event.studentId&&event.bookId)
      groupFor(event.studentId,event.bookId).logs.push(event);
  }
  for(const period of db.bookLoanPeriods||[]){
    if(period?.studentId&&period.bookId)
      groupFor(period.studentId,period.bookId).periods.push(period);
  }
  for(const record of db.readingRecords||[]){
    if(record?.subjectType==='student'&&record.subjectId&&record.bookId)
      groupFor(record.subjectId,record.bookId).readings.push(record);
  }
  for(const item of db.examReadingLists||[]){
    if(item?.studentId&&item.bookId
      &&item.addedManually!==true&&item.externalSource!==true){
      const key=JSON.stringify([item.studentId,item.bookId]);
      if(grouped.has(key))grouped.get(key).exams.push(item);
    }
  }
  const matches=[];
  for(const group of grouped.values()){
    const studentItem=students.get(group.studentId);
    const bookItem=books.get(group.bookId);
    const studentName=String(studentItem?.name||'Leerling niet meer aanwezig');
    const title=String(bookItem?.title
      ||group.readings[0]?.title||'Boek niet meer aanwezig');
    if(studentQuery&&!norm(studentName).includes(studentQuery))continue;
    if(bookQuery&&!norm(title).includes(bookQuery))continue;
    const active=(studentItem?.borrowedBooks||[]).some(loan=>
      (typeof loan==='string'?loan:loan?.bookId)===group.bookId);
    matches.push({
      studentId:group.studentId,bookId:group.bookId,
      studentName,title,author:bookItem?.author||group.readings[0]?.author||'',
      historyEvents:group.logs.length,readingRecords:group.readings.length,
      importedPeriods:group.periods.length,examEntries:group.exams.length,
      activeLoan:active,fingerprint:fingerprint(group),
    });
  }
  return matches.sort((a,b)=>a.studentName.localeCompare(b.studentName,'nl')
    ||a.title.localeCompare(b.title,'nl')).slice(0,Math.max(1,Math.min(limit,250)));
}
function removeFalseHistory(db,actor,input,now=new Date().toISOString()){
  if(actor?.role!=='admin')return {ok:false,error:'forbidden'};
  const {studentId,bookId,expectedFingerprint,confirm}=input||{};
  if(typeof studentId!=='string'||typeof bookId!=='string'
    ||typeof expectedFingerprint!=='string'||confirm!==true)
    return {ok:false,error:'invalid_request'};
  const group=pair(db,studentId,bookId);
  if(!group.logs.length&&!group.readings.length&&!group.periods.length)
    return {ok:false,error:'no_history'};
  if(fingerprint(group)!==expectedFingerprint)
    return {ok:false,error:'history_changed'};
  const logIds=new Set(group.logs.map(item=>item.id));
  const readingIds=new Set(group.readings.map(item=>item.id));
  const periodIds=new Set(group.periods.map(item=>item.id));
  // Exam entries are edition-wide, even if their bookId still points to
  // the first physical copy that created the entry. A later completed
  // reading of another copy must survive deletion of this false history.
  const booksById=new Map((db.books||[]).map(copy=>[copy.id,copy]));
  const edition=copy=>canonicalizeBookIsbn13(copy?.editionIsbn)
    ||canonicalizeBookIsbn13(copy?.metadataIsbn)
    ||canonicalizeBookIsbn13(copy?.isbn13)
    ||canonicalizeBookIsbn13(copy?.barcode);
  const removedEdition=edition(booksById.get(bookId));
  const retainedReading=(db.readingRecords||[]).some(record=>
    record.subjectType==='student'&&record.subjectId===studentId
    &&record.finished===true&&!readingIds.has(record.id)
    &&removedEdition&&(edition(booksById.get(record.bookId))
      ||canonicalizeBookIsbn13(record.isbn)
      ||canonicalizeBookIsbn13(record.editionIsbn)
      ||canonicalizeBookIsbn13(record.metadataIsbn)
      ||(/^isbn13\|\|[0-9]{13}$/.test(String(record.editionKey||''))
        ?canonicalizeBookIsbn13(String(record.editionKey).slice(8)):null)
      )===removedEdition);
  const retainedCurrentLoan=(db.books||[]).some(copy=>
    copy.status==='borrowed'
    &&copy.borrowedBy===studentId&&removedEdition
    &&edition(copy)===removedEdition);
  const examIds=retainedReading||retainedCurrentLoan
    ?new Set():new Set(group.exams.map(item=>item.id));
  db.history=(db.history||[]).filter(item=>!logIds.has(item.id));
  db.bookLoanEvents=(db.bookLoanEvents||[]).filter(item=>!logIds.has(item.id));
  db.readingRecords=(db.readingRecords||[]).filter(item=>!readingIds.has(item.id));
  db.bookLoanPeriods=(db.bookLoanPeriods||[])
    .filter(item=>!periodIds.has(item.id));
  db.examReadingLists=(db.examReadingLists||[])
    .filter(item=>!examIds.has(item.id));
  // Only automatically derived exam-list entries linked to this
  // relationship are removed. Explicitly or externally added entries
  // remain independent records and require a separate user decision.
  if(!Array.isArray(db.bookLoanHistoryDeletionAudit))
    db.bookLoanHistoryDeletionAudit=[];
  db.bookLoanHistoryDeletionAudit.push({
    id:crypto.randomUUID(),performedBy:actor.id,at:now,
    studentId,bookId,eventsRemoved:logIds.size,
    readingRecordsRemoved:readingIds.size,
    importedPeriodsRemoved:periodIds.size,examEntriesRemoved:examIds.size,
  });
  return {ok:true,eventsRemoved:logIds.size,
    readingRecordsRemoved:readingIds.size,
    importedPeriodsRemoved:periodIds.size,
    examEntriesRemoved:examIds.size,activeLoanUnchanged:true};
}
module.exports={appendDurableLoanEvent,borrowEvents,borrowCountEvents,searchHistory,
  removeFalseHistory,fingerprint,listCurrentLoans,removeFalseCurrentLoan};
