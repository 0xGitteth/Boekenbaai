'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'public/admin-modern.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/admin-modern.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');

// These assertions verify that the real cancel handler resets the internal
// selection, theme and cover crop, not merely the visible HTML form.
assert.match(app, /adminBookCancelButton\?\.addEventListener\('click', \(event\) => \{[\s\S]*?resetAdminBookForm\(\)/);
for (const field of [
  'selectedBookId = null',
  'adminBookCrop = null',
  "adminCropSourceUrl = ''",
  "adminCropLocalUrl = ''",
  "adminBookRawTags = []",
  "adminBookInitialThemeKeys = null",
  'setSelectedAdminThemes([])',
]) {
  assert.ok(app.includes(field), 'Full reset must clear: ' + field);
}
assert.match(html, /id="history-clear-button"/);
assert.match(html, /id="history-actions"[^>]*data-role-only="admin"/);
assert.match(css, /#bb-admin-v31-activity #history-panel > \.panel__header \{\s*display: flex/);
assert.match(css, /#bb-admin-v31-activity #history-panel > \.panel__header > div:not\(#history-actions\)/);
assert.doesNotMatch(css, /#bb-admin-v31-activity \.panel__header \{ display: none; \}/);

const instrumented = admin.replace(
  "  document.addEventListener('DOMContentLoaded', watchForAdmin);",
  '  globalThis.__adminEditorTest = { showBookEditor, installBookEditorControls };'
);
assert.notEqual(instrumented, admin, 'Unable to instrument admin editor for test');

function element(tag = 'div') {
  const listeners = new Map();
  return {
    tag,
    children: [],
    dataset: {},
    hidden: false,
    classList: {
      contains() { return false; },
      remove() {},
      add() {},
    },
    append(...children) { this.children.push(...children); },
    prepend(...children) { this.children.unshift(...children); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    click() { for (const cb of listeners.get('click') || []) cb({ target: this }); },
    focus() { this.didFocus = true; },
    scrollIntoView() { this.didScroll = true; },
    setAttribute() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
}

const bookCard = element('section');
const cancel = element('button');
const bookTitle = element('input');
const openBook = element('button');
const dashboard = element('section');
let resets = 0;
const model = { selectedBook: 'existing-id', themes: ['oude'], crop: { x: 55 } };

// app.js already installs this reset listener on the existing cancel button.
cancel.addEventListener('click', () => {
  resets++;
  model.selectedBook = null;
  model.themes = [];
  model.crop = null;
});
const ids = new Map([
  ['admin-dashboard', dashboard],
  ['admin-book-cancel', cancel],
  ['admin-book-title', bookTitle],
  ['bb-admin-v31-open-editor', openBook],
]);
const document = {
  body: {
    classList: {
      contains(value) { return value === 'bb-admin-v31'; },
      remove() {},
    },
  },
  querySelector(selector) {
    return selector === '#admin-dashboard .admin-card--books' ? bookCard : null;
  },
  querySelectorAll() { return []; },
  getElementById(id) { return ids.get(id) || null; },
  createElement(tag) { return element(tag); },
  addEventListener() {},
};
const context = vm.createContext({
  document,
  window: { scrollTo() {} },
  console,
});
new vm.Script(instrumented, { filename: 'public/admin-modern.js' }).runInContext(context);
const { installBookEditorControls, showBookEditor } = context.__adminEditorTest;
installBookEditorControls(bookCard);
assert.equal(bookCard.hidden, true, 'Book editor must start closed');

// Regression P2-1: clicking "new" during an existing edit must show a clean
// new form; the cancel event is allowed to hide the old editor *first*.
showBookEditor(true);
assert.equal(resets, 1, 'New book must use full application reset');
assert.equal(bookCard.hidden, false, 'New book must remain visible');
assert.equal(bookTitle.didFocus, true, 'New book title must receive focus');
assert.deepEqual(model, { selectedBook: null, themes: [], crop: null });

// Regression P2-2: cancelling an unsaved new book must invoke exactly the
// same full reset. The existing edit-cancel control may be visually hidden.
model.themes = ['concept'];
model.crop = { x: 8 };
const heading = bookCard.children[0];
const close = heading.children.find((child) => child.tag === 'button');
assert.ok(close, 'Editor close button should be present');
close.click();
assert.equal(resets, 2);
assert.equal(bookCard.hidden, true);
assert.deepEqual(model, { selectedBook: null, themes: [], crop: null });
assert.equal(openBook.didFocus, true, 'Focus must return to New Book button');

// An additional creation must start with the same clean state.
bookTitle.didFocus = false;
showBookEditor(true);
assert.equal(resets, 3);
assert.equal(bookCard.hidden, false);
assert.equal(bookTitle.didFocus, true);

console.log('Beheer v3.1 Codex review regression tests passed.');
