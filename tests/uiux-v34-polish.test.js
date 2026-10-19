'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/uiux-v32.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/uiux-v32.css'), 'utf8');
new vm.Script(js, { filename: 'uiux-v32.js' });

// The desktop grids must not remain capped at 1440px or 1170px.
assert.match(css, /#admin-dashboard \.admin-dashboard,\s*body\.bb-teacher-v31\.bb-v32-active #teacher-dashboard #bb-teacher-v31-shell\s*\{[^}]*max-width: none/);
assert.match(css, /#admin-dashboard \.bb-v32-dashboard\.admin-modern__view\s*\{[^}]*grid-auto-rows: max-content/);
assert.match(css, /#admin-dashboard \.bb-v32-dashboard > \.bb-v33-stats-bar\s*\{[^}]*height: auto/);
assert.match(css, /#admin-dashboard \.bb-v33-stats-bar #bb-admin-v31-stats\s*\{[^}]*margin: 0/);
assert.match(css, /#bb-teacher-v31-classes-summary\s*\{[^}]*height: fit-content/);
assert.match(css, /#bb-teacher-v31-classes-summary \.bb-teacher-v31-row::before\s*\{[^}]*content: none/);
assert.match(css, /#bb-teacher-v31-classes-summary \.bb-v34-class-icon svg\s*\{[^}]*width: 27px/);
assert.match(css, /\.bb-v32-book-cover\s*\{[^}]*aspect-ratio: 2 \/ 3/, 'Keep existing cover ratio');
assert.match(css, /\.admin-modern__metric:nth-child\(3\) \.bb-admin-v31-metric-icon\s*\{[^}]*color: #9050bd/);
assert.match(css, /\.admin-modern__metric:nth-child\(2\) \.bb-admin-v31-metric-icon\s*\{[^}]*color: #0e956f/);
assert.match(css, /\.bb-v34-history-entry > \.history-item__time/);
assert.match(js, /new MutationObserver\(decorate\)\.observe\(list, \{ childList: true \}\)/);

// Categorize Dutch log items cautiously; unknown actions get a neutral icon.
const classifierStart = js.indexOf('  function classifyHistoryAction(message) {');
const historyStart = js.indexOf('  function installActivityIcons() {', classifierStart);
const teacherStart = js.indexOf('  function installTeacherClassIcons() {');
const decoratorEnd = js.indexOf('  function enhanceTeacherDashboard() {', historyStart);
assert.ok(teacherStart > 0 && classifierStart > teacherStart && decoratorEnd > historyStart);
const classify = {};
new vm.Script(js.slice(classifierStart, historyStart) +
  '\nthis.check = classifyHistoryAction;').runInNewContext(classify);
for (const [message, type] of [
  ['De Gorgels is toegevoegd aan de bibliotheek', 'book'],
  ['Boek aan leerling uitgeleend', 'lending'],
  ['Boek is teruggebracht', 'return'],
  ['Docent aan een klas gekoppeld', 'teacher'],
  ['Leerling overgezet naar andere klas', 'student'],
  ['Excelimport afgerond', 'import'],
  ['Onbekend feit', 'activity'],
  ['', 'activity'],
]) assert.equal(classify.check(message), type, message);

// Exercise the real decorators with a minimal DOM; refreshing a list must
// decorate new items exactly once, while leaving empty states alone.
function el(tag, className = '', textContent = '') {
  const e = { tag, className, textContent, children: [], dataset: {}, attrs: {},
    classList: { add(name) { e.className += ' ' + name; } },
    append(...nodes) { e.children.push(...nodes); for (const node of nodes) node.parent = e; },
    prepend(node) { e.children.unshift(node); node.parent = e; },
    setAttribute(name, value) { e.attrs[name] = value; },
    querySelector(selector) {
      return this.children.find(node =>
        selector[0] === '.' && node.className.split(' ').includes(selector.slice(1))) || null;
    },
    querySelectorAll(selector) {
      if (selector === '.bb-teacher-v31-row') return this.children.filter(node =>
        node.className.split(' ').includes('bb-teacher-v31-row'));
      if (selector === ':scope > .history-item') return this.children.filter(node =>
        node.className.split(' ').includes('history-item'));
      throw Error('Unexpected selector: ' + selector);
    },
  };
  Object.defineProperty(e, 'nextElementSibling', {
    get() { const a = e.parent?.children || []; return a[a.indexOf(e) + 1] || null; },
  });
  return e;
}
const classesCard = el('section');
const firstClass = el('button', 'bb-teacher-v31-row');
classesCard.append(firstClass);
const historyList = el('ul');
function historyRow(message) {
  const row = el('li', 'history-item');
  row.append(el('span', 'history-item__time', '10:00'), el('span', '', message));
  return row;
}
const row = historyRow('Boek is uitgeleend');
const empty = el('li', 'history-item');
empty.append(el('span', '', 'Het logboek is leeg.'));
historyList.append(row, empty);
const observers = [];
const ctx = { document: { getElementById(id) {
    return id === 'bb-teacher-v31-classes-summary' ? classesCard :
      id === 'history-list' ? historyList : null;
  } },
  make: (tag, cls) => el(tag, cls),
  makeIcon: type => el('svg', type),
  MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target, options) {
      assert.equal(options.childList, true);
      assert.equal(options.subtree, undefined);
      this.target = target;
    } },
};
new vm.Script(js.slice(teacherStart, decoratorEnd) +
  '\nthis.classIcons = installTeacherClassIcons;' +
  '\nthis.historyIcons = installActivityIcons;').runInNewContext(ctx);
ctx.classIcons();
ctx.historyIcons();
assert.equal(firstClass.children[0].className, 'bb-v34-class-icon');
assert.equal(row.children[0].dataset.kind, 'lending');
assert.equal(empty.children.length, 1, 'Empty history is not a real event');
assert.equal(observers.length, 2);
const freshClass = el('button', 'bb-teacher-v31-row');
classesCard.append(freshClass);
const freshEvent = historyRow('Boek ingeleverd');
historyList.append(freshEvent);
observers[0].cb();
observers[1].cb();
assert.equal(freshClass.children[0].className, 'bb-v34-class-icon');
assert.equal(freshEvent.children[0].dataset.kind, 'return');
observers[0].cb();
observers[1].cb();
assert.equal(freshClass.children.length, 1, 'No duplicate class icons');
assert.equal(freshEvent.children.length, 3, 'No duplicate history icons');
ctx.classIcons();
ctx.historyIcons();
assert.equal(observers.length, 2, 'No duplicate observers');
console.log('UI v3.4: full width, compact stats and classes, color icons, history refresh OK.');
