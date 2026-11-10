'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/read-completion.js'), 'utf8');
const student = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const staff = fs.readFileSync(path.join(root, 'public/staff-loans.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const staffHtml = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

for (const html of [index, staffHtml]) {
  assert.match(html, /id="reading-completion-yes"/);
  assert.match(html, /id="reading-completion-no"/);
  assert.match(html, /src="read-completion.js"/);
  assert.match(html, /href="read-completion.css"/);
}
for (const file of ['read-completion.js', 'read-completion.css']) {
  assert.ok(vite.includes("'" + file + "'"), file + ' must be copied into dist');
}
assert.match(index, /id="student-reading-records"/);
assert.match(student, /window\.BoekenbaaiResolveApiUrl = resolveApiUrl/,
  'Reading helper must share app.js configured API-base resolution');
assert.match(source, /fetch\(resolveApiUrl\(route\)/,
  'Reading history and edits must use the configured API base');
assert.match(staffHtml, /id="staff-reading-records"/);
assert.match(server, /typeof body.finished !== 'boolean'/);
assert.match(server, /createReturnReadingRecord\(/);
assert.match(source, /Achteraf gewijzigd/);
assert.match(source, /Wijzigingsgeschiedenis bekijken/);
assert.match(source, /record\.originalFinished/);
assert.match(source, /change\.changedByName/);
assert.match(source, /Object\.assign\(record, result\.record\)/);
assert.match(source, /updateAudit\(content, record\)/,
  'Only the changed row should refresh its audit trail');
assert.doesNotMatch(source, /Object\.assign\(record, result\.record\);\s*render\(cachedRecords, container\)/,
  'Saving one answer must not clear unsaved dropdowns on other records');
assert.match(student, /await window.BoekenbaaiReadCompletion\?\.ask/);
assert.match(student, /body: operation === 'check-in' \? \{ finished \} : \{\}/);
assert.match(staff, /finished = await window.BoekenbaaiReadCompletion\?\.ask/);
assert.match(staff, /classId: loan.borrowerId, finished/);
assert.match(staff, /studentId: loan.borrowerId, finished/);

function element() {
  return {
    textContent: '',
    open: false,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
  };
}
const ids = [
  'reading-completion-dialog',
  'reading-completion-title',
  'reading-completion-description',
  'reading-completion-yes',
  'reading-completion-no',
];
const nodes = new Map(ids.map(id => [id, element()]));
const events = new Map();
const window = {
  localStorage: { getItem() { return null; } },
  addEventListener(name, handler) { events.set(name, handler); },
};
vm.runInNewContext(source, {
  document: { getElementById(id) { return nodes.get(id) || null; } },
  window, console,
});
const modal = nodes.get('reading-completion-dialog');
const yes = nodes.get('reading-completion-yes');
const no = nodes.get('reading-completion-no');
const completion = window.BoekenbaaiReadCompletion;
assert.ok(completion);
(async () => {
  const answer = completion.ask('De titel');
  assert.equal(modal.open, true);
  assert.match(nodes.get('reading-completion-description').textContent, /De titel/);
  let prevented = false;
  modal.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'Escape cannot dismiss the mandatory answer');
  assert.equal(modal.open, true);
  modal.listeners.click({ target: modal, preventDefault() { prevented = true; } });
  assert.equal(modal.open, true, 'Backdrop cannot dismiss the answer');
  await assert.rejects(completion.ask('Ander boek'), /openstaande vraag/);
  yes.listeners.click();
  assert.equal(await answer, true);
  assert.equal(modal.open, false);

  const next = completion.ask('Nog een titel');
  no.listeners.click();
  assert.equal(await next, false);
  assert.equal(modal.open, false);
  console.log('Mandatory Ja/Nee modal, role interfaces and production assets passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
