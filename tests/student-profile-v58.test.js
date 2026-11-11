'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const html=read('public/index.html'),js=read('public/student-reading-profile.js');
const exam=read('public/personal-exam-reading-list.js');
const css=read('public/student-profile-v58.css');
const api=read('server.js'),vite=read('vite.config.js');
for(const id of [
  'student-recent-books','student-history-open','student-reading-history-dialog',
  'student-history-tab','student-statistics-tab','student-history-panel',
  'student-statistics-panel','student-history-more','student-reading-edit-dialog',
  'student-reading-edit-form','student-reading-edit-status','student-exam-add-trigger',
  'student-exam-add-dialog','student-exam-add-form','student-exam-add-title',
  'student-exam-add-author','student-exam-add-isbn','student-exam-add-pages',
  'student-exam-add-genre','student-exam-reading-section','student-pin-details'
]) assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' must be unique');
assert.doesNotMatch(html,/Mijn leesregistraties|<h3 id="student-profile-account-title">Mijn account<\/h3>/);
assert.match(html,/Laatst geleende boeken/);
assert.match(html,/Volledige leengeschiedenis/);
assert.match(html,/id="student-exam-reading-section"[^>]+hidden/);
assert.match(html,/id="student-pin-details"/);
assert.match(html,/href="student-profile-v58\.css"/);
assert.match(html,/src="student-reading-profile\.js"/);
assert.match(vite,/'student-reading-profile\.js'/);
assert.match(vite,/'student-profile-v58\.css'/);
assert.match(css,/#student-pin-details:not\(\[open\]\)/);
assert.match(css,/#student-exam-reading-section:not\(\[hidden\]\)/);
assert.match(js,/\/api\/me\/reading-profile/);
assert.match(js,/\/api\/reading-records\//);
assert.match(js,/boekenbaai:reading-record-updated/);
assert.match(js,/error\.status === 409/);
assert.match(read('public/student-detail.js'),/klass\.examReadingLevel === 'mixed'/);
assert.match(api,/requestUrl\.pathname === '\/api\/me\/reading-profile'/);
assert.match(api,/buildStudentReadingProfile\(getDb\(\), user\.id/);
assert.match(exam,/externalBook/);
assert.match(exam,/boekenbaai:exam-reading-list-updated/);
assert.match(js,/boekenbaai:exam-reading-list-updated/);
assert.match(js,/hasStatistics/);
assert.match(html,/id="student-recent-books"[^>]*><p class="hint bb-student-profile-empty">/);
assert.match(js,/make\('p', 'hint bb-student-profile-empty', 'Je hebt nog geen boeken geleend\.'\)/);
assert.match(js,/recentRoot\.replaceChildren\(make\('p', 'hint bb-student-profile-empty', error\.message\)\)/);
// Empty states for current loans, activity and recent books use one shared
// rule with the same exact values as the teacher dashboard's compact cards.
assert.match(css,/#student-borrowed-empty:not\(\.hidden\)/);
assert.match(css,/#student-activity-empty:not\(\.hidden\)/);
assert.match(css,/#student-recent-books > \.bb-student-profile-empty/);
for (const declaration of ['min-height:45px', 'padding:10px 13px', 'border:1px solid #dbe4ef',
  'border-radius:10px', 'background:#f5f8fc', 'color:#365776', 'font-size:13px', 'line-height:1.4']) {
  assert.ok(css.includes(declaration), 'Shared empty-state property missing: ' + declaration);
}
assert.match(js,/showTab\(hasHistory \? 'history' : 'stats'\)/);
assert.match(exam,/section\.hidden = entries\.length === 0/);
console.log('Student profile v58 wiring and privacy: OK');
