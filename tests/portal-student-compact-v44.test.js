// Screenshot-driven UX regression: compact 2-row discovery vs prior large filter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');
const html = read('public/index.html');
const css = read('public/portal-student-compact-v44.css');
const app = read('public/app.js');
const staff = read('public/staff.html');
const sharedCss = read('public/portal-pr1-v43.css');

function uniqueId(id) {
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' must occur exactly once');
}
[
  'student-nav-library','student-nav-profile','student-collection','student-filter-toggle',
  'student-help-choose','student-scan-open','student-scan-panel','search-input',
  'summary','book-grid','bb-cat-advanced','bb-cat-filter-caption','bb-cat-reset',
  'bb-cat-easy','bb-cat-exam','theme-filter-pills','bb-cat-page-range',
  'bb-cat-availability','bb-cat-language','staff-book-sort-select'
].forEach(uniqueId);
const nav = html.slice(html.indexOf('<header class="bb-student-sitebar'),html.indexOf('</header>'));
assert.match(nav,/class="bb-student-nav bb-shared-primary-nav"/);
assert.ok(nav.indexOf('id="student-nav-library"')<nav.indexOf('id="student-nav-profile"'));
assert.doesNotMatch(nav,/id="student-sidebar"|id="student-menu-toggle"/);
assert.match(css,/header\.bb-student-sitebar \.bb-student-nav\.bb-shared-primary-nav \{\s*display:flex!important;\s*flex-direction:row!important;\s*flex-wrap:nowrap!important;/,
  'Override legacy student grid with a guaranteed horizontal desktop/mobile header nav');
assert.match(css,/header\.bb-student-sitebar \.bb-student-nav\.bb-shared-primary-nav \.bb-student-nav-button \{[\s\S]*?width:auto!important;/,
  'Override old full-width sidebar buttons without changing the real tabs');
assert.match(css,/\.bb-student-brand-text \{\s*position:relative;\s*top:3px!important;/);
assert.match(css,/\.bb-shared-school-logo \{[\s\S]*?width:132px!important;[\s\S]*?height:43px!important;/);
assert.match(staff,/class="bb-shared-school-logo" src="logo\/het-dok-header-v31\.svg"/);
assert.match(html,/class="bb-shared-school-logo" src="logo\/het-dok-header-v31\.svg"/);
assert.match(sharedCss,/height:64px!important/);

const discoveryStart=html.indexOf('<div class="bb-student-discovery-layout">');
const discoveryEnd=html.indexOf('</div>',discoveryStart);
assert.ok(discoveryStart>0&&discoveryEnd>discoveryStart);
const panel=html.indexOf('<section class="bb-catalog-filter-panel bb-student-compact-filters"',discoveryStart);
const scan=html.indexOf('id="student-scan-open"',discoveryStart);
const panelClose=html.indexOf('</section>',panel);
const scanPanel=html.indexOf('id="student-scan-panel"',discoveryStart);
const grid=html.indexOf('id="book-grid"',discoveryStart);
const results=html.indexOf('<div class="bb-cat-results">',panel);
const details=html.indexOf('<details class="bb-cat-advanced"',panel);
assert.ok(discoveryStart<panel&&panel<panelClose&&panelClose<scan,
  'Scan button is a sibling beside the compact discovery panel');
assert.ok(scan<scanPanel&&scanPanel<grid);
assert.ok(results>panel&&results<panelClose,
  'Result counter and both legend markers sit INSIDE the compact box');
assert.ok(details>results&&details<panelClose);
assert.ok(html.indexOf('id="bb-cat-filter-caption"',panel)<results);
const filters=html.slice(panel,panelClose);
assert.match(filters,/id="student-filter-toggle"/);
assert.match(filters,/id="student-help-choose"[^>]*disabled/);
assert.match(filters,/id="student-help-choose-note">Binnenkort/);
assert.match(filters,/class="bb-cat-legend"/);
assert.match(filters,/class="bb-cat-easy-key"/);
assert.match(filters,/class="bb-cat-exam-key"/);
assert.doesNotMatch(filters,/id="student-scan-open"/);
assert.match(html,/class="bb-student-sort-row"/);
assert.match(css, /#bb-cat-advanced\[open\] \+ \.bb-student-sort-row \{\s*display:flex!important;/,
  'Sort control still available when expanding the filters');
assert.match(css, /\.bb-student-discovery-layout \{\s*display:grid!important;\s*grid-template-columns:minmax\(0,1fr\) auto!important;/);
assert.match(css,/\.bb-student-discovery-layout > \.bb-student-compact-filters \{[\s\S]*?background:#fff!important;/);
assert.match(css, /@media\(max-width:1100px\)/);
assert.match(css, /@media\(max-width:760px\)/);
assert.match(css, /@media\(max-width:400px\)/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assert.ok(html.indexOf('portal-student-compact-v44.css')>html.indexOf('portal-pr1-v43.css'));
assert.equal((html.match(/href="portal-student-compact-v44\.css"/g)||[]).length,1);
assert.doesNotMatch(staff,/portal-student-compact-v44/,
  'Student-specific layout cannot change staff catalogue');
assert.match(app,/summary\.append\(document\.createTextNode\(' van ' \+ groupedBooks\.length \+ ' titels'\)\)/);
assert.match(app, /catalogAdvanced\.open = !catalogAdvanced\.open/);
assert.match(app, /studentLoanInProgress \|\| !action\.bookId \|\| authUser\?\.role !== 'student'/,
  'No changes to real student loan permissions');
console.log('Compact student toolbar + horizontal unified header structural regressions: OK.');
