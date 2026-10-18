'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const js = read('public/teacher-modern.js');
const css = read('public/teacher-modern.css');
const html = read('public/staff.html');
const admin = read('public/admin-modern.js');
new vm.Script(js, { filename: 'public/teacher-modern.js' });

// The approved v3.1 teacher structure, not a replacement of the login flow.
for (const [id, label] of [
  ['start', 'Start'], ['classes', 'Mijn klassen'], ['catalog', 'Catalogus'],
  ['lending', 'Uitlenen en innemen'], ['tasks', 'Taken'], ['account', 'Mijn account'],
]) {
  assert.ok(js.includes("['" + id + "',"), 'Missing navigation section '+label);
}
assert.match(html, /<script type="module" src="teacher-modern\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="teacher-modern\.css"/);
assert.match(css, /body\.bb-teacher-v31 > main/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(js, /const watcher = new MutationObserver\(sync\)/);
assert.match(js, /dashboard\.classList\.contains\('hidden'\)/);
assert.match(js, /admin\.classList\.contains\('hidden'\)/);
assert.match(js, /function remount\(/);
assert.match(js, /function restore\(/);
assert.match(js, /if \(admin\.contains\(node\)\) continue;/);
assert.match(js, /remount\(\)/);
assert.match(js, /restore\(\)/);
assert.match(js, /if \(admin\.classList\.contains\('hidden'\)\) setIdentity\(false\)/);
assert.match(js, /aria-label', 'Docentenportaal'/);
assert.match(js, /aria-labelledby', 'teacher-panel-title'/);
assert.match(js, /if \(active && page === 'start'\) void updateStart\(\)/);

// Existing live controls must be reused; no duplicated inputs, endpoints or
// rewritten account/teacher/student/session authorization paths.
for (const id of [
  'teacher-dashboard', 'class-list', 'teacher-student-form', 'teacher-student-class',
  'teacher-student-name', 'teacher-student-suggestions', 'teacher-student-username',
  'search-input', 'staff-book-overview-content', 'book-grid', 'staff-loan-panel',
  'history-panel', 'book-import-followups-panel', 'book-import-mail-preferences-panel',
]) assert.ok(html.includes('id="' + id + '"'), id + ' must stay present');
assert.match(js, /place\(dashboard\.querySelector\('\.teacher-layout__classes'\), classes\)/);
assert.match(js, /place\(dashboard\.querySelector\('\.teacher-layout'\), catalog\)/);
assert.match(js, /place\(document\.getElementById\('staff-loan-panel'\), lending\)/);
assert.match(js, /place\(document\.getElementById\('book-import-mail-preferences-panel'\), account\)/);
assert.match(js, /place\(document\.getElementById\('history-panel'\), recent\)/);
assert.match(js, /fetch\('\/api\/staff\/loans'/);
assert.match(js, /fetch\('\/api\/staff\/book-import-followups'/);
assert.match(css, /grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
assert.match(js, /Goedemorgen/);
assert.match(js, /Openstaande taken/);
assert.match(js, /localStorage\.getItem\('boekenbaai_token'\)/);
assert.match(js, /window\.dispatchEvent\(new Event\('boekenbaai:staff-refresh'\)\)/);
assert.match(admin, /body\.classList\.toggle\('bb-admin-v31', active\)/);
assert.doesNotMatch(js, /fetch\('[^']+', \{ method: '(POST|DELETE|PATCH|PUT)'/);
assert.match(js, /nav\.inert = matchMedia\('\(max-width:760px\)'\)\.matches/);
assert.match(js, /menu\.setAttribute\('aria-expanded', 'false'\)/);

// Isolated teacher styling must not break admin or unauthenticated states.
const ruleBlocks = [...css.matchAll(/(?:^|\n)([^{]+)\{[^}]*\}/g)].map(x=>x[1]);
for (const selector of ruleBlocks) {
  if (/^\s*@media|^\s*\/\*/.test(selector) || selector.includes('@media')) continue;
  assert.ok(selector.includes('bb-teacher-v31'),
    'Teacher style must remain scoped to logged-in teacher: '+selector);
}

// A role switch can cause the admin's MutationObserver to move shared
// panels before the teacher's observer restores its own nodes. Do not steal
// them out of Beheer when unwinding the former teacher layout.
const restoreStart = js.indexOf('  function restore() {');
const restoreEnd = js.indexOf('  function remount() {', restoreStart);
assert.ok(restoreStart > 0 && restoreEnd > restoreStart);
const adminPanel = { id: 'loan', parentElement: { id: 'admin' } };
const teacherPanel = { id: 'teacher', parentElement: { id: 'teacher' } };
const moved = [];
const adminRole = { contains(node) { return node === adminPanel; } };
const placements = [
  { node: adminPanel, marker: { isConnected: true, after(node) { moved.push(node); } } },
  { node: teacherPanel, marker: { isConnected: true, after(node) { moved.push(node); } } },
];
const context = vm.createContext({ placements, admin: adminRole });
new vm.Script(js.slice(restoreStart, restoreEnd) + '\nthis.runRestore = restore;').runInContext(context);
context.runRestore();
assert.deepEqual(moved, [teacherPanel], 'Beheer-owned panel must stay inside Beheer');
console.log('Docentenportaal v3.1 navigatie, rechten- en responsive regressies geslaagd.');
