const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('public/portal-compact-six-v48.css');
const student = read('public/index.html');
const staff = read('public/staff.html');
const dashboard = read('public/uiux-v32.js');
const app = read('public/app.js');
for (const [html, page] of [[student, 'student'], [staff, 'staff']]) {
  assert.match(html, /<link rel="stylesheet" href="portal-compact-six-v48.css"/);
  assert.match(html, /<style id="bb-six-column-critical">/);
  assert.ok(html.includes('html body[data-page="' + page + '"]'));
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important;/);
}
assert.ok(css.includes('html body[data-page="student"] #student-collection .bb-catalog-v36 #book-grid'));
assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important;/);
assert.match(css, /@media \(max-width:959px\)/);
assert.doesNotMatch(css, /-webkit-line-clamp:2/);
const titleRule = css.match(/#book-grid \.book-card__title \{([\s\S]*?)\}/)?.[1];
assert.ok(titleRule, 'Shared title rule exists');
assert.match(titleRule, /min-height:0!important;/);
assert.match(titleRule, /max-height:none!important;/);
assert.match(titleRule, /height:auto!important;/);
assert.match(titleRule, /white-space:nowrap!important;/);
assert.match(titleRule, /text-overflow:ellipsis!important;/);
assert.match(titleRule, /overflow:hidden!important;/);
assert.match(titleRule, /flex:0 0 auto!important;/);
assert.doesNotMatch(titleRule, /min-height:34px/);
const statusRule = css.match(/#book-grid \.book-card__status \{([\s\S]*?)\}/)?.[1];
assert.match(statusRule, /margin:auto 0 0!important;/);

assert.match(css, /aspect-ratio:2 \/ 3!important;/);
assert.match(css, /align-items:stretch!important;/);
assert.match(css, /grid-auto-rows:auto;/);
assert.ok(css.includes('html body.bb-teacher-v31 .bb-v32-teacher-dashboard .bb-v32-teacher-books'));
assert.ok(dashboard.includes("grid.querySelectorAll(':scope > .book-card')].slice(0, 5)"));
assert.match(app, /book-grid--empty/);
assert.match(app, /bb-cat-card-actions/);
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
let level = 0;
for (const ch of stripped) {
  if (ch === '{') level++;
  if (ch === '}') level--;
  assert.ok(level >= 0);
}
assert.equal(level, 0);
console.log('Catalogue six columns, cascade specificity, 2:3 covers, five-book dashboard OK');
