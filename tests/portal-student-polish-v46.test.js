// Student v46: inline topic controls and correct staff-session isolation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('public/index.html');
const app=read('public/app.js');
const auth=read('public/google-auth.js');
const css=read('public/portal-student-polish-v46.css');
const shared=read('public/portal-sitewide-clean-v45.css');
const staff=read('public/staff.html');

const themeSource=app.slice(app.indexOf('function renderThemePills('),app.indexOf('\nfunction createThemeFilterRenderer(',app.indexOf('function renderThemePills(')));
assert.ok(themeSource.includes("if (pageType !== 'student') {"),'Only staff retains forced thematic line break');
assert.ok(themeSource.includes("breakRow.className = 'bb-cat-theme-linebreak'"),'The staff layout stays intact');
assert.ok(themeSource.includes("bb-cat-more--inline"),'Student more button shares the other pills row');
assert.doesNotMatch(themeSource,/Toon minder thema’s ⌃|overige thema’s[^\n]*⌄/,
 'No unnecessary up/down arrow characters in toggle label');
assert.match(themeSource,/more\?\.setAttribute\('aria-expanded',String\(isExpanded\)\)/,
 'Expanded state remains accessible');
assert.match(themeSource,/onToggleExpanded\?\.\(!isExpanded\)/,
 'Existing expansion handler remains connected');
assert.match(css,/#theme-filter-pills \.bb-cat-more--inline \{/);
assert.match(css,/#theme-filter-pills \.bb-cat-theme-linebreak \{\s*display:none!important;/);

const themeResetPos=html.indexOf('id="bb-cat-reset"');
const themeHeadingPos=html.indexOf('<h5>Thema’s');
assert.ok(themeResetPos>0&&themeResetPos<themeHeadingPos,'Reset remains in the expanded controls');
assert.match(css,/#bb-cat-advanced \.bb-student-filter-actions \{\s*position:absolute!important;/,
 'Reset is out of flow so it does not leave blank space above themes');
assert.match(css,/#bb-cat-advanced \.bb-cat-themes h5 \{[\s\S]*?padding:7px 118px 0 0!important;/,
 'The themes heading reserves horizontal space for reset');
assert.match(css,/#bb-cat-advanced \.bb-cat-themes h5 span \{\s*display:none!important;/,
 'Remove unwanted generic explanatory tagline');

// Prevent an authenticated teacher/admin from seeing school mail links on
// the student route. Assert the guard executes BEFORE the privileged fetch.
const renderStart=auth.indexOf('  async function renderManagePanel() {');
const renderEnd=auth.indexOf("\n  document.addEventListener('DOMContentLoaded'",renderStart);
assert.ok(renderStart>0&&renderEnd>renderStart);
const manage=auth.slice(renderStart,renderEnd);
assert.ok(manage.indexOf("document.body?.dataset.page !== 'staff'") <
          manage.indexOf("apiFetch('/api/auth/google/manage')"),
  'The staff-only page gate must precede the privileged API request');
assert.ok(manage.includes("document.querySelector('#teacher-dashboard')"),
  'Google manager only mounts in the actual staff dashboard');
assert.ok(!manage.includes("document.querySelector('main')"),
  'Do not fall back to the public student page');
let called=0;
vm.runInNewContext(manage+"\nthis.invoke=renderManagePanel;",
  {document:{body:{dataset:{page:'student'}},querySelector(){throw Error('Unexpected DOM lookup');}},
   apiFetch(){called++;throw Error('Unexpected privileged API call');}},
  {timeout:3000});
const invokeCtx={document:{body:{dataset:{page:'student'}},querySelector(){throw Error('Unexpected DOM lookup');}},
  apiFetch(){called++;throw Error('Unexpected privileged API call');}};
vm.createContext(invokeCtx);
vm.runInContext(manage+"\nthis.invoke=renderManagePanel;",invokeCtx,{timeout:3000});
invokeCtx.invoke();
assert.equal(called,0,'Public student page must not attempt to fetch privileged staff Google links');

for(const id of ['student-staff-session','student-staff-session-title','student-login-panel','student-login-form',
 'student-login-suggestions','student-login-preview','student-profile-view']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' must be unique');
}
assert.match(html,/<section id="student-staff-session" class="bb-student-staff-session hidden"/);
assert.match(html,/<a class="btn bb-student-staff-session-link" href="staff.html">Naar docentenportaal<\/a>/);
assert.match(app,/const staffSession = authUser && \(authUser\.role === 'teacher' \|\| authUser\.role === 'admin'\);/);
assert.match(app,/loginPanel\?\.classList\.toggle\('hidden', loggedIn \|\| staffSession\)/);
assert.match(app,/studentLoginPreview\?\.classList\.toggle\('hidden', loggedIn \|\| staffSession\)/);
assert.match(app,/studentStaffSession\?\.classList\.toggle\('hidden', !staffSession\)/);
assert.match(app,/staffSession \? 'Medewerker' : 'Gast \/ tablet'/);
assert.match(css,/#student-profile-view \.bb-student-staff-session \{[\s\S]*?align-items:center!important;/);
assert.match(css,/#student-profile-view \.bb-student-staff-session\.hidden \{\s*display:none!important;/);
assert.match(shared,/#student-login-panel\.bb-student-login-card/);
assert.match(css,/body\[data-page="student"\] \.google-manage \{\s*display:none!important;/);
assert.ok(!staff.includes('portal-student-polish-v46.css'),
 'New polish cannot change staff layout');
assert.ok(html.indexOf('portal-student-polish-v46.css')>html.indexOf('portal-sitewide-clean-v45.css'));
console.log('Student themes, staff-only Google management, and centered session notice: OK.');
