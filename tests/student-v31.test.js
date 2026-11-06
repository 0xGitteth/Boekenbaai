// Boekenbaai v3.1 student navigation, privacy and loan action regressions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/student-v31.css');
const server = read('server.js');
const googlePolicy = read('public/google-login-hint.js');

const ids = [
  'student-nav-library','student-nav-profile',
  'student-library-view','student-profile-view','student-account-open',
  'student-collection','student-login-panel','student-login-form',
  'student-login-name','student-login-password','student-login-suggestions',
  'student-activity','student-dashboard','student-borrowed-list',
  'student-profile-account','student-account-name','student-account-username',
  'student-scan-open','student-scan-panel','student-scan-close',
  'barcode-input','lookup-button','book-result','book-grid',
  'student-book-detail-action','student-action-message',
];
for (const id of ids) {
  assert.equal((html.match(new RegExp('id="'+id+'"','g')) || []).length,1,
    id+' must occur once, preserving application DOM references');
}
assert.match(html,/href="student-v31.css"/);
assert.match(html,/<button[^>]+id="student-nav-library"[^>]+aria-current="page"/);
assert.match(html,/<button[^>]+id="student-nav-profile"/);
assert.equal((html.match(/class="bb-student-nav-button/g)||[]).length,2,
  'Exactly Bibliotheek and Mijn profiel in the student sidebar');
assert.equal((html.match(/id="student-scan-open"/g)||[]).length,1,
  'Exactly one student scan trigger, adjacent to search');
assert.ok(html.indexOf('id="student-scan-open"') > html.indexOf('id="search-input"'));
assert.ok(html.indexOf('id="student-scan-panel"') < html.indexOf('id="book-grid"'),
  'Scanner details should appear directly after filters, not at the bottom of a full catalogue');
assert.ok(html.indexOf('id="student-profile-view"') < html.indexOf('id="student-login-panel"'));
assert.ok(html.indexOf('id="student-profile-view"') < html.indexOf('id="student-activity"'));
assert.ok(html.indexOf('id="student-profile-view"') < html.indexOf('id="student-dashboard"'));
assert.match(html,/<section id="student-profile-view"[^>]+hidden>/,
  'Profile must default inaccessible to anonymous visitors');
assert.match(html,/<section[^>]+id="student-scan-panel"[^>]+hidden>/,
  'Scan area must default closed');
assert.match(html,/id="student-login-suggestions"/,
  'Existing validated student autocomplete is kept');
assert.match(html,/src="app.js"/,'The existing app module is still in use');
assert.doesNotMatch(html,/Voor later|Mijn leesreis|Leesrapport|Boeken die ik nog wil lezen/,
  'Future features must not appear as already implemented');

assert.match(css,/body\[data-page="student"\] \.bb-student-layout/);
assert.match(css,/grid-template-columns:230px minmax\(0,1fr\)/);
assert.match(css,/body\[data-page="student"\] #book-grid \{[\s\S]*?repeat\(4,minmax\(0,1fr\)\)!important/);
assert.match(css,/@media \(max-width:760px\)[\s\S]*?#book-grid \{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
assert.match(css,/aspect-ratio:2\/3/);
assert.match(css,/\[hidden\] \{display:none!important\}/);
assert.match(css,/\.book-card--easy-reading \.book-card__cover-wrapper/);
assert.match(css,/\.book-card--exam-list \.book-card__cover-wrapper::after/);
assert.match(css,/@media \(forced-colors:active\)/);
assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);

assert.match(app,/function showStudentPage\(page, \{ focus = false \} = \{\}\)/);
assert.match(app,/activitySection\?\.classList\.toggle\('hidden', !loggedIn\)/);
assert.match(app,/studentProfileAccount\?\.classList\.toggle\('hidden', !loggedIn\)/);
assert.match(app,/const endpoint = \x60\/api\/students\/\$\{authUser\.id\}\/loans\x60;/,
  'Student activity uses exclusively the authenticated student ID');
assert.match(app,/const loggedIn = authUser && authUser\.role === 'student' && Boolean\(authUser\.id\);/);
assert.match(app,/if \(!loggedIn\) \{[\s\S]*?activityRequestToken \+= 1;[\s\S]*?activityList\.replaceChildren\(\);[\s\S]*?return;/,
  'No public activity is requested inside the private profile');
assert.match(app,/cardOptions: book => \{/,
  'Student cards reuse the existing production catalogue rendering');
assert.match(app,/options\.studentActionLabel && typeof options\.onStudentAction === 'function'/);
assert.match(app,/bookDetailState\.studentActionHandler = handleCardLoanAction/);
assert.match(app,/function handleCardLoanAction\(book\)/);
assert.match(app,/if \(action\.type === 'login'\) \{/);
assert.match(app,/if \(studentLoanInProgress \|\| !action\.bookId \|\| authUser\?\.role !== 'student'\) return;/,
  'Only an authenticated student can initiate a loan from the new card');
assert.match(app,/const operation = action\.type === 'return' \? 'check-in' : 'check-out';/);
assert.match(app,/const barcode = barcodeInput\?\.value\.trim\(\);/,
  'Barcode scanning remains an actual server-backed lookup');
assert.match(server,/const barcodeMatch = requestUrl\.pathname\.match\(\/\^\\\/api\\\/books\\\/barcode/,
  'Read-only barcode endpoint is already available anonymously');
assert.match(server,/if \(!user\) return sendJson\(res, 401, \{ message: 'Log eerst in om boeken te lenen' \}\)/,
  'Server still requires an authenticated user for checkout');
assert.match(server,/if \(!user\) return sendJson\(res, 401, \{ message: 'Log eerst in om boeken terug te brengen' \}\)/,
  'Server still requires an authenticated user for check-in');
assert.match(googlePolicy,/nameInput\.dataset\.selectedAccountId/,
  'The existing safe Google account selection remains untouched');

const actionStart = app.indexOf('function resolveStudentBookAction(');
const actionEnd = app.indexOf('\nfunction initStudentPage()', actionStart);
assert.ok(actionStart>=0 && actionEnd>actionStart);
const context = {};
vm.createContext(context);
vm.runInContext(app.slice(actionStart,actionEnd)+'\nthis.resolveStudentBookAction=resolveStudentBookAction;',context);
const decide = (book,user) => context.resolveStudentBookAction(book,user);
const group = { id:'group', title:'Testtitel', copies:[
  {id:'copy1',status:'borrowed'},
  {id:'copy2',status:'available'},
  {id:'copy3',status:'borrowed'},
]};
assert.deepEqual(JSON.parse(JSON.stringify(decide(group,null))),{
  label:'Inloggen om te lenen',type:'login',bookId:null
});
assert.deepEqual(JSON.parse(JSON.stringify(decide(group,{
  role:'student',borrowedBooks:[{bookId:'copy3'}]
}))),{label:'Boek terugbrengen',type:'return',bookId:'copy3'},
  'Own borrowed copy takes priority over available copies');
assert.deepEqual(JSON.parse(JSON.stringify(decide(group,{
  role:'student',borrowedBooks:[]
}))),{label:'Boek lenen',type:'borrow',bookId:'copy2'});
assert.equal(decide({id:'x',copies:[{id:'copy1',status:'borrowed'}]},null),null);
assert.equal(decide({id:'x',copies:[{id:'copy1',status:'borrowed'}]},{
  role:'student',borrowedBooks:[]
}),null,'Never offer to borrow someone else’s copy');
assert.equal(decide(null,null),null);

console.log('Leerlingportaal v3.1: structuur, privacy, rollen, barcode en leenacties OK.');
