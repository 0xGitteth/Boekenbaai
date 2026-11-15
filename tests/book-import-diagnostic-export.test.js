'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ui=fs.readFileSync(path.join(__dirname,'../public/admin-book-import-review.js'),'utf8');
const start=ui.indexOf('function diagnosticSnapshot()');
const end=ui.indexOf('function renderUnifiedSync()',start);
assert.ok(start>=0&&end>start,'Preview diagnosis must exist in the unified import review');
const block=ui.slice(start,end);
for(const field of ['sourceEvidence','blockers','editionIsbn','rawIsbn',
  'metadataIssues','worksheetRow','issues','inventorySummary'])
  assert.ok(block.includes(field),'Missing diagnostic detail: '+field);
for(const privateField of ['studentId','borrowerId','studentLoan','borrowedBooks',
  'learnerName','mentorId','password','token'])
  assert.ok(!block.includes(privateField),
    'Pre-import diagnosis must not include private identity data: '+privateField);
assert.match(ui,/Download diagnoseverslag \(JSON\)/,
  'Diagnosis is available before the final import confirmation');
console.log('Pre-import diagnostic export is scoped to safe book-level data.');
