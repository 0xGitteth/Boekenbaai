'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root,'public/uiux-v32.js'),'utf8');
const css = fs.readFileSync(path.join(root,'public/uiux-v32.css'),'utf8');
const staff = fs.readFileSync(path.join(root,'public/staff.html'),'utf8');
const student = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const admin = fs.readFileSync(path.join(root,'public/admin-modern.js'),'utf8');
const teacher = fs.readFileSync(path.join(root,'public/teacher-modern.js'),'utf8');
new vm.Script(js, {filename:'uiux-v32.js'});
assert.match(staff,/href="uiux-v32.css"/);
assert.match(staff,/src="uiux-v32.js"/);
assert.doesNotMatch(student,/uiux-v32/, 'Student portal is intentionally out of scope');
assert.match(js,/hero\.insertBefore\(sidebar, actions\)/);
assert.match(js,/sidebar\.classList\.add\('bb-v32-top-nav'\)/);
assert.match(js,/installHeader\(document\.getElementById\('bb-admin-v31-sidebar'\), 'admin'\)/);
assert.match(js,/installHeader\(document\.getElementById\('bb-teacher-v31-sidebar'\), 'teacher'\)/);
assert.match(css,/body\.bb-admin-v31 > main,\s*body\.bb-teacher-v31 > main\s*\{\s*display: block/);
assert.match(css,/#bb-admin-v31-sidebar\.bb-v32-top-nav/);
assert.match(css,/#bb-teacher-v31-sidebar\.bb-v32-top-nav/);
assert.match(css,/@media \(max-width: 760px\)/);
assert.match(js,/classes\.addEventListener\('click', \(\) => chooseAdmin\('people', 'classes'\)\)/);
assert.match(js,/const nameMap = \{[\s\S]*?start:'Overzicht'/);
assert.match(js,/overview\.classList\.add\('bb-v32-dashboard'\)/);
assert.match(js,/grid\.replaceChildren\(shortcuts, activity, tasks, stats\)/);
assert.match(js,/const search = make\('section', 'bb-teacher-v31-card bb-v32-teacher-search'\)/);
assert.match(js,/const lower = make\('div', 'bb-v32-teacher-lower'\)/);
assert.match(js,/new MutationObserver\(render\)\.observe\(grid, \{[\s\S]*?subtree: true,[\s\S]*?attributeFilter: \['src', 'hidden'\]/);
assert.match(css,/\.bb-v32-book-cover\s*\{[^}]*aspect-ratio: 2 \/ 3/);
assert.match(js,/source\.classList\.contains\('book-card--easy-reading'\)/);
assert.match(js,/source\.classList\.contains\('book-card--exam-list'\)/);
assert.match(css,/\.bb-v32-book-preview--easy \.bb-v32-book-cover/);
assert.match(css,/\.bb-v32-book-preview--reading \.bb-v32-book-cover::after/);
assert.match(js,/image\.src = sourceImage\.getAttribute\('src'\)/);
assert.match(js,/source\.click\(\)/);
assert.match(js,/const catalog = document\.getElementById\('search-input'\)/);
assert.match(js,/catalog\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
assert.match(js,/const loanCount = make\('p', 'bb-v32-live-loan-count'\)/);
assert.match(js,/new MutationObserver\(updateLoanCount\)\.observe\(metrics/);

// Test that the actual catalogue supplies the same book cover URL, titles
// and marking flags, and that selection delegates to the existing card.
function el(tag,cls='',txt='') {
  const node = {
    tag, className: cls, textContent: txt,
    children:[], events:{},attrs:{},dataset:{},hidden:false,
    classList:{flags:new Set(cls.split(' ').filter(Boolean)),
      contains(key){return this.flags.has(key);},
      toggle(key,on){if(on)this.flags.add(key);else this.flags.delete(key);}},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=[...items];},
    addEventListener(type,fn){this.events[type]=fn;},
    setAttribute(key,val){this.attrs[key]=val;},
    removeAttribute(key){delete this.attrs[key];},
    getAttribute(key){return this.attrs[key];},
    querySelector(selector){
      const cl=selector.startsWith('.')?selector.slice(1):'';
      return this.children.find(n=>n.classList?.contains(cl))||null;
    },
  };
  return node;
}
const bookGrid=el('div');
const preview=el('div');
let chosen=null;
function book(id,title,author,flag) {
  const cover=el('img');
  cover.hidden=false;
  cover.attrs.src='/covers/'+id+'.jpg';
  const titleNode=el('h3','',''+title);
  const authorNode=el('p','',author);
  const card=el('article','book-card '+flag);
  card.querySelector=selector => ({
    '.book-card__cover':cover,'.book-card__cover-fallback':null,
    '.book-card__title':titleNode,'.book-card__author':authorNode,
  })[selector] ?? null;
  card.click=()=>{chosen=id;};
  return card;
}
let catalogue=[book('one','Boek één','Schrijver A','book-card--easy-reading'),
book('two','Boek twee','Schrijver B','book-card--exam-list')];
bookGrid.querySelectorAll=selector => {
  assert.equal(selector, ':scope > .book-card');return catalogue;
};
let view=null, observerCallback=null, previewInstalled=false;
const ctx=vm.createContext({
  document:{getElementById(id){return id==='book-grid'?bookGrid:
    id==='bb-v32-teacher-books'?preview:null;},createElement:tag=>el(tag)},
  make:el,teacherPreviewInstalled:false,
  chooseTeacher(name){view=name;},
  MutationObserver:class{constructor(callback){observerCallback=callback;}
    observe(target,options){assert.equal(target,bookGrid);
      assert.equal(options.childList,true);
      assert.equal(options.subtree,true);
      assert.equal(options.attributes,true);
      assert.deepEqual(Array.from(options.attributeFilter),['src','hidden']);}},
});
const start=js.indexOf('  function installTeacherBooks() {');
const end=js.indexOf('  function enhanceTeacherDashboard() {',start);
assert.ok(start>0&&end>start);
new vm.Script(js.slice(start,end)+'\nthis.run=installTeacherBooks;').runInContext(ctx);
ctx.run();
assert.equal(preview.children.length,2);
assert.equal(preview.children[0].children[0].children[0].src,'/covers/one.jpg');
assert.equal(preview.children[0].children[1].textContent,'Boek één');
assert.ok(preview.children[0].classList.contains('bb-v32-book-preview--easy'));
assert.ok(preview.children[1].classList.contains('bb-v32-book-preview--reading'));
preview.children[0].events.click();
assert.equal(view,'catalog');
assert.equal(chosen,'one','Existing book card must handle book-detail display');
// A failed preview image must show its placeholder without waiting for
// the catalog's own asynchronous retry.
const firstFrame=preview.children[0].children[0];
const failingPreview=firstFrame.children[0];
failingPreview.events.error();
assert.equal(failingPreview.hidden,true);
assert.equal(firstFrame.children.length,2,'Broken URL displays a fallback, not a broken image');
// The real catalog recovers local URLs via external URL and ultimately
// toggles hidden when both sources fail. Both mutations update the preview.
catalogue[0].querySelector('.book-card__cover').attrs.src='/external/one.jpg';
observerCallback();
assert.equal(preview.children[0].children[0].children[0].src,'/external/one.jpg');
catalogue[0].querySelector('.book-card__cover').hidden=true;
observerCallback();
assert.equal(preview.children[0].children[0].children[0].className,'bb-v32-cover-placeholder');
catalogue=[book('three','Nieuw boek','Schrijver C','')];
observerCallback();
assert.equal(preview.children.length,1);
assert.equal(preview.children[0].children[1].textContent,'Nieuw boek');
ctx.run();
assert.equal(preview.children.length,1,'Avoid installing duplicate preview observers');

// Codex review regression: classes selection must be idempotent across both
// subtab mutation and nav click callbacks, and correctly restore Personen.
const updateStart=js.indexOf('      const updateClasses = () => {');
const updateEnd=js.indexOf('      if (people) people.addEventListener',updateStart);
assert.ok(updateStart>0&&updateEnd>updateStart);
const adminPeopleTab=el('button','admin-modern__tab admin-modern__tab--active');
const classesTab=el('button','admin-modern__tab bb-v32-added-tab');
const peopleView={hidden:false};
let selected='classes';
const classesState=vm.createContext({
  people: adminPeopleTab,
  classes: classesTab,
  document:{querySelector(selector){
    if(selector==='#admin-dashboard [data-admin-modern-view="people"]')return peopleView;
    if(selector==='#admin-dashboard [data-admin-people-tab="classes"]')
      return {getAttribute(){return selected==='classes'?'true':'false';}};
    return null;
  }},
});
new vm.Script(js.slice(updateStart,updateEnd)+'\nthis.update=updateClasses;').runInContext(classesState);
classesState.update();classesState.update();
assert.ok(classesTab.classList.contains('admin-modern__tab--active'));
assert.ok(!adminPeopleTab.classList.contains('admin-modern__tab--active'));
assert.equal(classesTab.attrs['aria-current'],'page');
selected='students';
classesState.update();classesState.update();
assert.ok(adminPeopleTab.classList.contains('admin-modern__tab--active'));
assert.ok(!classesTab.classList.contains('admin-modern__tab--active'));
assert.equal(adminPeopleTab.attrs['aria-current'],'page');
peopleView.hidden=true;
classesState.update();classesState.update();
assert.ok(!adminPeopleTab.classList.contains('admin-modern__tab--active'));
assert.ok(!classesTab.classList.contains('admin-modern__tab--active'));
// CSS regression: injected admin-modern.css is loaded *after* uiux-v32.css in
// production, so added body state + selector specificity is mandatory.
assert.match(js,/document\.body\.classList\.add\('bb-v32-active'\)/);
assert.match(css,/body\.bb-admin-v31\.bb-v32-active > main\s*\{[^}]*display: block/);
assert.match(css,/body\.bb-admin-v31\.bb-v32-active #admin-dashboard\s*\{[^}]*grid-column: auto/);
assert.match(css,/body\.bb-admin-v31\.bb-v32-active #admin-dashboard \.admin-dashboard\s*\{[^}]*max-width: 1440px/);
// P1: mobile header must be a HIGHER stacking context than both body scrims.
assert.match(css,/@media \(max-width: 760px\)\s*\{[\s\S]*?body\.bb-admin-v31\.bb-v32-active \.hero\.hero--staff,[\s\S]*?z-index: 70/);

// Codex P1 regression: DOMTokenList.add throws InvalidCharacterError for
// "class1 class2" passed as one token. Execute the actual call using a strict
// DOMTokenList-compatible mock so the dashboard can finish initialization.
const teacherTokens=js.match(/start\\.classList\\.add\\([^;]+\\);/);
assert.ok(teacherTokens, 'Teacher dashboard must apply the new design classes');
const applied=new Set();
new vm.Script(teacherTokens[0]).runInNewContext({
  start:{classList:{add(...tokens){
    for (const token of tokens) {
      assert.equal(/\\s/.test(token),false,'Every class must be a separate DOM token');
      applied.add(token);
    }
  }}},
});
assert.ok(applied.has('bb-v32-dashboard'));
assert.ok(applied.has('bb-v32-teacher-dashboard'));

// Hero branding and UI scopes remain unchanged for logged-out staff.
assert.doesNotMatch(js,/student-dashboard/);
assert.match(js,/if \(document\.body\.classList\.contains\('bb-admin-v31'\)\)/);
assert.match(js,/if \(document\.body\.classList\.contains\('bb-teacher-v31'\)\)/);
assert.match(admin,/const items = \[/);
assert.match(teacher,/const navItems = \[/);
console.log('Boekenbaai v3.2: header, role nav, reused real covers, 2:3 ratio, search and preserved student scope OK.');
