'use strict';

// Durable circulation events and privacy-conscious correction of provably
// wrong historical student-book relationships. Current live loans are never
// touched by these operations.
const crypto = require('node:crypto');
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
    item.studentId===studentId&&item.bookId===bookId);
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
function searchHistory(db,{student='',book='',limit=100}={}){
  const studentQuery=norm(student),bookQuery=norm(book);
  const students=new Map((db.students||[]).map(item=>[item.id,item]));
  const books=new Map((db.books||[]).map(item=>[item.id,item]));
  const candidates=new Map();
  for(const event of borrowEvents(db)){
    if(!event.studentId||!event.bookId)continue;
    const key=JSON.stringify([event.studentId,event.bookId]);
    candidates.set(key,{studentId:event.studentId,bookId:event.bookId});
  }
  for(const period of db.bookLoanPeriods||[]){
    if(!period?.studentId||!period.bookId)continue;
    const key=JSON.stringify([period.studentId,period.bookId]);
    candidates.set(key,{studentId:period.studentId,bookId:period.bookId});
  }
  for(const record of db.readingRecords||[]){
    if(record?.subjectType!=='student'||!record.subjectId||!record.bookId)continue;
    const key=JSON.stringify([record.subjectId,record.bookId]);
    candidates.set(key,{studentId:record.subjectId,bookId:record.bookId});
  }
  const matches=[];
  for(const value of candidates.values()){
    const studentItem=students.get(value.studentId);
    const bookItem=books.get(value.bookId);
    const readings=(db.readingRecords||[]).find(record=>
      record.subjectType==='student'&&record.subjectId===value.studentId
      &&record.bookId===value.bookId);
    const studentName=String(studentItem?.name||'Leerling niet meer aanwezig');
    const title=String(bookItem?.title||readings?.title||'Boek niet meer aanwezig');
    if(studentQuery&&!norm(studentName).includes(studentQuery))continue;
    if(bookQuery&&!norm(title).includes(bookQuery))continue;
    const group=pair(db,value.studentId,value.bookId);
    const active=(studentItem?.borrowedBooks||[]).some(loan=>
      (typeof loan==='string'?loan:loan?.bookId)===value.bookId);
    matches.push({
      ...value,studentName,title,author:bookItem?.author||readings?.author||'',
      historyEvents:group.logs.length,readingRecords:group.readings.length,
      importedPeriods:group.periods.length,
      examEntries:group.exams.length,
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
  const examIds=new Set(group.exams.map(item=>item.id));
  db.history=(db.history||[]).filter(item=>!logIds.has(item.id));
  db.bookLoanEvents=(db.bookLoanEvents||[]).filter(item=>!logIds.has(item.id));
  db.readingRecords=(db.readingRecords||[]).filter(item=>!readingIds.has(item.id));
  db.bookLoanPeriods=(db.bookLoanPeriods||[])
    .filter(item=>!periodIds.has(item.id));
  db.examReadingLists=(db.examReadingLists||[])
    .filter(item=>!examIds.has(item.id));
  // The administrator explicitly removes this exact student-copy
  // relationship, including a linked exam list entry for the same copy.
  // Unrelated manual/external exam titles remain untouched.
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
  removeFalseHistory,fingerprint};
