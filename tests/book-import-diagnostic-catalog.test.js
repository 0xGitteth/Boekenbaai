'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const labels=require('../public/admin-book-import-error-catalog');
const root=path.join(__dirname,'..');

const sources=[
  'book-import-analysis.js','book-import-analysis-values.js',
  'book-import-analysis-row.js','book-import-analysis-context.js',
  'book-import-analysis-metadata.js','book-import-review.js',
  'book-import-stage.js','book-import-unified-sync.js',
  'book-import-inventory-sync.js',
  'book-import-assignment-reconciliation.js',
  'book-import-loan-migration.js','book-import-workbook.js',
];
const snippets=[
  /\baddIssue\(\s*row\s*,\s*['"]([a-z][a-z0-9_]+)['"]/g,
  /\bblock\(\s*['"]([a-z][a-z0-9_]+)['"]/g,
  /\b(?:error|reason|code)\s*:\s*['"]([a-z][a-z0-9_]+)['"]/g,
];
const discovered=new Map();
for(const name of sources){
  const source=fs.readFileSync(path.join(root,name),'utf8');
  for(const rx of snippets){
    for(const match of source.matchAll(rx)){
      const code=match[1];
      if(!code.includes('_'))continue;
      if(!discovered.has(code))discovered.set(code,new Set());
      discovered.get(code).add(name);
    }
  }
}
// Expressions with conditional error labels do not start at addIssue(row,
// 'literal'. They must still be named and described.
const conditional=[
  'student_loan_unmatched','student_loan_ambiguous',
  'class_loan_unmatched','class_loan_ambiguous',
  'physical_barcode_not_found','physical_copy_not_found',
  'loan_context_requires_followup','source_row_requires_review',
  'conflicting_excel_values','student_already_borrowed_edition',
  'existing_edition_requires_review','already_processed',
];
for(const code of conditional)if(code!=='already_processed'){
  if(!discovered.has(code))discovered.set(code,new Set(['dynamic code']));
}

const unmapped=[...discovered.keys()].filter(code=>
  !Object.prototype.hasOwnProperty.call(labels,code));
assert.deepEqual(unmapped,[],
  'Every emitted diagnostic or resolution reason needs a usable Dutch explanation');
for(const code of discovered.keys()){
  const label=labels[code];
  assert.equal(typeof label,'string',code+' missing Dutch label');
  assert.ok(label.trim().length>=14,code+' needs an explanation');
  assert.ok(!label.includes('_'),code+' displays a raw code instead of plain language');
}
assert.ok(discovered.size>=85,
  'The catalog must cover the complete parser, ISBN, stock, loan and review chain');

const html=fs.readFileSync(path.join(root,'public/staff.html'),'utf8');
assert.ok(html.includes('<script defer src="admin-book-import-error-catalog.js"></script>'));
assert.ok(html.indexOf('admin-book-import-error-catalog.js')
  <html.indexOf('admin-book-import-review.js'),
  'Diagnostics must load before the import UI');
const ui=fs.readFileSync(path.join(root,'public/admin-book-import-review.js'),'utf8');
assert.ok(ui.includes('window.BOEKENBAAI_IMPORT_DIAGNOSTICS'));
assert.ok(ui.includes('const issueLabels={\n        ...importErrorText,'));
assert.ok(ui.includes('const reasonNames={\n        ...importErrorText,'));
assert.ok(ui.includes('const reasonNames = {\n    ...importErrorText,'));
assert.ok(ui.includes('const issueNames = {\n    ...importErrorText,'));
console.log('Book import diagnostic audit:',discovered.size,
  'emitted diagnostic codes have Dutch labels');
