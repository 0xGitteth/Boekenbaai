// Approved staff catalogue integration regression checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = name => fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const html = file('staff.html');
const app = file('app.js');
const css = file('catalog-v36.css');

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
