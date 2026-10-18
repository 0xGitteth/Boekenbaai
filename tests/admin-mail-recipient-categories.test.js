'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../book-import-admin-mail');
const actionMail = require('../book-import-action-mail');
const DAY = 86400000;
const now = Date.parse('2026-10-15T09:00:00Z');
const date = offset => new Date(now - offset * DAY).toISOString();

const db = {
  users: [{id:'teacher-a',role:'teacher'}],
  students: [{id:'student-a',classIds:['class-a'],active:true}],
  classes: [{id:'class-a',teacherIds:['teacher-a'],studentIds:['student-a']}],
  books: [{id:'book-a'}],
  studentTransferRequests: [
    {id:'t1',studentId:'student-a',status:'rejected',escalatedToAdmin:true,
      createdAt:date(2),updatedAt:date(1)},
  ],
  bookImportFollowupSettings: {reminderDays:7,escalationDays:14},
  bookImportFollowups: [
    {id:'book-1',bookId:'book-a',classId:'class-a',status:'admin_review',
      createdAt:date(1),updatedAt:date(1)},
  ],
  bookImportAdminMail: {
    revision: 2,
    categories: {transfers:false,google:true,books:true},
    recipients: [
      {email:'one@koraal.nl',verifiedAt:date(3)},
      {email:'two@koraal.nl',verifiedAt:date(3)},
      {email:'pending@koraal.nl',verifiedAt:'',pending:null},
    ],
  },
};
const links = {
  links: [],
  linkRequests: [{
    id:'g1', accountType:'staff',staffId:'teacher-a',
    status:'pending',createdAt:date(1),
  }],
};
const before = admin.adminSettings(db);
assert.deepEqual(before.recipients[0].categories,
  { transfers:false,google:true,books:true }, 'Legacy preferences must be inherited');
assert.deepEqual(before.recipients[1].categories, before.recipients[0].categories);
assert.equal(admin.publicSettings(db,true).recipients[0].categories.transfers,false);
assert.ok(!JSON.stringify(admin.publicSettings(db,true)).includes('verifiedAt'),
  'Do not expose verification timestamps or secrets');

assert.equal(admin.updateRecipientCategories(db,'one@koraal.nl',
  {transfers:true,google:false,books:false}),true);
assert.equal(db.bookImportAdminMail.revision,3);
assert.equal(admin.updateRecipientCategories(db,'two@koraal.nl',
  {transfers:false,google:false,books:true}),true);
const pref = admin.adminSettings(db);
assert.deepEqual(pref.recipients[0].categories,{transfers:true,google:false,books:false});
assert.deepEqual(pref.recipients[1].categories,{transfers:false,google:false,books:true});
assert.deepEqual(pref.recipients[2].categories,
  {transfers:false,google:true,books:true}, 'Unverified address retains old defaults');
for(const [address,candidate] of [
  ['absent@koraal.nl',{transfers:true,google:true,books:true}],
  ['pending@koraal.nl',{transfers:true,google:true,books:true}],
  ['one@koraal.nl',{transfers:'yes',google:true,books:true}],
  ['one@koraal.nl',{transfers:true,google:true}],
  ['one@koraal.nl',{transfers:true,google:true,books:true,extra:true}],
]){
  const revision=db.bookImportAdminMail.revision;
  assert.equal(admin.updateRecipientCategories(db,address,candidate),false);
  assert.equal(db.bookImportAdminMail.revision,revision,'Invalid edits must not write');
}
const list=actionMail.recipientGroups(db,links,now);
const one=list.find(x=>x.id==='admin:one@koraal.nl');
const two=list.find(x=>x.id==='admin:two@koraal.nl');
assert.deepEqual([...new Set(one.events.map(x=>x.category))],['transfers']);
assert.deepEqual([...new Set(two.events.map(x=>x.category))],['books']);
assert.equal(list.some(x=>x.id==='admin:pending@koraal.nl'),false);

// Reading older stored entries must never create surprise new opt-ins.
const legacy=structuredClone(db);
legacy.bookImportAdminMail.recipients[0].categories={transfers:false};
assert.deepEqual(admin.adminSettings(legacy).recipients[0].categories,
  {transfers:false,google:true,books:true});
const removed=structuredClone(db);
assert.equal(admin.removeAddress(removed,'one@koraal.nl'),true);
assert.equal(actionMail.recipientGroups(removed,links,now).some(x=>x.to==='one@koraal.nl'),false);
const frontend=fs.readFileSync(path.join(__dirname,'../public/admin-mail-notifications.js'),'utf8');
const markup=fs.readFileSync(path.join(__dirname,'../public/staff.html'),'utf8');
const styles=fs.readFileSync(path.join(__dirname,'../public/admin-modern.css'),'utf8');
assert.match(frontend,/action: 'update_recipient_categories', email: item\.email, categories/);
assert.doesNotMatch(frontend,/action: 'update_categories'/);
assert.match(markup,/id="admin-mail-categories"[^>]*hidden/);
assert.match(styles,/#admin-mail-categories\[hidden\]/);
console.log('Beheerdersmeldingen per adres: migratie, filtering, verificatie en UI-regressies geslaagd.');
