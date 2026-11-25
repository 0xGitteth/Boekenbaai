'use strict';
const assert=require('node:assert/strict');
const reservation=require('../book-reservations');
const NOW=Date.parse('2026-11-20T15:00:00Z');
const book=(id,extra={})=>({
  id,title:'Spijt!',author:'Carry Slee',editionIsbn:'9789048849178',
  barcode:'9789048849178',status:'borrowed',borrowedBy:'s3',
  borrowedByClassId:null,catalogHidden:false,...extra,
});
const student=id=>({id,name:id,active:true,borrowedBooks:[],classIds:['c1']});
const db=()=>({
  books:[book('b1',{author:'Carry Slee.'})],
  students:[student('s1'),student('s2'),student('s3')],
  users:[{id:'t1',role:'teacher',active:true}],
  classes:[{id:'c1',studentIds:['s1','s2','s3'],teacherIds:['t1']}],
  bookReservations:[],
});
{
  const data=db();
  assert.equal(reservation.workKey(data.books[0]),
    reservation.workKey({...data.books[0],author:'Carry Slee'}));
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW}).ok,true);
  assert.equal(reservation.create(data,{studentId:'s2',bookId:'b1',now:NOW+1}).ok,true);
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW+2}).created,false,
    'Clicking Reserve twice must be idempotent');
  assert.equal(data.bookReservations.length,2);
  assert.deepEqual(reservation.forStudent(data,'s2').map(x=>x.position),[2]);
  data.books[0].status='available';data.books[0].borrowedBy=null;
  assert.equal(reservation.reconcile(data,NOW+3000),true);
  assert.equal(reservation.forStudent(data,'s1')[0].status,'ready');
  assert.equal(reservation.forStudent(data,'s2')[0].status,'waiting');
  assert.equal(reservation.holdFor(data,'b1',NOW+3000).studentId,'s1');
  assert.equal(reservation.availableTo(data,data.books[0],'s2',NOW+3000),false);
  assert.equal(reservation.availableTo(data,data.books[0],'s1',NOW+3000),true);
  assert.equal(reservation.onCheckout(data,data.books[0],'s2',NOW+3001).ok,false,
    'A waiting student must not bypass the front of the queue');
  assert.equal(reservation.forTeacher(data,data.users[0]).length,1);
  assert.equal(reservation.onCheckout(data,data.books[0],'s1',NOW+3001).ok,true);
  data.books[0].status='borrowed';data.books[0].borrowedBy='s1';
  assert.equal(reservation.forStudent(data,'s1').length,0,
    'Successful checkout resolves the ready hold and queue record');
  assert.equal(reservation.forStudent(data,'s2')[0].status,'waiting');
  data.books[0].status='available';data.books[0].borrowedBy=null;
  assert.equal(reservation.reconcile(data,NOW+10000),true);
  assert.equal(reservation.forStudent(data,'s2')[0].status,'ready',
    'Second student is notified only after another return');
}
{
  const data=db();
  reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW});
  reservation.create(data,{studentId:'s2',bookId:'b1',now:NOW+1});
  data.books[0].status='available';data.books[0].borrowedBy=null;
  reservation.reconcile(data,NOW+3000);
  assert.equal(reservation.cancel(data,'s1',data.bookReservations[0].id,NOW+3200).ok,true);
  assert.equal(reservation.forStudent(data,'s2')[0].status,'ready',
    'Cancellation immediately advances queue to next student');
  assert.equal(reservation.cancel(data,'s1',data.bookReservations[1].id).status,404,
    'Students cannot cancel another pupil’s booking');
}
{
  const data=db();
  reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW});
  reservation.create(data,{studentId:'s2',bookId:'b1',now:NOW+1});
  data.books[0].status='available';data.books[0].borrowedBy=null;
  reservation.reconcile(data,NOW+3000);
  const expiredAt=NOW+3000+reservation.HOLD_MS+1;
  reservation.reconcile(data,expiredAt);
  assert.equal(reservation.forStudent(data,'s1').length,0);
  assert.equal(reservation.forStudent(data,'s2')[0].status,'ready',
    'Uncollected holds expire and advance to the next booking');
}
{
  const data=db();
  data.books.push(book('b2',{editionIsbn:'9789026988646',barcode:'9789026988646',
    author:'Carry Slee',status:'available',borrowedBy:null}));
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW}).status,409,
    'A work-level booking is unnecessary while another edition is free');
  const specific=reservation.create(data,{studentId:'s1',bookId:'b1',
    specificEdition:true,now:NOW});
  assert.equal(specific.ok,true,
    'The borrowed edition may be reserved while a different edition is free');
  assert.equal(reservation.forStudent(data,'s1')[0].editionKey,
    'isbn:9789048849178');
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b2',
    now:NOW+1}).created,false,
    'The same student cannot reserve a work twice by switching editions');
  assert.equal(data.bookReservations.length,1);
  assert.equal(reservation.reconcile(data,NOW+3000),false,
    'A different edition must not notify an edition-specific waiting student');
  data.books[0].status='available';data.books[0].borrowedBy=null;
  assert.equal(reservation.reconcile(data,NOW+4000),true);
  assert.equal(reservation.forStudent(data,'s1')[0].readyBookId,'b1');
}
{
  const data=db();
  data.books[0].catalogHidden=true;
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW}).status,404,
    'Hidden books are not public reservation targets');
  data.books[0].catalogHidden=false;
  const before=JSON.stringify(data.books);
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW}).ok,true);
  assert.equal(before,JSON.stringify(data.books),
    'Booking never updates any physical copy or loan');
}
{
  const data=db();
  reservation.create(data,{studentId:'s1',bookId:'b1',now:NOW});
  reservation.create(data,{studentId:'s2',bookId:'b1',now:NOW});
  // Invert lexical UUID order so this test fails deterministically with the old comparator.
  data.bookReservations[0].id='z-first';
  data.bookReservations[1].id='a-second';
  assert.equal(reservation.forStudent(data,'s1')[0].position,1);
  data.books[0].status='available';data.books[0].borrowedBy=null;
  reservation.reconcile(data,NOW+1);
  assert.equal(reservation.holdFor(data,'b1',NOW+1).studentId,'s1');
}
{
  const data=db();
  data.books=[book('b1',{editionIsbn:undefined,metadataIsbn:undefined,
    isbn13:'9789048849178',barcode:'SCAN-A',publisher:'Publisher'}),
    book('b2',{editionIsbn:undefined,metadataIsbn:undefined,
    isbn13:'9789026988646',barcode:'SCAN-B',publisher:'Publisher'})];
  assert.equal(reservation.create(data,{studentId:'s1',bookId:'b1',
    specificEdition:true,now:NOW}).reservation.editionKey,'isbn:9789048849178');
  data.books[1].status='available';data.books[1].borrowedBy=null;
  assert.equal(reservation.reconcile(data,NOW+1),false);
  assert.equal(reservation.forStudent(data,'s1')[0].status,'waiting');
  data.books[0].status='available';data.books[0].borrowedBy=null;
  assert.equal(reservation.reconcile(data,NOW+2),true);
  assert.equal(reservation.forStudent(data,'s1')[0].readyBookId,'b1');
}
{
  const data=db();
  let reads=0;
  const students=data.students;
  Object.defineProperty(data,'students',{get(){reads++;return students;}});
  assert.equal(reservation.reconcile(data,NOW),false);
  assert.equal(reads,0,'No active reservations must avoid loan-index traversal');
}
console.log('Reservation FIFO, holds, editions, cancellation and privacy OK');
