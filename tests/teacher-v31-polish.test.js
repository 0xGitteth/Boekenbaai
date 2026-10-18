'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const teacher=read('public/teacher-modern.js');
const css=read('public/teacher-v31-polish.css');
const html=read('public/staff.html');
const student=read('public/student-detail.js');
const loans=read('public/staff-loans.js');
const hardening=read('public/release-ui-hardening.js');

const moduleSyntax = teacher.replaceAll('import.meta', '({ env: {} })');
new vm.Script(moduleSyntax);
new vm.Script(student);
new vm.Script(loans.replaceAll('import.meta', '({ env: {} })'));
new vm.Script(hardening);

assert.doesNotMatch(teacher,/card\('Snel naar'\)/);
assert.match(teacher,/grid\.append\(classesCard, taskCard, recent\)/);
assert.match(css,/#bb-teacher-v31-activity \{\s*grid-column: 1/);
assert.match(teacher,/\.textContent\?\.trim\(\)\.split\(\/\\s\+\/\)\[0\]/);
assert.match(teacher,/const content = document\.getElementById\('staff-book-overview-content'\)/);
assert.match(teacher,/if \(content\) content\.hidden = false/);
assert.match(hardening,/if \(document\.body\.classList\.contains\('bb-teacher-v31'\)\) return;/);
assert.match(css,/\[data-teacher-view="catalog"\] > \.panel__header--staff\s*\{\s*display: none !important/);
assert.match(css,/\[data-teacher-view="catalog"\] #book-grid\s*\{[^}]*grid-template-columns: repeat\(3/);
assert.match(html,/href="teacher-v31-polish\.css"/);
assert.match(html,/id="staff-loan-filter"><option value="">Al mijn klassen/);
assert.match(loans,/document\.body\.classList\.contains\('bb-teacher-v31'\)\s*\?\s*'Al mijn klassen'/);
assert.match(css,/\[data-teacher-view="lending"\] #staff-loan-form\s*\{[^}]*repeat\(2,/);
assert.match(css,/\[data-teacher-view="lending"\] #staff-loan-current\s*\{[^}]*overflow-y: auto/);
assert.match(css,/\.student-detail__danger,\s*body\.bb-teacher-v31 \.student-management__danger-button\s*\{[^}]*background: #b42337 !important/);
assert.match(student,/const staticField = make\('div', \{ className: 'student-detail__field student-detail__read-only' \}\)/);
assert.match(student,/De beheerder kan deze schoolgegevens aanpassen/);
assert.match(student,/const underlying = findUnderlyingAction\(row, 'Van school'\)/);
assert.match(student,/dialog\.close\(\);\s*underlying\?\.click\(\)/);
assert.match(css,/\[data-teacher-view="account"\] #book-import-mail-mode-form\s*\{[^}]*grid-template-columns: repeat\(2,/);
assert.match(css,/\[data-teacher-view="account"\] #book-import-mail-request-form\[hidden\],[\s\S]*?display: none !important/);
assert.match(html,/>Waar wil je herinneringen ontvangen\?<\/h3>/);
assert.match(html,/>Alternatief e-mailadres<\/h3>/);

// Behavioral test: selecting the dedicated catalog genuinely expands the
// old overview; switching pages keeps exactly one visible child.
const start=teacher.indexOf('  function setPage(next, focus = true) {');
const end=teacher.indexOf('  function card(title, destination, description) {', start);
assert.ok(start>0&&end>start);
const names=['start','classes','catalog','lending','tasks','account'];
const panels=Object.fromEntries(names.map(name=>[name,{
  hidden: false, querySelector(){return {focus(){}};},
}]));
const content={hidden:true}, toggle={aria:{},setAttribute(name,value){this.aria[name]=value;}};
const navButtons=names.map(name=>({
  dataset:{teacherPage:name}, classList:{toggle(){}},
  setAttribute(){}, removeAttribute(){},
}));
const nav={querySelectorAll(){return navButtons;}};
const classes=new Set(), state={};
const doc={getElementById(id){return {
  'staff-book-overview-content':content,
  'staff-book-overview-toggle':toggle,
}[id];}};
const sandbox={active:true,panels,nav,document:doc,window:{scrollTo(){},dispatchEvent(){}},
  Event:class {constructor(name){this.type=name;}}, updateStart(){},closeMenu(){},page:'',};
new vm.Script(teacher.slice(start,end)+'\nthis.run=setPage;').runInNewContext(sandbox);
sandbox.run('catalog',false);
assert.equal(content.hidden,false);
assert.equal(toggle.aria['aria-expanded'],'true');
assert.equal(panels.catalog.hidden,false);
assert.equal(panels.start.hidden,true);
sandbox.run('classes',false);
assert.equal(panels.catalog.hidden,true);
assert.equal(panels.classes.hidden,false);

// Teachers have static labelled details, admins retain editable fields.
const fieldStart=student.indexOf('  function field(label, control,');
const fieldEnd=student.indexOf('  function findUnderlyingAction',fieldStart);
assert.ok(fieldStart>0&&fieldEnd>fieldStart);
const fakeMake=(tag,opts={})=>({tag,opts,children:[],append(...nodes){this.children.push(...nodes);}});
const ctx={make:fakeMake, ADMIN_HELP:'Alleen beheer'};
new vm.Script(student.slice(fieldStart,fieldEnd)+'\nthis.createField=field;').runInNewContext(ctx);
const control={value:'Klas X',disabled:false};
const readOnly=ctx.createField('Klas',control,{locked:true});
assert.equal(readOnly.tag,'div');
assert.equal(readOnly.children[1].tag,'p');
assert.equal(readOnly.children[1].opts.text,'Klas X');
assert.equal(control.disabled,false,'Read-only view must not modify an input');
const adminField=ctx.createField('Klas',control,{locked:false});
assert.equal(adminField.tag,'label');
assert.equal(adminField.children[1],control);

// Styling must not bleed into management when a teacher is not logged in.
// CSS @media blocks are explicitly allowed to contain additional scoped rules.
for(const line of css.split('\n').filter(x=>x.trim().startsWith('body.'))) {
  assert.match(line,/^\s*body\.bb-teacher-v31 /,'Unscoped selector: '+line);
}

console.log('Docentenpolish v3.1: catalogus, begroeting, afmeldknop, leerlingdetails, uitlenen en account getest.');
