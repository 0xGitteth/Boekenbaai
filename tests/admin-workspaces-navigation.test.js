'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'public',name),'utf8');
const code=read('admin-workspaces.js');
new vm.Script(code,{filename:'admin-workspaces.js'});
const styles=read('admin-workspaces.css');
const html=read('staff.html');
assert.match(html,/href="admin-workspaces\.css"/);
assert.match(html,/type="module" src="admin-workspaces\.js"/);
assert.match(styles,/body\.bb-admin-v31 #admin-dashboard \.bb-workspace-inactive\s*\{\s*display:\s*none !important/);
assert.match(styles,/@media \(max-width: 640px\)/);
assert.match(styles,/data-bb-task-section="physical"/);
assert.match(styles,/data-bb-task-section="administration"/);
assert.match(styles,/data-bb-task-section="classes"/);
assert.match(styles,/data-bb-task-section="accounts"/);
assert.doesNotMatch(code,/\bfetch\s*\(|\bXMLHttpRequest\b|POST|DELETE|approveJob/,
  'The navigation must never start imports, searches, or data mutations');
assert.match(read('admin-book-import-review.js'),
  /enrichmentExtra\.closest\('\[data-bb-import-pane="enrichment"\]'\)/,
  'A running import must not suppress the separate enrichment subpage');
assert.match(read('uiux-v32.js'),/button\('Openstaande taken', 'tasks'/);
assert.match(read('uiux-v32.js'),/button\('Excel importeren', 'import'/);

let doc;
class Element {
  constructor(tag='',className='',id=''){
    this.tagName=tag;this.className=className;this.id=id;this.dataset={};
    this.children=[];this.parentNode=null;this.attributes={};
    this.listeners={};this.tabIndex=0;this.hidden=false;this.textContent='';
    this.classList={
      contains:token=>this.className.split(/\s+/).includes(token),
      add:token=>{if(!this.classList.contains(token))
        this.className=[this.className,token].filter(Boolean).join(' ');},
      remove:token=>{this.className=this.className.split(/\s+/)
        .filter(x=>x!==token).join(' ');},
      toggle:(token,active)=>{
        if(active===undefined)active=!this.classList.contains(token);
        if(active)this.classList.add(token);
        else this.classList.remove(token);
        return active;
      },
    };
  }
  append(...nodes) {
    for(const node of nodes){
      if(node.parentNode)node.parentNode.children=
        node.parentNode.children.filter(n=>n!==node);
      this.children.push(node);
      node.parentNode=this;
    }
  }
  insertBefore(node,reference) {
    if(node.parentNode)node.parentNode.children=
      node.parentNode.children.filter(x=>x!==node);
    const index=this.children.indexOf(reference);
    assert.notEqual(index,-1,'insertBefore reference must exist');
    this.children.splice(index,0,node);node.parentNode=this;
  }
  after(node) {
    assert.ok(this.parentNode,'after requires parent');
    const siblings=this.parentNode;
    if(this===siblings.children.at(-1)){siblings.append(node);return;}
    siblings.insertBefore(node,siblings.children[siblings.children.indexOf(this)+1]);
  }
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  click(){for(const fn of this.listeners.click||[])fn({target:this});}
  focus(){doc.activeElement=this;}
  contains(other){let cur=other;while(cur){if(cur===this)return true;cur=cur.parentNode;}return false;}
  matches(selector){
    if(selector.startsWith('#'))return this.id===selector.slice(1);
    if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
    if(selector==='[data-workspace-count]')return this.dataset.workspaceCount!==undefined;
    if(selector.startsWith('[data-'))return false;
    return false;
  }
  querySelector(selector){
    const walk=parent=>{
      for(const child of parent.children){
        if(child.matches(selector))return child;
        const result=walk(child);if(result)return result;
      }
      return null;
    };
    return walk(this);
  }
  closest(selector) {
    let node=this;
    while(node){if(node.matches(selector))return node;node=node.parentNode;}
    return null;
  }
}
const e=(tag='section',cl='',id='')=>new Element(tag,cl,id);
const admin=e('div','','admin-dashboard');
const importsView=e('section','admin-modern__view');importsView.dataset.adminModernView='imports';
const tasksView=e('section','admin-modern__view');tasksView.dataset.adminModernView='tasks';
admin.append(importsView,tasksView);
const card=e('section','admin-card admin-card--imports');
importsView.append(card);
const content=e('div','', 'admin-card-imports-content');card.append(content);
const reviewed=e('section','bb-review','reviewed-import-panel');
const extra=e('details','bb-import__extras');
extra.hidden=true;reviewed.append(extra);content.append(reviewed);
const legacy=e('details','bb-review__legacy');legacy.hidden=true;
const oldBook=e('section','admin-card__section--import');
oldBook.append(e('form','','book-import-form'));legacy.append(oldBook);content.append(legacy);
const students=e('section','admin-card__section--import');
const studentForm=e('form','','student-import-form');studentForm.value='ongewijzigd';
students.append(studentForm);content.append(students);
const teachers=e('section','admin-card__section--import');
teachers.append(e('form','','teacher-import-form'));content.append(teachers);
const bookHost=e('div','','bb-admin-v31-tasks');tasksView.append(bookHost);
const bookPanel=e('section','panel','','');bookPanel.id='book-import-followups-panel';
bookPanel.dataset.deferredCount='8';bookPanel.dataset.deferredBooksCount='5';
bookHost.append(bookPanel);
const badge=e('span','','book-import-followups-badge');badge.textContent='29';
bookPanel.append(badge);
const deferred=e('section','','book-import-deferred-books');bookPanel.append(deferred);
const assignment=e('section','','book-import-assignment-tasks');bookPanel.append(assignment);
const classList=e('div','','book-import-followups-list');bookPanel.append(classList);
const studentExit=e('section','','student-exit-tasks-panel');bookHost.append(studentExit);
const teacherExit=e('section','','teacher-exit-tasks-panel');tasksView.append(teacherExit);
const accountLinks=e('section','bb-admin-v31-card');
accountLinks.append(e('div','bb-admin-v31-task-actions'));tasksView.append(accountLinks);
const viewByName=new Map([['imports',importsView],['tasks',tasksView]]);
const events=new Map();
doc={
  readyState:'complete',
  body:admin,activeElement:null,
  querySelector(selector){
    const match=/^\#admin-dashboard \[data-admin-modern-view="([^"]+)"\]$/.exec(selector);
    if(match)return viewByName.get(match[1])||null;
    if(selector==='#book-import-followups-panel')return bookPanel;
    if(selector==='#book-import-followups-badge')return badge;
    return admin.querySelector(selector);
  },
  getElementById(id){return id==='admin-dashboard'?admin:admin.querySelector('#'+id);},
  createElement(tag){return e(tag);},
  addEventListener(type,fn){(events.get(type)??events.set(type,[]).get(type)).push(fn);},
};
const win={addEventListener(type,fn){
  (events.get(type)??events.set(type,[]).get(type)).push(fn);
}};
const observers=[];
class Observer{
  constructor(fn){this.fn=fn;this.disconnected=false;observers.push(this);}
  observe(){}
  disconnect(){this.disconnected=true;}
}
vm.runInNewContext(code,{document:doc,window:win,MutationObserver:Observer,
  location:{hash:''},console},{timeout:2500});

assert.equal(importsView.dataset.bbWorkspacesReady,'true');
assert.equal(tasksView.dataset.bbWorkspacesReady,'true');
assert.equal(reviewed.parentNode,content,'Real import stage must not be recreated');
assert.equal(extra.parentNode.id,'bb-import-workspace-enrichment',
  'The original enrichment controls should be moved, never copied');
assert.equal(studentForm.value,'ongewijzigd');
assert.equal(legacy.hidden,true,'Dangerous technical fallback must stay hidden');
const importNav=importsView.querySelector('.bb-workspace-tabs');
const importButtons=importNav.children;
assert.equal(importButtons.length,4);
assert.equal(importsView.dataset.bbImportSection,'books');
assert.equal(importButtons[0].getAttribute('aria-selected'),'true');
assert.equal(students.parentNode.classList.contains('bb-workspace-inactive'),true);
assert.equal(extra.hidden,false);
importButtons[1].click();
assert.equal(importsView.dataset.bbImportSection,'enrichment');
assert.equal(extra.open,true,'Brave status is visible without paid approval');
assert.equal(reviewed.classList.contains('bb-workspace-inactive'),true);
assert.equal(reviewed.parentNode,content);
importButtons[2].click();
assert.equal(importsView.dataset.bbImportSection,'students');
assert.equal(studentForm.value,'ongewijzigd');
assert.equal(students.parentNode.classList.contains('bb-workspace-inactive'),false);
importButtons[2].focus();
for(const fn of importNav.listeners.keydown||[])fn({key:'ArrowRight',preventDefault(){}});
assert.equal(importsView.dataset.bbImportSection,'teachers',
  'Arrow navigation must activate the next accessible subpage');
assert.equal(importButtons[3].getAttribute('aria-selected'),'true');
assert.equal(importButtons[2].tabIndex,-1);

// The production ParnasSys script mounts active student/teacher blocks after
// DOMContentLoaded. Their original inputs are hidden but the *live* blocks
// and their attached event handlers must become separate subpages.
const syncContainer=e('div','school-sync__container');
const activeStudent=e('section','school-sync__block');
const activeTeacher=e('section','school-sync__block');
const activeStudentHandler=()=>{};
activeStudent.addEventListener('click',activeStudentHandler);
syncContainer.append(activeStudent,activeTeacher);
content.append(syncContainer);
for(const observer of observers.filter(x=>!x.disconnected))observer.fn([]);
assert.equal(activeStudent.parentNode.id,'bb-import-workspace-students');
assert.equal(activeTeacher.parentNode.id,'bb-import-workspace-teachers');
assert.equal(activeStudent.listeners.click[0],activeStudentHandler,
  'Live ParnasSys handlers must not be replaced');
assert.equal(students.hidden,true,'Old import form must stay hidden');
assert.equal(teachers.hidden,true,'Old teacher form must stay hidden');
assert.equal(syncContainer.hidden,true,'Empty original sync container must not take up space');
importButtons[2].click();
assert.equal(activeStudent.parentNode.classList.contains('bb-workspace-inactive'),false);
assert.equal(activeTeacher.parentNode.classList.contains('bb-workspace-inactive'),true);

const taskNav=tasksView.querySelector('.bb-workspace-tabs');
const taskButtons=taskNav.children;
assert.equal(taskButtons.length,5);
assert.equal(tasksView.dataset.bbTaskSection,'overview');
assert.equal(taskButtons[1].querySelector('[data-workspace-count]').textContent,'5');
assert.equal(taskButtons[2].querySelector('[data-workspace-count]').textContent,'8');
assert.equal(taskButtons[3].querySelector('[data-workspace-count]').textContent,'16');
taskButtons[1].click();
assert.equal(tasksView.dataset.bbTaskSection,'physical');
assert.equal(bookHost.classList.contains('bb-workspace-inactive'),false);
assert.equal(teacherExit.classList.contains('bb-workspace-inactive'),true);
taskButtons[4].click();
assert.equal(tasksView.dataset.bbTaskSection,'accounts');
assert.equal(accountLinks.classList.contains('bb-workspace-inactive'),false);
assert.equal(bookPanel.parentNode,bookHost,'Shared task panel must remain mounted');
assert.equal(deferred.parentNode,bookPanel,'Physical book tasks must retain owners');
bookPanel.dataset.deferredBooksCount='7';
badge.textContent='31';
for(const fn of events.get('boekenbaai:deferred-books-changed')||[])fn();
assert.equal(taskButtons[1].querySelector('[data-workspace-count]').textContent,'7');
assert.equal(taskButtons[3].querySelector('[data-workspace-count]').textContent,'16');
console.log('Admin workspaces: existing forms preserved, four import tabs, five task tabs, counts and keyboard navigation OK');
