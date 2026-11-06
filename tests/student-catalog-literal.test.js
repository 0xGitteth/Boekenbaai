// The student catalogue is the staff catalogue's literal markup, with only
// the pre-existing student scanner and authenticated loan controls added.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
const student = read('public/index.html');
const staff = read('public/staff.html');
const app = read('public/app.js');

function catalogue(html) {
  const from = html.indexOf('<div class="bb-catalog-v36" aria-label="Boekenoverzicht">');
  assert.ok(from>=0, 'Staff or student catalogue wrapper missing');
  const tags=/<\/?div\b[^>]*>/gi;
  tags.lastIndex=from;
  let depth=0, end=-1, match;
  while((match=tags.exec(html))) {
    depth+=match[0].startsWith('</')?-1:1;
    if(depth===0) {end=tags.lastIndex;break;}
  }
  assert.ok(end>from, 'Catalogue wrapper is balanced');
  return html.slice(from,end);
}
const staffMarkup=catalogue(staff);
const studentMarkup=catalogue(student)
  .replace(/\s*<button type="button" id="student-scan-open"[^>]*>[^<]*<\/button>/,'')
  .replace(/\s*<section class="bb-student-scan-panel"[\s\S]*?<\/section>/,'');
const norm=s=>s.replace(/\s+/g,' ').trim();
assert.equal(norm(studentMarkup),norm(staffMarkup),
  'Student filters, structure, results and legend must be literal copies of staff.html');

for(const id of [
  'bb-cat-reset','bb-cat-advanced','bb-cat-filter-caption','bb-cat-page-range',
  'bb-cat-page-output','bb-cat-unknown','bb-cat-language','bb-cat-availability',
  'bb-cat-easy','bb-cat-exam','staff-book-sort-select','theme-filter-pills',
  'student-scan-open','student-scan-panel','summary','book-grid',
]) {
  assert.equal((student.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
    'One live functional control required: '+id);
}
assert.match(student,/class="bb-cat-legend"/);
assert.match(student,/bb-cat-easy-key/);
assert.match(student,/bb-cat-exam-key/);
assert.match(student,/href="student-catalog-from-staff-v42\.css"/);
assert.match(app, /catalogMode: true/);
assert.match(app, /const filtered = filterBooks\(groupedBooks/);
assert.match(app, /includeUnknownPages: limited && Boolean\(catalogUnknown\?\.checked\)/);
assert.match(app, /catalogReset\?\.addEventListener\('click'/);
assert.match(app, /catalogEasy\?\.addEventListener\('change'/);
assert.match(app, /catalogExam\?\.addEventListener\('change'/);
assert.match(app, /summary\.append\(document\.createTextNode\(' van ' \+ groupedBooks\.length/);
assert.match(app, /studentActionLabel: action\?\.label \|\| ''/,
  'Teacher/admin action handlers must not replace the student loan action');
assert.match(app, /studentLoanInProgress \|\| !action\.bookId \|\| authUser\?\.role !== 'student'/,
  'Only logged-in students can initiate checkout');
execFileSync(process.execPath,[path.join(root,'scripts','sync-student-catalog-css.cjs'),'--check'],
  {cwd:root,stdio:'pipe'});
console.log('Student library: literal staff HTML, identical CSS sources, safe student actions OK.');
