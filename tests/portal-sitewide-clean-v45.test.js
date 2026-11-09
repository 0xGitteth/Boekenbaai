// PR #324: remove decorative introductions while keeping functional guidance.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const student=read('public/index.html');
const staff=read('public/staff.html');
const teacher=read('public/teacher-modern.js');
const admin=read('public/admin-modern.js');
const manager=read('public/student-management.js');
const dashboard=read('public/uiux-v32.js');
const css=read('public/portal-sitewide-clean-v45.css');
const studentApp=read('public/app.js');
const stylesheets=html=>[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);

assert.equal(stylesheets(student).at(-1),'portal-sitewide-clean-v45.css');
assert.equal(stylesheets(staff).at(-1),'portal-sitewide-clean-v45.css');
assert.ok(stylesheets(student).indexOf('portal-sitewide-clean-v45.css') >
          stylesheets(student).indexOf('portal-student-compact-v44.css'));
assert.ok(stylesheets(staff).indexOf('portal-sitewide-clean-v45.css') >
          stylesheets(staff).indexOf('portal-pr1-v43.css'));

for(const [id,name] of [
  ['student-library-title','Bibliotheek'],
  ['student-profile-title','Mijn profiel']
]) {
  assert.match(student,new RegExp('<h1 id="'+id+'" class="visually-hidden" tabindex="-1">'+name+'</h1>'),
    'Screen-reader page title and focus target must survive the visual cleanup');
  assert.equal((student.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
}
assert.doesNotMatch(student,/class="bb-student-page-heading"/,
  'The student navigation already names the page');
assert.doesNotMatch(student,/class="bb-student-login-art"/,
  'Remove the unclear book pile instead of presenting misleading art');
assert.match(student,/id="student-login-panel"/);
assert.match(student,/id="student-login-form"/);
assert.match(student,/id="student-login-name"/);
assert.match(student,/id="student-login-password"/);
assert.match(student,/id="student-login-suggestions"/);
assert.match(student,/id="student-login-preview"[^>]*aria-label="Functies na inloggen"/);
assert.doesNotMatch(student,/Wat kun je doen na het inloggen\?|Bekijk welke boeken je nu leent\./);
assert.match(student,/id="student-account-username"/);
assert.match(studentApp,/heading\?\.focus\(\{ preventScroll: true \}\)/,
  'Accessible focus remains at the hidden heading on page switches');
assert.match(studentApp,/studentLoginPreview\?\.classList\.toggle\('hidden', loggedIn\)/);
assert.match(studentApp,/studentLoanInProgress \|\| !action\.bookId \|\| authUser\?\.role !== 'student'/);

const deleted=[
 'Bekijk leerlingen, klaswissels en de klassen waarvoor je bevoegd bent.',
 'Snel leerlingen toevoegen, verplaatsen, afmelden en eerste Google-logins controleren.',
 'Tussentijdse instroom, klaswissels en uitstroom kun je hier direct regelen.',
 'Houd zicht op de voortgang van jouw leerlingen en beheer je klassen.',
 'Hier vind je jouw klassen, boeken en recente activiteit.',
 'De belangrijkste cijfers en taken op één vaste plek.',
 'Vind je boek direct, of verfijn de resultaten met filters.',
 'Zoek een boek uit de bibliotheek van de school.',
 'Bekijk wie een boek leent of lever een boek in via Uitlenen.'
];
const sources=student+'\n'+staff+'\n'+teacher+'\n'+admin+'\n'+manager+'\n'+dashboard;
for(const phrase of deleted)assert.ok(!sources.includes(phrase),
  'Repetitive visible sentence must be deleted from view generators: '+phrase);
assert.match(teacher,/heading\.append\(h\);/,
  'Teacher view headings still exist');
assert.match(admin,/heading\.innerHTML = '<div><h2 tabindex="-1">/);
assert.match(manager,/make\('h3', \{ text: 'Leerlingbeheer' \}\)/);
assert.match(manager,/make\('h4', \{/);
assert.match(staff,/Upload een Excelbestand \(\.xlsx\)/,
  'Required Excel column instructions must remain available');
assert.match(staff,/Deze instelling verandert je Google-inlogaccount niet\./,
  'Security-critical email-account clarification remains');
assert.match(staff,/Bestaande uitleningen en boeken op een vaste locatie blijven beschermd/,
  'Loan restrictions remain understandable');
assert.match(staff,/Voor jouw veiligheid moet je na de eerste aanmelding een eigen wachtwoord kiezen\./,
  'Mandatory password-change explanation must remain');

assert.match(css, /#student-collection \{\s*box-sizing:border-box;[\s\S]*?background:transparent!important;/);
assert.match(css, /#student-collection \.bb-student-discovery-layout \{\s*box-sizing:border-box;[\s\S]*?background:#fff!important;/);
assert.match(css, /#student-collection \.bb-catalog-v36 #book-grid \{\s*box-sizing:border-box;[\s\S]*?background:#fff;/);
assert.match(css, /\.bb-student-discovery-layout > \.bb-student-compact-filters \{[\s\S]*?border:0!important;/,
  'Do not nest two bordered cards for search');
assert.match(css, /\.bb-student-main \{\s*padding-top:12px!important;/,
  'Books must be reachable sooner after header');
assert.match(css, /#bb-cat-advanced \.bb-cat-advanced-content \{[\s\S]*?padding:0!important;[\s\S]*?border:0!important;/,
  'Expanded filters must not get an inherited empty top band');
assert.match(css, /#bb-cat-advanced \.bb-cat-themes \{[\s\S]*?padding:2px 2px 16px!important;[\s\S]*?border-bottom:1px solid #e1e9f3!important;/,
  'Theme heading and pills must not touch the dividing line');
assert.match(css, /#bb-cat-advanced \.bb-cat-other-filters \{[\s\S]*?padding:17px 2px 5px!important;[\s\S]*?border:0!important;/);
assert.match(css, /#student-login-panel\.bb-student-login-card \{[\s\S]*?max-width:670px!important;[\s\S]*?margin:0 auto!important;/,
  'Student login form centered and compact');
assert.match(css, /#student-login-panel \.bb-student-login-layout \{\s*display:block!important;/);
assert.match(css, /#student-login-preview\.bb-student-login-preview \{[\s\S]*?margin:17px auto 0!important;/,
  'Guest preview cards centered too');
assert.match(css, /body\.bb-admin-v31 \.bb-admin-v31-heading/);
assert.match(css, /body\.bb-teacher-v31 \.bb-teacher-v31-view-heading/);
assert.ok(!css.includes('body.bb-teacher-v31 .student-management__section > .hint'),
  'Keep informative no-class/no-students empty-state messages visible');
assert.match(manager, /Je hebt nog geen klas om leerlingen voor te beheren\./);
assert.match(manager, /Nog geen leerlingen in deze klas\./);
assert.match(css, /@media\(max-width:600px\)/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
for(const id of [
 'student-collection','student-filter-toggle','student-help-choose',
 'student-scan-open','student-scan-panel','search-input','bb-cat-advanced',
 'theme-filter-pills','staff-book-sort-select','summary','book-grid',
 'student-login-panel','student-login-form','student-login-suggestions'
])assert.equal((student.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' unique');

console.log('PR v45: no redundant intros; compact books-first student UI and operational guidance retained.');
