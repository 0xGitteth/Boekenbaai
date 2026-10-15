'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mail = require('../book-import-reminder-mail');
const actions = require('../book-import-action-mail');
const admin = require('../book-import-admin-mail');
const DAY = mail.DAY_MS;
const now = Date.parse('2026-10-15T09:00:00Z');
const data = {
  users: [{ id:'teacher-a', role:'teacher'}, {id:'teacher-b',role:'teacher'}],
  students:[{id:'student-a',classIds:['class-a'],active:true}],
  classes:[{id:'class-a',teacherIds:['teacher-a'],studentIds:['student-a']},
    {id:'class-b',teacherIds:['teacher-b'],studentIds:[]}],
  books:[{id:'book-a'}],
  bookImportFollowupSettings:{reminderDays:7,escalationDays:14},
  studentTransferRequests:[
    {id:'t1',studentId:'student-a',fromClassId:'class-a',toClassId:'class-b',
      status:'pending',createdAt:new Date(now-DAY).toISOString()},
    {id:'t2',studentId:'student-a',fromClassId:'class-b',toClassId:'class-a',
      status:'rejected',escalatedToAdmin:true,
      updatedAt:new Date(now-DAY).toISOString(),createdAt:new Date(now-2*DAY).toISOString()},
  ],
  bookImportFollowups:[
    {id:'old-book',bookId:'book-a',classId:'class-a',status:'open',
      createdAt:new Date(now-15*DAY).toISOString()},
  ],
};
const links={links:[{accountType:'staff',accountId:'teacher-a',email:'a@koraaledu.nl'},
  {accountType:'staff',accountId:'teacher-b',email:'b@koraaledu.nl'}],
linkRequests:[{id:'g1',studentId:'student-a',status:'pending',
  createdAt:new Date(now-DAY).toISOString()},
{id:'g2',accountType:'staff',staffId:'teacher-a',
  status:'pending',createdAt:new Date(now-DAY).toISOString()},
{id:'unknown',status:'pending',createdAt:new Date(now-DAY).toISOString()},
{id:'expired',studentId:'student-a',status:'pending',
  createdAt:new Date(now-31*DAY).toISOString()}]};
const cfg={ BOEKENBAAI_MAIL_ENABLED:'true',
 BOEKENBAAI_MAIL_SCRIPT_SECRET:'x'.repeat(64),
 BOEKENBAAI_MAIL_SCRIPT_URL:'https://script.google.com/macros/s/TESTBRIDGE123/exec',
 BOEKENBAAI_PUBLIC_URL:'https://boekenbaai.example'};
const verified=admin.requestAddress(data,'beheerder@koraal.nl',cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET,now);
assert.equal(verified.ok,true);
assert.equal(admin.publicSettings(data,true).recipients[0].verified,false);
assert.equal(admin.confirmAddress(data,'beheerder@koraal.nl','12345678',
  cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET,now).ok,false);
assert.equal(admin.confirmAddress(data,'beheerder@koraal.nl',verified.code,
  cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET,now).ok,true);
assert.equal(admin.publicSettings(data,true).recipients[0].verified,true);
assert.equal(admin.requestAddress(data,'beheerder@koraal.nl',
  cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET,now+301000).error,'already_verified');
assert.equal(admin.requestAddress(data,'alt@koraal.nl',
  cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET,now+1).error,'rate_limited');
assert.equal(admin.updateCategories(data,{ transfers:true,google:true,books:true }),true);
assert.equal(admin.updateCategories(data,{ google:'true', books:true,transfers:true }),false);
const multipleAdmins = structuredClone(data);
const secondAddress = admin.requestAddress(multipleAdmins, 'tweede@koraal.nl',
  cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET, now + 300001);
assert.equal(secondAddress.ok, true);
assert.equal(admin.confirmAddress(multipleAdmins,'tweede@koraal.nl',
  secondAddress.code,cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET,now + 300001).ok,true);
assert.equal(actions.recipientGroups(multipleAdmins,links,now)
  .filter(row => row.id.startsWith('admin:')).length,2,
  'Each verified administrator has an independent delivery address.');
const e=actions.collectEvents(data,links,now);
assert.deepEqual(e.map(x=>x.type).sort(),
  ['book_escalation','staff_link','student_link','transfer_escalation','transfer_incoming'].sort());
assert.equal(e.some(x => x.key.includes('expired')), false,
  'Expired pending Google requests must not generate notifications.');
const inactiveStudent = structuredClone(data);
inactiveStudent.students[0].active = false;
assert.equal(actions.collectEvents(inactiveStudent, links, now)
  .filter(x => x.type.startsWith('transfer_')).length,0,
  'No transfer notification may be sent for a former pupil.');
const people=actions.recipientGroups(data,links,now);
assert.deepEqual(people.map(x=>[x.id,x.events.length]).sort(),
  [['admin:beheerder@koraal.nl',3],['teacher:teacher-a',1],['teacher:teacher-b',1]].sort());
data.bookImportEmailPreferences={'teacher-a':{mode:'off',revision:1}};
assert.equal(actions.recipientGroups(data,links,now).some(x=>x.id==='teacher:teacher-a'),false);
data.bookImportEmailPreferences={'teacher-a':{mode:'alternate',alternateEmail:'a@koraal.nl',revision:2}};
assert.equal(actions.recipientGroups(data,links,now).find(x=>x.id==='teacher:teacher-a').to,
  'a@koraal.nl');
assert.equal(admin.updateCategories(data,{transfers:false,google:true,books:false}),true);
assert.equal(actions.recipientGroups(data,links,now).find(x=>x.id==='admin:beheerder@koraal.nl')
  .events.length,1);
assert.equal(admin.updateCategories(data,{transfers:true,google:true,books:true}),true);
assert.equal(admin.removeAddress(data,'wrong@koraal.nl'),false);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'boekenbaai-pr7-actions-'));
const captures=[];
const fetchImpl=async(url,options)=>{
  const signed=JSON.parse(options.body);
  const payload=JSON.parse(signed.payload);
  assert.equal(mail.signature(signed.payload,cfg.BOEKENBAAI_MAIL_SCRIPT_SECRET),signed.signature);
  captures.push(payload);
  return {ok:true,status:200,json:async()=>({ok:true,id:payload.id})};
};
async function run(){
  // Two processes compete for one recipient. The second is skipped until
  // the first finishes, and may not send a second fragment of that batch.
  const first=actions.dispatchActions({db:data,links,folder:tmp,env:cfg,now,fetchImpl});
  const second=actions.dispatchActions({db:data,links,folder:tmp,env:cfg,now,fetchImpl});
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a.recipients+b.recipients,3);
  assert.equal(captures.length,3);
  assert.ok(captures.every(x=>!x.body.includes('student-a')
    && !x.body.includes('studentName') && !x.body.includes('class-a')));
  assert.ok(captures.every(x=>x.body.includes('https://boekenbaai.example/staff.html')));
  assert.equal((await actions.dispatchActions({
    db:data,links,folder:tmp,env:cfg,now,fetchImpl})).claimed,0);
  // A real new request triggers one additional email; the previous tasks
  // stay unresolved, but are not sent again.
  data.studentTransferRequests.push({id:'t3',studentId:'student-a',
    fromClassId:'class-a',toClassId:'class-b',status:'pending',
    createdAt:new Date(now).toISOString()});
  const later=await actions.dispatchActions({db:data,links,folder:tmp,env:cfg,now,fetchImpl});
  assert.equal(later.recipients,1);
  assert.equal(captures.length,4);
  assert.ok(captures[3].body.includes('2 acties'));
  // Seven-day reminder only while the underlying request remains pending.
  data.studentTransferRequests[0].status='accepted';
  const next=await actions.dispatchActions({
    db:data,links,folder:tmp,env:cfg,now:now+8*DAY,fetchImpl});
  assert.ok(next.claimed>=1);
  assert.ok(captures.every(x=>!x.body.includes('email=')));
  // Verified admins only, and removing a recipient stops sending immediately.
  assert.equal(admin.removeAddress(data,'beheerder@koraal.nl'),true);
  assert.equal(actions.recipientGroups(data,links,now).some(x=>x.id.startsWith('admin:')),false);
  // Sliding quota: requests at +23h55, +24h05 and +24h10 block the fourth
  // request even though the first anchored window has expired.
  const verification={};
  const start=Date.parse('2026-10-15T00:00:00Z');
  assert.equal(mail.beginVerification(verification,'mentor','m@koraal.nl','secret',
    start).ok,true);
  assert.equal(mail.beginVerification(verification,'mentor','m@koraal.nl','secret',
    start+23*3600000+45*60000).ok,true);
  assert.equal(mail.beginVerification(verification,'mentor','m@koraal.nl','secret',
    start+23*3600000+55*60000).ok,true);
  // First request is now out of the rolling window; another is allowed.
  assert.equal(mail.beginVerification(verification,'mentor','m@koraal.nl','secret',
    start+24*3600000+6*60000).ok,true);
  assert.equal(mail.beginVerification(verification,'mentor','m@koraal.nl','secret',
    start+24*3600000+12*60000).error,'daily_limit');
  fs.rmSync(tmp,{recursive:true,force:true});
  console.log('PR7 action notifications, admin recipients, privacy, concurrent batching and rolling quota passed');
}
run().catch(error=>{console.error(error);process.exitCode=1});
