'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'public/student-management.js'), 'utf8');
const compat = fs.readFileSync(path.join(root, 'public/student-management-compat.js'), 'utf8');
const teacher = fs.readFileSync(path.join(root, 'public/teacher-modern.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/teacher-modern.css'), 'utf8');

const start = compat.indexOf('  function placeTeacherStudentManagement() {');
const end = compat.indexOf('  function placeAdminStudentManagement()', start);
assert.ok(start > 0 && end > start, 'Cannot isolate compatibility placement function');
const placeCode = compat.slice(start, end);

function node(name) {
  return {
    name, children: [], parentElement: null, nextElementSibling: null,
    classList: { contains() { return false; } },
    append(child) {
      if (child.parentElement) child.parentElement.children =
        child.parentElement.children.filter(x => x !== child);
      this.children.push(child);
      child.parentElement = this;
    },
    insertBefore(child, reference) {
      if (!this.children.includes(reference)) throw Error('NotFoundError: child reference is nested');
      if (child.parentElement) child.parentElement.children =
        child.parentElement.children.filter(x => x !== child);
      const idx = this.children.indexOf(reference);
      this.children.splice(idx,0,child);
      child.parentElement = this;
    },
    querySelector() { return null; },
  };
}

const dashboard = node('teacher-dashboard');
const admin = node('admin-dashboard');
const classView = node('teacher-v31-classes');
const catalogue = node('teacher-v31-catalog');
const bookLayout = node('teacher-layout');
catalogue.append(bookLayout); // The book overview is no longer a direct child.
let panel = node('student-management-panel');
dashboard.append(panel);
const body = { classList: {
  contains(className) { return className === 'bb-teacher-v31' && body.teacherActive; },
}};
body.teacherActive = true;
const document = {
  body,
  querySelector(selector) {
    const refs = {
      '#admin-dashboard':admin, '#teacher-dashboard':dashboard,
      '#student-management-panel':panel,
      '[data-teacher-view="classes"]':classView,
    };
    return refs[selector] || null;
  },
};
dashboard.querySelector = selector => selector === '.teacher-layout' ? bookLayout : null;
const ctx = vm.createContext({ document });
new vm.Script(placeCode+'\nthis.moveStudentPanel = placeTeacherStudentManagement;').runInContext(ctx);

ctx.moveStudentPanel();
assert.strictEqual(panel.parentElement,classView,'Live student controls belong on Mijn klassen');

// student-management.js replaces its panel completely upon refresh:
panel = node('student-management-panel-v2');
dashboard.append(panel);
ctx.moveStudentPanel();
assert.strictEqual(panel.parentElement,classView,
  'A newly rendered panel must move into Mijn klassen as well');

// Legacy mode with a moved nested book layout must not use insertBefore and throw.
body.teacherActive = false;
ctx.moveStudentPanel();
assert.strictEqual(panel.parentElement,dashboard,
  'Legacy layout should gracefully append when the reference is not a direct child');

// Admin mode must not steal the controls out of the admin page.
admin.classList.contains = name => name === 'hidden' ? false : false;
admin.append(panel);
ctx.moveStudentPanel();
assert.strictEqual(panel.parentElement,admin,'The active Beheer panel belongs to Beheer');

assert.match(renderer, /const classView = document\.querySelector\('\[data-teacher-view="classes"\]'\)/);
assert.match(renderer, /document\.body\.classList\.contains\('bb-teacher-v31'\) && classView/);
assert.match(renderer, /host\.append\(panel\)/);
assert.match(teacher, /place\(dashboard\.querySelector\('\.teacher-layout__classes'\), classes\)/);
assert.match(css, /body\.bb-teacher-v31 \.bb-teacher-v31-view\[hidden\] \{ display: none !important;/);
console.log('Docenten v3.1 leerlingbeheer: juiste rol, dynamische herbouw en veilige DOM-plaatsing.');
