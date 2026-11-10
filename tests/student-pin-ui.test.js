'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'student-pin.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
assert.ok(appSource.includes("boekenbaai:staff-auth-cleared"));
assert.ok(appSource.includes("boekenbaai:student-auth-pending"));
assert.ok(appSource.includes("boekenbaai:student-auth-validated"));

const elements = new Map();
const events = new Map();
const makeElement = id => ({
  id, open: false, hidden: false, disabled: false, value: '', textContent: '',
  listeners: {},
  addEventListener(type, fn) { this.listeners[type] = fn; },
});
for (const id of [
  'student-pin-details', 'student-pin-form', 'student-pin-status',
  'student-pin-feedback', 'student-pin-new', 'student-pin-repeat',
  'student-pin-save', 'student-pin-reset',
]) elements.set(id, makeElement(id));

const element = id => elements.get('student-pin-' + id);
const form = element('form');
const details = element('details');
const input = element('new');
const repeat = element('repeat');
const feedback = element('feedback');
form.reset = () => { input.value = ''; repeat.value = ''; };

let resolvePendingSet = null;
const fakeFetch = async (url, options) => {
  if (url.includes('/set') && options.method === 'POST') {
    return await new Promise(resolve => { resolvePendingSet = resolve; });
  }
  return {
    ok: true,
    async json() { return { configured: true, hasPin: false, canSet: true }; },
  };
};
const window = {
  addEventListener(type, fn) { events.set(type, fn); },
  confirm() { return true; },
};
vm.runInNewContext(source, {
  document: { getElementById(id) { return elements.get(id) || null; } },
  window,
  fetch: fakeFetch,
  localStorage: { getItem() { return 'cookie'; } },
  console,
});

const tick = () => new Promise(resolve => setImmediate(resolve));
async function show() {
  details.open = true;
  await details.listeners.toggle();
  await tick();
}

(async () => {
  events.get('boekenbaai:student-auth-validated')({ detail: { studentId: 'student-a' } });
  await show();
  assert.equal(form.hidden, false, 'PIN settings should show for verified student');
  input.value = '111111';
  repeat.value = '111111';

  events.get('boekenbaai:staff-auth-cleared')();
  assert.equal(input.value, '', 'Logout immediately wipes the PIN');
  assert.equal(repeat.value, '', 'Logout immediately wipes confirmation');
  assert.equal(details.open, false, 'Logout closes old account settings');

  events.get('boekenbaai:student-auth-validated')({ detail: { studentId: 'student-b' } });
  await show();
  assert.equal(input.value, '', 'Next student starts with an empty PIN');
  input.value = '222222';
  repeat.value = '222222';
  events.get('boekenbaai:student-auth-pending')();
  assert.equal(input.value, '', 'Switching login clears sensitive fields before auth completes');
  assert.equal(details.open, false);
  await show();

  input.value = '333333';
  repeat.value = '333333';
  const pendingSubmit = form.listeners.submit({ preventDefault() {} });
  await tick();
  assert.ok(resolvePendingSet, 'PIN submission is pending');
  events.get('boekenbaai:staff-auth-cleared')();
  resolvePendingSet({
    ok: true,
    async json() { return { hasPin: true, message: 'PIN opgeslagen' }; },
  });
  await pendingSubmit;
  assert.equal(feedback.textContent, '', 'Late response cannot show earlier student status');
  assert.equal(input.value, '', 'Late response cannot refill old account PIN');
  assert.equal(details.open, false, 'Old account details remain closed');
  console.log('Student PIN shared-tablet logout and account-switch UI tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
