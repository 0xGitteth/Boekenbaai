'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'public/admin-modern.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/admin-modern.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');
const loans = fs.readFileSync(path.join(root, 'public/staff-loans.js'), 'utf8');

new vm.Script(admin, { filename: 'public/admin-modern.js' });
assert.match(admin, /function arrangeAdminLoans\(active\)/);
assert.match(admin, /arrangeAdminLoans\(true\)/);
assert.match(admin, /arrangeAdminLoans\(false\)/);
assert.match(admin, /mountSharedPanel\('staff-loan-panel', 'bb-admin-v31-loans'\)/);

// The underlying loan controls and their event listeners remain unchanged.
for (const id of [
  'staff-loan-panel', 'staff-loans-title', 'staff-loan-form',
  'staff-loan-type', 'staff-loan-borrower', 'staff-loan-book-search',
  'staff-loan-book', 'staff-loan-due', 'staff-loan-submit',
  'staff-loan-message', 'staff-loan-filter', 'staff-loan-current'
]) assert.ok(html.includes('id="' + id + '"'), 'Existing loan control missing: ' + id);
assert.match(loans, /\/api\/books\/' \+ encodeURIComponent\(book\.value\) \+ '\/check-out'/);
assert.match(loans, /\/api\/books\/' \+ encodeURIComponent\(loan\.bookId\) \+ '\/check-in'/);
assert.match(loans, /window\.confirm\('Dit exemplaar als ingeleverd registreren\?'\)/);

// Desktop: clear two-stage cards, borrower and copy fields aligned; mobile
// returns to one-column field flow and a noncramped current-loans list.
assert.match(css, /#bb-admin-v31-loans \.bb-admin-v31-loan-card \{/);
assert.match(css, /#bb-admin-v31-loans #staff-loan-form \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /#staff-loan-form > \.form-field:nth-child\(3\) \{[\s\S]*?grid-column: 1 \/ -1/);
assert.match(css, /#staff-loan-current \{[\s\S]*?overflow-y: auto/);
assert.match(css, /@media \(max-width: 940px\)/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /#staff-loan-current:focus-visible/);

// Behavioral test of the actual layout function: original live form nodes are
// relocated, never duplicated. Restoring the teacher view must undo all changes.
const start = admin.indexOf('  function arrangeAdminLoans(active) {');
const end = admin.indexOf('  function activateAdminLayout(active) {', start);
assert.ok(start > 0 && end > start, 'Unable to isolate loan layout function');

class Node {
  constructor(tag, options = {}) {
    this.tag = tag;
    this.id = options.id || '';
    this.className = options.className || '';
    this.textContent = options.text || '';
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.listener = options.listener;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) {
        node.parentElement.children = node.parentElement.children.filter(c => c !== node);
      }
      this.children.push(node);
      node.parentElement = this;
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  querySelector(selector) {
    const matches = node => {
      if (selector.startsWith('#')) return node.id === selector.slice(1);
      if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
      return selector === 'label[for="staff-loan-filter"]'
        && node.tag === 'label' && node.attributes.get('for') === 'staff-loan-filter';
    };
    for (const child of this.children) {
      if (matches(child)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector.startsWith('.') && node.className.split(/\s+/).includes(selector.slice(1))) return node;
      node = node.parentElement;
    }
    return null;
  }
}

const panel = new Node('section', { id: 'staff-loan-panel' });
const header = new Node('div', { className: 'panel__header' });
const title = new Node('h2', { id: 'staff-loans-title', text: 'Boeken uitlenen en innemen' });
const intro = new Node('p', { className: 'hint', text: 'Bestaande omschrijving' });
header.append(title, intro);
const form = new Node('form', { id: 'staff-loan-form' });
const existingInput = new Node('input', { id: 'staff-loan-book', listener: () => {} });
form.append(existingInput);
const status = new Node('p', { id: 'staff-loan-message' });
const filterField = new Node('div', { className: 'form-field' });
const filterLabel = new Node('label', { text: 'Huidige uitleningen' });
filterLabel.setAttribute('for', 'staff-loan-filter');
filterField.append(filterLabel, new Node('select', { id: 'staff-loan-filter' }));
const output = new Node('div', { id: 'staff-loan-current' });
panel.append(header, form, status, filterField, output);
const original = panel.children.slice();
const state = { loanLayout: null };
const document = {
  getElementById(id) { return id === 'staff-loan-panel' ? panel : null; },
  createElement(tag) { return new Node(tag); },
};
const ctx = vm.createContext({ state, document });
new vm.Script(
  'const make = (tag, options = {}) => {' +
    'const element = document.createElement(tag);' +
    'if (options.className) element.className = options.className;' +
    'if (options.text !== undefined) element.textContent = options.text;' +
    'return element; };' +
    admin.slice(start, end) +
    'globalThis.arrange = arrangeAdminLoans;'
).runInContext(ctx);

ctx.arrange(true);
assert.equal(panel.children.length, 2);
assert.equal(panel.children[0].className, 'bb-admin-v31-loan-card bb-admin-v31-loan-create');
assert.equal(panel.children[1].className, 'bb-admin-v31-loan-card bb-admin-v31-loan-current');
assert.strictEqual(form.parentElement, panel.children[0]);
assert.strictEqual(output.parentElement, panel.children[1]);
assert.strictEqual(form.querySelector('#staff-loan-book'), existingInput);
assert.equal(title.textContent, 'Nieuwe uitlening');
assert.equal(filterLabel.textContent, 'Filter op klas');
assert.equal(output.attributes.get('tabindex'), '0');
ctx.arrange(true);
assert.equal(panel.children.length, 2, 'No duplicate cards on repeat activation');
ctx.arrange(false);
assert.equal(panel.children.length, original.length);
original.forEach((node, i) => assert.strictEqual(panel.children[i], node));
assert.equal(title.textContent, 'Boeken uitlenen en innemen');
assert.equal(intro.textContent, 'Bestaande omschrijving');
assert.equal(filterLabel.textContent, 'Huidige uitleningen');
assert.equal(output.attributes.has('tabindex'), false);
assert.equal(output.attributes.has('aria-label'), false);
assert.strictEqual(form.querySelector('#staff-loan-book'), existingInput);
assert.strictEqual(existingInput.listener, original[1].children[0].listener);
ctx.arrange(true);
assert.equal(panel.children.length, 2, 'Reauthentication must rebuild the admin layout');
ctx.arrange(false);

console.log('Beheer v3.1 uitleenindeling: interactieve nodes, desktop/mobiel en rolwisseling gecontroleerd.');
