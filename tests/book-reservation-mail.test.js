'use strict';
const assert=require('node:assert/strict');
const mail=require('../book-reservation-mail');
const {workKey}=require('../book-reservations');
const student={id:'s1',name:'Leerling A',classIds:['c1'],active:true};
const db={
  students:[student],
  users:[{id:'t1',role:'teacher',active:true}],
  classes:[{id:'c1',studentIds:['s1'],teacherIds:['t1']}],
  bookReservations:[{
    id:'ready-1',studentId:'s1',workKey:workKey({title:'Spijt!',author:'Carry Slee'}),
    title:'Spijt!',author:'Carry Slee',status:'ready',
    readyBookId:'book-1',readyAt:'2026-11-20T15:00:00Z',
  }],
};
const links={links:[
  {accountType:'student',accountId:'s1',email:'pupil@koraaledu.nl',sub:'sub-1'},
  {accountType:'staff',accountId:'t1',email:'mentor@koraaledu.nl',sub:'sub-2'},
]};
const recipients=mail.recipientMessages(db,links);
assert.equal(recipients.length,2);
assert.deepEqual(recipients.map(x=>x.to).sort(),
  ['mentor@koraaledu.nl','pupil@koraaledu.nl']);
assert.ok(recipients.every(x=>x.subject.includes('Boekenbaai')));
assert.ok(recipients.every(x=>!x.body.includes('borrowedBy')));
assert.equal(recipients.find(x=>x.to==='mentor@koraaledu.nl')
  .body.includes('Leerling A'),true);
assert.equal(recipients.find(x=>x.to==='pupil@koraaledu.nl')
  .body.includes('Spijt!'),true);
const disabled={...db,bookImportEmailPreferences:{t1:{mode:'off'}}};
assert.deepEqual(mail.recipientMessages(disabled,links).map(x=>x.to),
  ['pupil@koraaledu.nl'],'Teacher email opt-out must be respected');
assert.deepEqual(mail.recipientMessages(db,{links:[links.links[1]]}).map(x=>x.to),
  ['mentor@koraaledu.nl'],'Unlinked student address must never be guessed');
assert.deepEqual(mail.recipientMessages(db,{links:[
  {...links.links[0],sub:''},links.links[1],
]}).map(x=>x.to),['mentor@koraaledu.nl'],
  'An unverified prelinked school email must not receive pupil reservation details');
assert.deepEqual(mail.recipientMessages(db,{links:[
  {...links.links[0],email:'unknown@otherdomain.nl'},links.links[1],
]}).map(x=>x.to),['mentor@koraaledu.nl'],
  'Students with a non-school email must not be contacted through the bridge');
assert.deepEqual(mail.recipientMessages(db,{links:[
  links.links[0],{...links.links[1],sub:''},
]}).map(x=>x.to),['pupil@koraaledu.nl'],
  'An unverified mentor school address must not receive pupil reservation details');
db.classes[0].studentIds=[];
db.students[0].classIds=[];
assert.deepEqual(mail.recipientMessages(db,links).map(x=>x.to),
  ['pupil@koraaledu.nl'],'Former mentors lose notification access');
db.bookReservations[0].status='fulfilled';
assert.deepEqual(mail.recipientMessages(db,links),[],
  'Mail worker must never resend a completed reservation');
console.log('Reservation pupil and mentor email recipients and privacy OK');
