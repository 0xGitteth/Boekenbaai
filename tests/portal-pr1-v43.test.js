// PR1 visual consistency without changing any role's account/loan API.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const file=p=>fs.readFileSync(path.join(root,p),'utf8');
const student=file('public/index.html');
const staff=file('public/staff.html');
const css=file('public/portal-pr1-v43.css');
const app=file('public/app.js');
const studentCss=file('public/student-catalog-from-staff-v42.css');
const src=file('public/portal-unified-v41.css');

const idCount=(s,id)=>(s.match(new RegExp('id="'+id+'"','g'))||[]).length;
for(const id of [
  'student-nav-library','student-nav-profile','student-library-view','student-profile-view',
  'student-login-panel','student-login-form','student-login-name',
  'student-login-password','student-login-suggestions','student-login-preview',
  'student-filter-toggle','student-filter-label','student-help-choose',
  'bb-cat-advanced','bb-cat-reset','bb-cat-filter-caption','theme-filter-pills',
  'bb-cat-exam','bb-cat-easy','bb-cat-page-range','bb-cat-language',
  'bb-cat-availability','student-scan-open','student-scan-panel',
  'barcode-input','book-result','staff-book-sort-select','book-grid','summary'
])assert.equal(idCount(student,id),1,'Existing or added DOM ID must be unique: '+id);
for(const id of ['student-menu-toggle','student-sidebar','student-sidebar-scrim'])assert.equal(idCount(student,id),0);
const headerStart=student.indexOf('<header class="bb-student-sitebar');
const headerEnd=student.indexOf('</header>',headerStart);
const navPos=student.indexOf('<nav class="bb-student-nav');
assert.ok(navPos>headerStart&&navPos<headerEnd,'Student tabs must be physically inside the shared header');
assert.ok(student.indexOf('<main class="bb-student-main">')>headerEnd);
assert.match(student,/class="bb-shared-school-logo" src="logo\/het-dok-header-v31\.svg"/);
assert.match(staff,/class="bb-shared-school-logo" src="logo\/het-dok-header-v31\.svg"/);
assert.match(css,/height:64px!important/);
assert.match(css,/font:800 19px\/1 system-ui/);
for(const h of [student,staff]){
  assert.ok(h.includes('href="portal-pr1-v43.css"'), 'Shared new stylesheet must load in both portals');
  assert.equal(h.match(/href="portal-pr1-v43\.css"/g).length,1);
}
assert.ok(student.indexOf('href="portal-pr1-v43.css"')>student.indexOf('href="student-catalog-from-staff-v42.css"'));
assert.ok(staff.indexOf('href="portal-pr1-v43.css"')>staff.indexOf('href="portal-unified-v41.css"'));
assert.match(css,/body\.bb-admin-v31\.bb-v32-active #bb-admin-v31-sidebar \.admin-modern__tab/);
assert.match(css,/body\.bb-teacher-v31\.bb-v32-active #bb-teacher-v31-sidebar \.bb-teacher-v31-nav/);
assert.match(css,/body\[data-page="staff"\]:has\(#staff-login-panel:not\(\.hidden\)\)/);

const controlGroup=student.slice(student.indexOf('<section class="bb-catalog-filter-panel'),student.indexOf('</details>')+10);
assert.match(controlGroup,/id="student-filter-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="bb-cat-advanced"/);
assert.match(controlGroup,/id="student-help-choose"[^>]*disabled/);
assert.match(controlGroup,/id="student-help-choose-note">Binnenkort/);
assert.match(controlGroup,/id="student-scan-open"/);
assert.match(controlGroup,/id="bb-cat-reset"/);
assert.match(controlGroup,/id="bb-cat-advanced"/);
assert.match(controlGroup,/<summary class="bb-cat-advanced-toggle" hidden>/);
assert.match(css, /#bb-cat-advanced:not\(\[open\]\) \{display:none\}/);
assert.match(app, /studentFilterToggle\?\.addEventListener\('click', \(\) => \{/);
assert.match(app, /catalogAdvanced\.open = !catalogAdvanced\.open/);
assert.match(app, /studentFilterToggle\?\.setAttribute\('aria-expanded', String\(expanded\)\)/);
assert.match(app, /catalogReset\?\.addEventListener\('click'/);
assert.match(app, /studentLoginPreview\?\.classList\.toggle\('hidden', loggedIn\)/);
assert.doesNotMatch(app, /studentSidebar\.inert/);
assert.match(student, /id="student-login-preview"/);
assert.match(student, /id="student-profile-account"/);
assert.match(student, /id="student-activity-list"/);
assert.match(app, /googleAuth/);
assert.match(app, /role === 'student'/);

assert.match(css, /#book-grid \.book-card:hover \.book-card__cover-wrapper/);
assert.match(css, /box-shadow:0 12px 25px #142f5650!important/);
assert.match(css, /#book-grid > \.book-card--easy-reading:hover/);
assert.match(css, /#book-grid \.book-card--easy-reading \.book-card__cover-wrapper \{\s*outline:3px solid #19ad8e!important/);
assert.match(css, /#book-grid > \.book-card--easy-reading \{\s*border:2px solid #1aa887!important;\s*background:#fff!important/);
assert.doesNotMatch(css, /#book-grid > \.book-card--easy-reading \{\s*background:(?:#e|rgba\(1)/);
assert.match(css, /#book-grid \.book-card--exam-list \.book-card__cover-wrapper::after \{\s*width:27px!important;\s*height:42px!important/);
assert.match(css, /\.bb-cat-legend \.bb-cat-exam-key \{\s*width:17px!important;\s*height:24px!important/);
assert.match(css, /@media\(forced-colors:active\)/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assert.match(studentCss, /SOURCE portal-unified-v41\.css: final green border/);
assert.match(src, /Makkelijk Lezen/);
console.log('PR1: shared header, compact student controls, safe auth, double hover & larger exam bookmark OK.');
