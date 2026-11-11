// The authenticated student profile uses teacher-style cards without changing auth or loan wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('public/index.html');
const css = read('public/student-profile-v57.css');
const app = read('public/app.js');
const pin = read('public/student-pin.js');
const requiredIds = [
  'student-profile-view','student-login-panel','student-staff-session',
  'student-dashboard','student-name','student-grade','student-logout',
  'student-borrowed-empty','student-borrowed-list','student-activity','student-activity-list',
  'student-activity-empty','student-profile-account','student-account-name',
  'student-account-username','student-reading-records','student-exam-reading-summary',
  'student-exam-reading-list','student-exam-reading-feedback','student-pin-details',
  'student-pin-form','student-pin-new','student-pin-repeat','student-pin-save','student-pin-reset'
];
for (const id of requiredIds) assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'One live element required: '+id);
assert.match(html,/<section id="student-profile-view"[^>]+hidden>/);
assert.match(html,/<section class="panel panel--student hidden bb-student-profile-card[^"]*" id="student-dashboard"/);
assert.match(html,/class="panel hidden bb-student-profile-details" id="student-profile-account"/);
assert.match(html,/class="bb-student-profile-welcome"/);
assert.match(html,/class="bb-student-profile-card reading-records exam-reading/);
assert.match(html,/<details id="student-pin-details"/);
assert.match(html,/href="student-profile-v57\.css"/);
assert.ok(html.indexOf('href="student-profile-v57.css"') < html.indexOf('href="portal-compact-six-v48.css"'),
  'Keep the existing compact stylesheet as the last linked stylesheet');
assert.match(css,/#student-profile-view:has\(> #student-dashboard:not\(\.hidden\)\)/);
assert.match(css,/#student-profile-account\.hidden \{ display:none!important; \}/);
assert.match(css,/@media \(max-width:850px\)/);
assert.match(css,/@media \(max-width:520px\)/);
assert.match(app,/dashboard\?\.classList\.toggle\('hidden', !loggedIn\)/);
assert.match(app,/activitySection\?\.classList\.toggle\('hidden', !loggedIn\)/);
assert.match(app,/studentProfileAccount\?\.classList\.toggle\('hidden', !loggedIn\)/);
assert.match(pin,/details\.addEventListener\('toggle'/);
console.log('Student profile layout: auth hooks, lists, exam and PIN preserved.');
