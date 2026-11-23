'use strict';

// Reservation queue is stored in db.json, never in a browser or a loan record.
// Work-level reservations accept any edition; an edition-specific request is
// fulfilled only by that edition. FIFO is enforced against the actual copy.
const {randomUUID}=require('node:crypto');
const {canonicalizeBookIsbn13}=require('./book-edition-core');
const {studentLoanIds,isUnavailable,isHidden}=require('./book-catalog-integrity');
const {recipientsForStudent}=require('./reading-change-notifications');

const HOLD_MS=7*24*60*60*1000;
const ACTIVE=new Set(['waiting','ready']);
function text(value){return String(value??'').normalize('NFKC')
  .trim().replace(/\s+/g,' ').toLocaleLowerCase('nl-NL');}
function workKey(book){return JSON.stringify([
  text(book?.title),text(book?.author).replace(/[.,;:!?\s]+$/g,''),
]);}
function editionKey(book){
  const isbn=canonicalizeBookIsbn13(book?.editionIsbn)
    ||canonicalizeBookIsbn13(book?.metadataIsbn)
    ||canonicalizeBookIsbn13(book?.barcode);
  return isbn?'isbn:'+isbn:'publisher:'+text(book?.publisher);
}
function reservations(db){
  if(!Array.isArray(db.bookReservations))db.bookReservations=[];
  return db.bookReservations;
}
function activeStudent(db,studentId){
  return (db.students||[]).find(s=>s?.id===studentId
    &&s.active!==false&&s.status!=='inactive')||null;
}
function activeQueue(db,key){
  return reservations(db).filter(x=>x.workKey===key&&ACTIVE.has(x.status))
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))
      ||String(a.id).localeCompare(String(b.id)));
}
function holdFor(db,bookId,now=Date.now()){
  return reservations(db).find(x=>x.status==='ready'
    &&x.readyBookId===bookId
    &&Number.isFinite(Date.parse(x.expiresAt))
    &&Date.parse(x.expiresAt)>now)||null;
}
function isFree(book,owners){
  return Boolean(book?.id&&!isHidden(book)&&!isUnavailable(book,owners));
}
function candidateBooks(db,reference,edition=null){
  const key=workKey(reference);
  return (db.books||[]).filter(book=>workKey(book)===key
    &&!isHidden(book)&&(!edition||editionKey(book)===edition));
}
function readyFor(db,book,studentId,now=Date.now()){
  const hold=holdFor(db,book?.id,now);
  return Boolean(hold&&hold.studentId===studentId);
}
function availableTo(db,book,studentId=null,now=Date.now(),owners=null){
  if(!isFree(book,owners||studentLoanIds(db)))return false;
  const hold=holdFor(db,book.id,now);
  return !hold||hold.studentId===studentId;
}
function readyQueuePosition(db,reservation){
  const queue=activeQueue(db,reservation.workKey);
  const matching=queue.filter(x=>!reservation.editionKey
    ||!x.editionKey||x.editionKey===reservation.editionKey);
  return matching.findIndex(x=>x.id===reservation.id)+1;
}
function publicReservation(db,x){
  return {
    id:x.id,title:x.title,author:x.author,
    editionKey:x.editionKey||null,status:x.status,
    createdAt:x.createdAt,readyAt:x.readyAt||null,
    expiresAt:x.expiresAt||null,readyBookId:x.status==='ready'?x.readyBookId:null,
    position:x.status==='waiting'?readyQueuePosition(db,x):null,
  };
}
function forStudent(db,studentId){
  return reservations(db).filter(x=>x.studentId===studentId
    &&ACTIVE.has(x.status))
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))
    .map(x=>publicReservation(db,x));
}
function forTeacher(db,teacher){
  if(!teacher?.id||teacher.role!=='teacher')return [];
  return reservations(db).filter(x=>x.status==='ready'
    &&activeStudent(db,x.studentId)
    &&recipientsForStudent(db,activeStudent(db,x.studentId)).includes(teacher.id))
    .map(x=>({
      id:x.id,title:x.title,author:x.author,readyAt:x.readyAt,
      expiresAt:x.expiresAt,
      studentName:activeStudent(db,x.studentId)?.name||'Leerling',
    })).sort((a,b)=>String(b.readyAt).localeCompare(String(a.readyAt)));
}
function chooseNext(db,book,now=Date.now()){
  if(!isFree(book,studentLoanIds(db))||holdFor(db,book.id,now))return null;
  const queue=activeQueue(db,workKey(book));
  const chosen=queue.find(x=>x.status==='waiting'
    &&(!x.editionKey||x.editionKey===editionKey(book))
    &&activeStudent(db,x.studentId));
  if(!chosen)return null;
  chosen.status='ready';
  chosen.readyBookId=book.id;
  chosen.readyAt=new Date(now).toISOString();
  chosen.expiresAt=new Date(now+HOLD_MS).toISOString();
  chosen.mentorIds=recipientsForStudent(db,activeStudent(db,chosen.studentId));
  return chosen;
}
// Called before circulation actions and periodically by the existing mail
// worker. Expiration is durable; a missed reservation advances to the next.
function reconcile(db,now=Date.now()){
  let changed=false;
  const byId=new Map((db.books||[]).filter(x=>x?.id).map(x=>[x.id,x]));
  const owners=studentLoanIds(db);
  for(const x of reservations(db)){
    if(!ACTIVE.has(x.status))continue;
    if(!activeStudent(db,x.studentId)){
      x.status='cancelled';x.cancelledAt=new Date(now).toISOString();changed=true;continue;
    }
    if(x.status!=='ready')continue;
    const copy=byId.get(x.readyBookId);
    if(!copy||!isFree(copy,owners)||Date.parse(x.expiresAt)<=now){
      x.status=copy&&isFree(copy,owners)?'expired':'waiting';
      x.readyBookId=null;x.expiresAt=null;changed=true;
    }
  }
  // If a copy is already available (e.g. after import), give the first
  // waiting pupil priority without guessing their physical edition.
  for(const copy of db.books||[]){
    if(!isFree(copy,owners)||holdFor(db,copy.id,now))continue;
    if(chooseNext(db,copy,now))changed=true;
  }
  return changed;
}
function create(db,{studentId,bookId,specificEdition=false,now=Date.now()}){
  const student=activeStudent(db,studentId);
  const book=(db.books||[]).find(x=>x.id===bookId);
  if(!student)return {ok:false,status:403,message:'Leerlingaccount is niet actief.'};
  if(!book||isHidden(book))return {ok:false,status:404,message:'Boek niet gevonden.'};
  reconcile(db,now);
  const key=workKey(book);
  const edition=specificEdition===true?editionKey(book):null;
  // A student cannot queue for another copy of a book already in their loan
  // list, regardless of edition.
  if((student.borrowedBooks||[]).some(entry=>
    candidateBooks(db,book).some(copy=>copy.id===(entry?.bookId||entry))))
    return {ok:false,status:409,message:'Je hebt deze titel al geleend.'};
  // One active reservation per student and work, even when editions differ.
  // Prevents claiming two different copies from the same waitlist.
  const existing=activeQueue(db,key).find(x=>x.studentId===studentId);
  if(existing)return {ok:true,created:false,reservation:publicReservation(db,existing)};
  const copies=candidateBooks(db,book,edition);
  if(copies.some(copy=>availableTo(db,copy,studentId,now)))
    return {ok:false,status:409,
      message:'Deze uitgave is beschikbaar. Je kunt het boek lenen.'};
  const item={id:randomUUID(),studentId,workKey:key,editionKey:edition,
    title:book.title,author:book.author,createdAt:new Date(now).toISOString(),
    status:'waiting',readyAt:null,expiresAt:null,readyBookId:null};
  reservations(db).push(item);
  return {ok:true,created:true,reservation:publicReservation(db,item)};
}
function cancel(db,studentId,reservationId,now=Date.now()){
  const item=reservations(db).find(x=>x.id===reservationId&&x.studentId===studentId);
  if(!item||!ACTIVE.has(item.status))
    return {ok:false,status:404,message:'Actieve reservering niet gevonden.'};
  const freed=(db.books||[]).find(x=>x.id===item.readyBookId);
  item.status='cancelled';item.cancelledAt=new Date(now).toISOString();
  if(freed)chooseNext(db,freed,now);
  return {ok:true};
}
function onCheckout(db,book,studentId,now=Date.now()){
  const held=holdFor(db,book?.id,now);
  if(held&&held.studentId!==studentId)return {
    ok:false,status:409,message:'Dit exemplaar ligt klaar voor een reservering.'};
  const eligible=reservations(db).filter(x=>x.studentId===studentId
    &&x.workKey===workKey(book)&&ACTIVE.has(x.status));
  const release=[];
  for(const x of eligible){
    if(x.status==='ready'&&x.readyBookId!==book.id){
      const copy=(db.books||[]).find(b=>b.id===x.readyBookId);
      if(copy)release.push(copy);
    }
    x.status='fulfilled';x.fulfilledAt=new Date(now).toISOString();
    x.fulfilledBookId=book.id;
  }
  // The checkout action must commit with the reservation status change.
  return {ok:true,release};
}
function afterCheckout(db,freed,now=Date.now()){
  for(const copy of freed||[])chooseNext(db,copy,now);
}
module.exports={HOLD_MS,workKey,editionKey,reservations,holdFor,readyFor,
  availableTo,candidateBooks,forStudent,forTeacher,chooseNext,reconcile,create,
  cancel,onCheckout,afterCheckout,publicReservation};
