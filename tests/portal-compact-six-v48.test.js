// v48: six full catalogue cards, real 2:3 covers, and compact teacher summaries.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const css=read('public/portal-compact-six-v48.css');
const student=read('public/index.html');
const staff=read('public/staff.html');
const dashboard=read('public/uiux-v32.js');
const teacher=read('public/teacher-modern.js');
const app=read('public/app.js');
for (const markup of [student,staff]) {
  const sheets=[...markup.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(sheets.at(-1),'portal-compact-six-v48.css',
    'Newest shared responsive override must load last');
  assert.equal(sheets.filter(x=>x==='portal-compact-six-v48.css').length,1);
}
assert.match(css,/body\[data-page="student"\] #student-collection \.bb-catalog-v36 #book-grid,/);
assert.match(css,/body\[data-page="staff"\] #staff-book-overview-content \.bb-catalog-v36 #book-grid \{\s*display:grid!important;\s*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important;/);
assert.match(css,/align-items:start!important;/);
assert.match(css,/grid-auto-rows:max-content;/);
assert.match(css,/#book-grid > \.book-card \{[\s\S]*?min-height:0!important;[\s\S]*?height:auto!important;/,
  'Real cards must not stretch to their former five-column minimum height');
assert.match(css,/#book-grid \.book-card__content \{[\s\S]*?flex:0 0 auto!important;[\s\S]*?height:auto!important;/,
  'Do not stretch content areas to compensate for smaller covers');
assert.match(css,/#book-grid \.book-card__cover-wrapper \{[\s\S]*?aspect-ratio:2 \/ 3!important;/);
assert.match(css,/#book-grid \.bb-cat-card-actions button \{[\s\S]*?min-height:38px!important;/,
  'All original actions remain usable on six-column cards');
assert.match(css,/@media \(max-width:1379px\) \{[\s\S]*?grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important;/);
assert.match(css,/@media \(max-width:1130px\) \{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important;/);
assert.match(css,/@media \(max-width:880px\) \{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important;/);
assert.match(css,/@media \(max-width:620px\) \{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;/);
assert.match(css,/@media \(max-width:620px\) \{[\s\S]*?min-height:44px!important;/,
  'Touch target size must be retained on phones');
assert.match(css,/#book-grid\.book-grid--empty \{\s*display:block!important;/,
  'Empty catalogue messages must not become six grid columns');
assert.match(app,/book-grid--empty/,
  'Catalogue still handles empty-result status');
assert.match(app,/book-card__status/,
  'Availability display remains in the real card');
assert.match(app,/bb-cat-card-actions/,
  'Borrowing, viewing, and editing actions remain in the real card');

assert.match(dashboard,/querySelectorAll\(':scope > \.book-card'\)\]\.slice\(0, 6\)/,
  'Dashboard lists six real books rather than five');
assert.match(css,/\.bb-v32-teacher-books \{\s*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important;/);
assert.match(css,/\.bb-v32-teacher-dashboard \.bb-v32-book-cover \{[\s\S]*?aspect-ratio:2 \/ 3!important;/);
assert.match(dashboard,/value === '0' \? 'Geen openstaande uitleningen\.'/,
  'No active loans must show clear empty text');
assert.match(dashboard,/value === '…' \|\| value === '—' \? 'Uitleningen laden…'/,
  'Unknown loading values cannot show zero loans');
assert.match(dashboard,/button\('Bekijk uitleningen'/,
  'Real loan navigation remains available');
assert.match(css,/\.bb-v32-teacher-lower \{\s*display:grid!important;\s*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important;/);
assert.match(css,/\.bb-v32-teacher-lower > \.bb-teacher-v31-card \{[\s\S]*?min-height:0!important;[\s\S]*?height:auto!important;/,
  'Remove old 195px minimum height from all three cards');
assert.match(css,/#history-list > \.history-item:only-child:not\(:has\(\.history-item__time\)\)/,
  'Empty activity uses the same blue bordered status treatment as tasks');
assert.match(css,/#bb-teacher-v31-tasks-summary \.bb-teacher-v31-task-state/,
  'Task states retain shared background and border');
assert.match(teacher,/Je hebt momenteel geen openstaande taken\./,
  'Previously approved zero-task message remains');
assert.match(css,/margin-bottom:25px!important;/,
  'Leave a visible bottom page gutter below the lower cards');
assert.match(css,/@media\(max-width:900px\)/);
assert.match(css,/@media\(max-width:650px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);

// Ensure a human-readable CSS rule set is balanced and available.
const stripped=css.replace(/\/\*[\s\S]*?\*\//g,'');
let level=0;
for (const ch of stripped) {
  if(ch==='{')level++;
  if(ch==='}')level--;
  assert.ok(level>=0,'No orphan closing brace');
}
assert.equal(level,0,'Every CSS rule is closed');
console.log('v48: six 2:3 books, responsive cards, six-dashboard previews, and aligned empty summaries OK.');
