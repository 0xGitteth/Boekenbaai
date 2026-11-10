'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const studentManagement = fs.readFileSync(path.join(root, 'public/student-management.js'), 'utf8');
const staff = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/student-quick-loan.js'), 'utf8');

assert.match(html, /id="student-quick-loan-dialog"/);
assert.match(html, /id="student-quick-loan-pin"/);
assert.match(html, /id="student-quick-loan-results"/);
assert.match(app, /BoekenbaaiQuickLoan\?\.open/);
assert.match(app, /boekenbaai:quick-loan-completed/);
assert.match(studentManagement, /PIN resetten/);
assert.match(staff, /id="admin-student-detail-pin-reset"/);
for (const file of ['student-quick-loan.js', 'student-quick-loan.css']) {
  assert.ok(vite.includes("'" + file + "'"), 'Must copy quick-loan asset to dist: ' + file);
  assert.ok(html.includes('"' + file + '"'), 'Must include quick-loan asset: ' + file);
}

function makeElement(tag = 'div') {
  return {
    tag, value: '', textContent: '', disabled: false, open: false,
    children: [], attrs: {}, listeners: {}, style: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.close?.(); },
    reset() { this.resetCalled = true; },
  };
}
const names = [
  'student-quick-loan-dialog', 'student-quick-loan-form',
  'student-quick-loan-name', 'student-quick-loan-results',
  'student-quick-loan-selected', 'student-quick-loan-pin',
  'student-quick-loan-book', 'student-quick-loan-message',
  'student-quick-loan-submit', 'student-quick-loan-google',
  'student-quick-loan-close', 'student-action-message',
  'student-nav-profile',
];
const elements = new Map(names.map(id => [id, makeElement()]));
const form = elements.get('student-quick-loan-form');
form.reset = () => {
  elements.get('student-quick-loan-name').value = '';
  elements.get('student-quick-loan-pin').value = '';
};
const name = elements.get('student-quick-loan-name');
const pin = elements.get('student-quick-loan-pin');
const dialog = elements.get('student-quick-loan-dialog');
let searchCalls = 0;
let verificationCalls = 0;
let checkoutCalls = 0;
let lastLoan = null;
let holdVerify = false;
let releaseVerify = null;
const emitted = [];
const fetchStub = async (url, options) => {
  if (url.includes('/api/login-search')) {
    searchCalls++;
    return {
      ok: true,
      async json() { return { matches: [{ id: 'student-a', displayName: 'Anna · Structuur A' }] }; },
    };
  }
  if (url === '/api/auth/student-pin/verify') {
    verificationCalls++;
    lastLoan = JSON.parse(options.body);
    if (holdVerify) {
      return new Promise(resolve => { releaseVerify = resolve; });
    }
    return { ok: true, async json() { return { grant: 'opaque-short-lived-grant' }; } };
  }
  if (url.includes('/check-out')) {
    checkoutCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.pinCheckoutGrant, 'opaque-short-lived-grant');
    assert.ok(!body.pin, 'PIN cannot be forwarded to book checkout');
    return { ok: true, async json() { return { book: { title: 'Testboek' } }; } };
  }
  throw Error('Unexpected request: ' + url);
};
const window = {
  dispatchEvent(evt) { emitted.push(evt); },
  confirm() { return true; },
};
vm.runInNewContext(source, {
  document: {
    getElementById(id) { return elements.get(id) || null; },
    createElement: makeElement,
  },
  window,
  fetch: fetchStub,
  AbortController,
  CustomEvent: class {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  },
  setTimeout, clearTimeout,
});

(async () => {
  assert.ok(window.BoekenbaaiQuickLoan, 'Public controller is installed');
  window.BoekenbaaiQuickLoan.open({ id: 'copy-one', title: 'Testboek', status: 'available' });
  assert.equal(dialog.open, true);
  assert.equal(name.focused, true);
  name.value = 'An';
  name.listeners.input();
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.equal(searchCalls, 0, 'Name search only runs from three characters');
  name.value = 'Ann';
  name.listeners.input();
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.equal(searchCalls, 1);
  const option = elements.get('student-quick-loan-results').children[0].children[0];
  option.listeners.click();
  pin.value = '123456';
  const promise = form.listeners.submit({ preventDefault() {} });
  await promise;
  assert.equal(verificationCalls, 1);
  assert.equal(lastLoan.studentId, 'student-a');
  assert.equal(lastLoan.bookId, 'copy-one');
  assert.equal(lastLoan.pin, '123456');
  assert.equal(checkoutCalls, 1);
  assert.equal(pin.value, '', 'PIN wiped immediately');
  assert.equal(dialog.open, false);
  assert.equal(emitted[0].type, 'boekenbaai:quick-loan-completed');
  assert.equal(elements.get('student-action-message').textContent,
    'Testboek is uitgeleend. Veel leesplezier!');

  // A pending verification must not checkout if the dialog is canceled and
  // reopened for the same book, even when a stale result later arrives.
  holdVerify = true;
  window.BoekenbaaiQuickLoan.open({ id: 'copy-one', title: 'Testboek', status: 'available' });
  name.value = 'Anna';
  name.listeners.input();
  await new Promise(resolve => setTimeout(resolve, 260));
  elements.get('student-quick-loan-results').children[0].children[0].listeners.click();
  pin.value = '123456';
  const oldSubmit = form.listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(releaseVerify, 'PIN request is deliberately pending');
  dialog.close();
  window.BoekenbaaiQuickLoan.open({ id: 'copy-one', title: 'Testboek', status: 'available' });
  releaseVerify({
    ok: true, async json() { return { grant: 'stale-grant-must-not-be-used' }; },
  });
  await oldSubmit;
  assert.equal(checkoutCalls, 1, 'Old PIN response may not checkout after dialog cancellation');
  assert.equal(dialog.open, true, 'A new dialog remains open');
  assert.equal(pin.value, '', 'Reopened dialog never inherits another learner PIN');
  dialog.close();

  console.log('Quick loan UI, account hygiene, stale responses and dist assets verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
