'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('public/staff.html');
const admin = read('public/admin-assignment-tasks.js');
const followups = read('public/book-import-followups.js');
const server = read('server.js');

assert.match(html, /id="book-import-assignment-tasks"/);
assert.match(html, /src="admin-assignment-tasks.js"/);
assert.match(server, /\/api\/admin\/book-import-assignment-tasks/);
assert.match(admin, /book-import-assignment-tasks/);
assert.match(admin, /'apply'/);
assert.match(admin, /'class_fixed'/);
assert.match(admin, /'class_loan'/);
assert.match(admin, /'manual_done'/);
assert.match(admin, /'keep'/);
assert.match(admin, /boekenbaai_token/);
assert.match(admin, /Bestaande uitleenregistraties worden opnieuw gecontroleerd/);
assert.match(admin, /Geen uitgestelde administratieve controles/);
assert.match(admin, /!task\.hasExplicitLoan/,
  'Never advertise a class checkout while Excel contains an explicit borrower');
assert.match(admin, /const selections = new Map\(\)/);
assert.match(admin, /remembered\.revision === task\.revision/);
assert.match(admin, /selections\.set\(task\.id/);
assert.match(admin, /selections\.delete\(task\.id\)/);
assert.match(followups, /deferredCount/);
assert.match(followups, /boekenbaai:assignment-tasks-changed/);
assert.doesNotMatch(admin, /innerHTML\s*=/,
  'Untrusted spreadsheet text must be inserted only as textContent');
console.log('Deferred administrative task UI: mounting, review actions and safe text rendering OK');
