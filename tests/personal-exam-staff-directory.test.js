'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function element() {
  return {
    value: '', textContent: '', disabled: false, children: [], listeners: {},
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    get firstChild() { return this.children[0] || null; },
    get options() { return this.children; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}

async function run() {
  const nodes = new Map([
    'staff-exam-student', 'staff-exam-student-search', 'staff-exam-book',
    'staff-exam-book-search', 'staff-exam-book-add', 'staff-exam-entries',
    'staff-exam-message',
  ].map(id => ['#' + id, element()]));
  const section = { querySelector(selector) { return nodes.get(selector); } };
  let token = 'old-account-token';
  const handlers = new Map();
  const pending = [];
  const window = {
    BOEKENBAAI_API_BASE: '',
    addEventListener(name, callback) { handlers.set(name, callback); },
  };
  const localStorage = { getItem() { return token; } };
  const fetch = (url, options) => new Promise(resolve => {
    pending.push({ url, options, resolve });
  });
  const document = {
    getElementById(id) { return id === 'staff-exam-reading' ? section : null; },
    createElement: element,
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'staff-exam-reading-list.js'), 'utf8');
  vm.runInNewContext(source, { window, localStorage, fetch, document });
  assert.equal(pending.length, 1, 'Initial staff directory request must begin');
  assert.equal(pending[0].options.headers.Authorization, 'Bearer old-account-token');

  token = null;
  handlers.get('boekenbaai:staff-auth-cleared')();
  token = 'new-account-token';
  handlers.get('boekenbaai:staff-refresh')();
  assert.equal(pending.length, 1, 'Do not start an overlapping directory request');

  pending[0].resolve({ ok: true, async json() {
    return { students: [{ id: 'old-student', name: 'Privé leerling oude klas' }],
      books: [] };
  } });
  await new Promise(resolve => setImmediate(resolve));
  const choice = nodes.get('#staff-exam-student');
  assert.ok(!choice.options.some(option => option.textContent.includes('oude klas')),
    'A late old-account directory response must not repaint private names');
  assert.equal(pending.length, 2,
    'After stale request completes, issue a new request for the active account');
  assert.equal(pending[1].options.headers.Authorization, 'Bearer new-account-token');

  pending[1].resolve({ ok: true, async json() {
    return { students: [{ id: 'new-student', name: 'Nieuwe klas' }], books: [] };
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(choice.options.some(option => option.textContent === 'Nieuwe klas'));
  assert.ok(!choice.options.some(option => option.textContent.includes('oude klas')));
}
run().then(() => console.log('Exam staff directory session boundary: OK'),
  error => { console.error(error); process.exitCode = 1; });
