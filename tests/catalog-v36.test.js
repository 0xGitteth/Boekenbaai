// Approved staff catalogue integration regression checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = name => fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const html = file('staff.html');
const app = file('app.js');
const css = file('catalog-v36.css');
const teacherCss = file('uiux-v32.css');
const dashboardJs = file('uiux-v32.js');
assert.match(css,/bb-cat-search-field input#search-input[^}]*border:0!important/,
  'The search control must never show both outer and inner borders');
assert.match(css,/\.bb-cat-cover-placeholder\s*\{/,
  'Book cards without real covers need a designed metadata fallback');
assert.match(css,/\.bb-cat-cover-placeholder\[hidden\]/,
  'The fallback must remain hidden while the real cover is loading or present');
assert.match(app,/Geen originele omslag/,
  'The cover fallback must be explicit that it is not the original cover');
assert.match(app,/placeholderPalette = \[/,
  'The palette should reproduce the approved visual prototype');
assert.match(css,/\.bb-cat-cover-placeholder::before/,
  'Fallback retains the approved cover curves');
assert.match(css,/\.bb-cat-cover-placeholder__symbol/,
  'Fallback uses a central decorative motif');
assert.match(css,/linear-gradient\(165deg,var\(--bb-cover-top/,
  'Full-colour placeholder preserves the approved cover visual density');
assert.match(app,/coverFallback\.replaceChildren\(\)/,
  'The catalog fallback must use genuine title and author metadata');
assert.match(teacherCss,/bb-v32-book-cover img\[hidden\][^{]*\{[^}]*display:none!important/,
  'Broken teacher preview image must never mask the fallback');
assert.match(teacherCss,/bb-v32-dashboard\[data-teacher-view="start"\] \.bb-teacher-v31-view-heading[^}]*display:grid/,
  'Teacher welcome should align to the left, not flex to the middle');
assert.match(dashboardJs,/const appendFallback = \(\) =>/,
  'Teacher home requires the same explicit missing-artwork treatment');


for (const id of [
  'search-input','staff-book-sort-select','theme-filter-pills',
  'bb-cat-advanced','bb-cat-page-range','bb-cat-unknown',
  'bb-cat-language','bb-cat-availability','bb-cat-easy','bb-cat-exam',
  'bb-cat-reset','summary','book-grid',
]) {
  assert.equal((html.match(new RegExp('id="'+id+'"','g')) || []).length,1,
    id+' must exist exactly once after replacing the legacy catalog controls');
}
assert.match(html,/catalog-v36\.css/);
assert.match(html,/<details class="bb-cat-advanced" id="bb-cat-advanced">/,
  'Extended filters must default closed');
assert.match(html,/class="bb-cat-legend"/,'Cover legend must be visible on mobile');
assert.match(html,/id="bb-cat-page-range"[^>]+max="650"/);
assert.match(app,/catalogMode:true/,'Dedicated staff theme UI must not replace student controls');
assert.match(app,/const CATALOG_THEME_PALETTE/);
assert.match(app,/resolveCatalogThemeColors\(theme\.label\)/);
assert.match(app,/options\.catalogLayout\s*\? resolveCatalogThemeColors\(tag\)/,
  'Book tags and theme filters must share the exact approved theme palette');
assert.match(css,/\.book-card--easy-reading \.book-card__cover-wrapper/,
  'Makkelijk Lezen outline belongs to the cover, not the whole card');
assert.match(css,/\.book-card__cover-wrapper\{[^}]*overflow:hidden/,
  'Zoomed or translated cover crops must be clipped by their cover wrapper');
assert.match(css,/\.book-card--exam-list \.book-card__cover-wrapper::after/,
  'Exam list ribbon belongs on the cover');
assert.match(app,/chosenBook\.representativeBook \|\| chosenBook\.copies\?\.\[0\]/,
  'Admin edits must use a real copy, not a synthesized grouping key');

// The original styles set height:100% on card media and min-height:100% on
// card content. Both must be neutralized when stacked below the cover.
assert.match(css,/\.book-card__media\{[^}]*height:auto/);
assert.match(css,/\.book-card__content\{[^}]*min-height:0/);
assert.match(css,/\.book-card\{[^}]*max-width:none/);
assert.match(app,/contentThemes\.slice\(0, 2\)/,
  'Only two content theme pills should appear on each approved card');
assert.match(app,/const filtered = filterBooks\(groupedBooks/,
  'Staff catalogue must filter the actual grouped collection');

// Design acceptance contract based on the *last approved HTML*, not a new
// interpretation of the design. Geometry is measured at browser widths
// 1717/1440/1200/980/760/390 in the original interactive preview.
const approvedCssMarker = 'Approved-catalogue parity: measured directly';
assert.ok(css.includes(approvedCssMarker));
assert.match(css,/\.bb-catalog-v36 #book-grid\s*\{[^}]*repeat\(5,minmax\(0,1fr\)\)/,
  'At 1440 and 1717, the approved catalogue shows five books in a row');
for (const [maxWidth,count] of [[1260,4],[980,3],[760,2]]) {
  assert.ok(css.includes('@media (max-width:'+maxWidth+'px)') &&
    css.includes('repeat('+count+',minmax(0,1fr))'),
    maxWidth+' breakpoint preserves approved catalogue column count');
}
assert.match(css,/min-width:0;max-width:none;min-height:545px/,
  'Cards use the approved desktop height, not stretched four-column tiles');
assert.match(css,/width:min\(100%,215px\)/,
  'Smaller catalogue breakpoints retain their existing cover width');
const lastWideRules = css.slice(css.indexOf('User visual acceptance (20 October)'));
assert.match(lastWideRules,/@media \(min-width:1261px\)[\s\S]*?repeat\(5,minmax\(0,1fr\)\)!important/,
  'Desktop must show no more than five book cards at a time');
assert.match(lastWideRules,/\.book-card__cover-wrapper\s*\{[^}]*width:min\(100%,245px\);[^}]*max-width:245px/,
  'Five-column layout must actually enlarge covers instead of adding blank card margins');
assert.match(lastWideRules,/@media \(min-width:1740px\)[\s\S]*?repeat\(5,minmax\(0,1fr\)\)!important/,
  'Wide monitor CSS must override the historical six-column rule');
assert.doesNotMatch(lastWideRules,/repeat\(6,minmax\(0,1fr\)\)/,
  'No wide-screen six-column rule is allowed after the user accepted five larger cards');
assert.match(css,/\.bb-catalog-filter-panel\s*\{[^}]*padding:22px/,
  'Desktop filter padding comes from approved 22px measurement');
assert.match(css,/\.bb-cat-advanced-toggle\s*\{[^}]*min-height:48px/,
  'Closed filter switch must match the compact approved control');
for (const label of ['bb-cat-panel-icon','bb-cat-toggle-icon','bb-cat-chevron']) {
  assert.match(html,new RegExp('class="'+label+'"[^>]*>\\s*<svg'),
    label+' uses the actual approved SVG icon instead of arbitrary glyphs');
}
assert.match(css,/#book-grid[^}]*repeat\(2,minmax\(0,1fr\)\)/,
  'Mobile keeps two columns as in the approved HTML');
assert.match(css,/\.book-card__cover-wrapper\s*\{[^}]*width:100%;max-width:none/,
  'Narrow covers fill their true available frame with a correct 2:3 ratio');

// Cover visual parity: the approved demo alternates artwork palettes/motifs
// across adjacent cards. Stable book metadata and original images are unchanged.
assert.match(app,/const placeholderSymbols = \['✦','♛','☺','✺','♥','✿','☾','❄'\]/,
  'Use the visual motif order from the approved library prototype');
assert.match(app,/catalogVisualIndex % placeholderPalette\.length/,
  'Illustrated placeholders should not repeat the same palette side by side');
assert.match(app,/sorted\.entries\(\)/,
  'The real sorted/filter result order determines decorative placeholder rhythm');
assert.match(app,/catalogOptions \|\| \{\}/,
  'The catalogue card constructor receives the decorative visual index');
assert.match(css,/bb-cat-cover-placeholder__label[^}]*background:transparent/,
  'Keep a readable disclosure but no solid dark badge across the cover');
assert.match(css,/bb-catalog-v36 \.book-card__title[^}]*font-weight:810/,
  'Text weight follows the approved demo rather than legacy headline styles');

// Exercise the actual shared filtering source rather than reimplementing it.
const start = app.indexOf('function resolveBookLanguages(');
const end = app.indexOf('\nfunction sortBooks(',start);
assert.ok(start > -1 && end > start,'Filtering source functions available');
const context = {normalizeThemeKey:value=>String(value).toLowerCase().trim()};
vm.createContext(context);
vm.runInContext(app.slice(start,end)+
  '\nthis.__filterBooks=filterBooks;this.__palette=resolveBookPageCount;',context);
const filter = (books,conditions)=>context.__filterBooks(books,conditions);
const books = [
 {title:'First',themes:['Fantasy'],copies:[
   {status:'available',language:'Nederlands',pages:160},
   {status:'borrowed',language:'Nederlands',pages:360}]},
 {title:'Unknown',themes:['Humor'],copies:[
   {status:'borrowed',language:'Nederlands',pages:null}]},
 {title:'Long',themes:['Fantasy'],copies:[
   {status:'available',language:'Engels',pages:710}]},
];
const titles = list => Array.from(list,item=>item.title);
assert.deepEqual(titles(filter(books,{pageLimit:200})),['First']);
assert.deepEqual(titles(filter(books,{pageLimit:200,includeUnknownPages:true})),
  ['First','Unknown']);
assert.deepEqual(titles(filter(books,{availability:'borrowed'})),['First','Unknown']);
assert.deepEqual(titles(filter(books,{availability:'available'})),['First','Long']);
assert.deepEqual(titles(filter(books,{language:'Engels'})),['Long']);
assert.deepEqual(titles(filter(books,{onlyEasyReading:true})),[]);
assert.deepEqual(titles(filter(books,{selectedThemes:new Set(['fantasy'])})),
  ['First','Long']);
console.log('Catalogus v3.6: responsive markup, gedeelde kleuren en filters OK.');
