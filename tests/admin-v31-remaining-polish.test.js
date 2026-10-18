'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const admin = read('public/admin-modern.js');
const css = read('public/admin-modern.css');
const loans = read('public/staff-loans.js');
const html = read('public/staff.html');
const app = read('public/app.js');

new vm.Script(admin);
assert.match(admin, /function moveDangerousBookAction\(/);
assert.match(admin, /deleteAll\.classList\.add\('bb-admin-v31-delete-library'\)/);
assert.match(admin, /heading\.append\(actions\)/);
assert.match(admin, /if \(newBook\) actions\.append\(newBook\)/);
assert.doesNotMatch(admin, /id: 'bb-admin-v31-toggle-catalog'/);
assert.match(admin, /const newBook = make\('button'/);
assert.match(admin, /moveDangerousBookAction\(booksView\)/);
assert.match(app, /adminBooksDeleteAllButton\?\.addEventListener\('click', async/);
assert.match(app, /window\.confirm\('Weet je zeker dat je alle boeken/);
assert.match(css, /#admin-books-delete-all\.bb-admin-v31-delete-library/);
assert.match(css, /#admin-books-delete-all\.bb-admin-v31-delete-library:disabled/);

assert.match(admin, /className: 'bb-admin-v31-task-actions'/);
assert.match(admin, /className: 'btn btn--secondary', text: label/);
assert.doesNotMatch(admin, /className: 'bb-admin-v31-quick-row', text: label/);
assert.match(css, /\.bb-admin-v31-task-actions \.btn/);

assert.match(admin, /function organizeMailSettings\(/);
assert.match(admin, /panel\.dataset\.v31SettingsOrganized/);
assert.match(admin, /addresses\.append\(make\('h3', \{ text: 'Ontvangstadressen' \}\), delivery, recipientList\)/);
assert.match(admin, /preferences\.append\(make\('h3', \{ text: 'Beheerdersadres toevoegen' \}\), addForm, categories, status\)/);
assert.match(admin, /organizeMailSettings\(\)/);
for (const id of [
  'admin-mail-notifications-panel', 'admin-mail-notifications-list',
  'admin-mail-add-form', 'admin-mail-categories',
  'admin-mail-new-address', 'admin-mail-notifications-status',
  'admin-mail-category-transfers', 'admin-mail-category-google',
  'admin-mail-category-books'
]) assert.ok(html.includes('id="' + id + '"'), id + ' unchanged');
assert.match(css, /\.bb-admin-v31-settings-layout \{/);
assert.match(css, /\.bb-admin-v31-settings-section \{/);
assert.match(css, /#admin-mail-notifications-list > \.form-field/);

assert.match(css, /width: 132px;\s*height: 42px;/);
assert.match(css, /\.bb-admin-v31-column--activity \{[\s\S]*?height: 0;[\s\S]*?min-height: 100%;/);
assert.match(css, /\.bb-admin-v31-card--activity \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/);
assert.match(css, /#bb-admin-v31-activity #history-list \{[\s\S]*?overflow-y: auto;/);
assert.match(css, /max-height: 300px;/);
assert.match(admin, /historyList\?\.setAttribute\('tabindex', '0'\)/);
assert.match(admin, /historyList\?\.removeAttribute\('tabindex'\)/);
assert.match(css, /#history-list:focus-visible/);
assert.match(html, /id="history-clear-button"/);

// Exercise the real copied hint logic, not just a string search.
const begin = loans.indexOf('  function updateCopyHint(');
const end = loans.indexOf('  function showFilters()', begin);
assert.ok(begin > 0 && end > begin, 'Expected contextual hint helpers');
const helpers = loans.slice(begin, end);
const copyHint = { textContent: '', hidden: false };
const book = { value: '' };
const bookSearch = { value: '' };
const state = {
  books: [
    { id: 'a', title: 'Boek A', barcode: 'DUP', status: 'available' },
    { id: 'b', title: 'Boek B', barcode: 'DUP', status: 'available' },
    { id: 'c', title: 'Boek C', barcode: 'UNIQ', status: 'available' },
  ]
};
const ctx = vm.createContext({ copyHint, book, bookSearch, state });
new vm.Script(helpers + '\nthis.showCopyHint = showCopyHint;').runInContext(ctx);
ctx.showCopyHint();
assert.equal(copyHint.textContent, '', 'No global collision warning before searching');
assert.equal(copyHint.hidden, true);
book.value = 'c';
ctx.showCopyHint();
assert.equal(copyHint.textContent, '', 'Unique selected copy does not warn');
book.value = 'a';
ctx.showCopyHint();
assert.match(copyHint.textContent, /meerdere exemplaren/);
assert.equal(copyHint.hidden, false, 'Relevant collision remains visible');
book.value = '';
bookSearch.value = 'Boek';
ctx.showCopyHint();
assert.match(copyHint.textContent, /3 exemplaren gevonden/);
bookSearch.value = '';
ctx.showCopyHint();
assert.equal(copyHint.textContent, '');
assert.match(loans, /book\.addEventListener\('change', showCopyHint\)/);
assert.match(html, /id="staff-loan-copy-hint"[^>]*hidden/);
console.log('Beheer v3.1 overige-schermen- en scrollerregressies geslaagd.');
