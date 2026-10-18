'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const teacher=read('public/teacher-modern.js');
const students=read('public/student-management.js');
const html=read('public/staff.html');
const css=read('public/teacher-v31-polish.css');
new vm.Script(teacher.replaceAll('import.meta','({env:{}})'),{filename:'teacher-modern.js'});
new vm.Script(students,{filename:'student-management.js'});
assert.doesNotMatch(html,/placeholder="voornaam\.achternaam"/);
assert.match(html,/Kies waar je e-mails over openstaande taken ontvangt/);
assert.match(teacher,/const taskCard = card\('Taken voor mij', 'tasks'\)/);
assert.match(students,/text: 'Taken voor jou'/);
assert.match(teacher,/tasks\.append\(transferPanel\)/);
assert.match(teacher,/place\(document\.getElementById\('book-import-followups-panel'\), tasks\)/);
assert.match(teacher,/boekenbaai:mentor-tasks-refresh/);
assert.match(students,/boekenbaai:mentor-tasks-refresh/);
assert.match(students,/boekenbaai:mentor-select-class/);
assert.match(teacher,/importTaskCount \+ mentorTaskCount/);
assert.match(teacher,/\/api\/staff\/book-import-followups/);
assert.match(css,/#staff-loan-form > \.form-field:last-child\s*\{\s*grid-column: 1 \/ -1/);
assert.match(css,/#staff-loan-submit\s*\{[^}]*text-align: center/);
assert.match(css,/\.bb-teacher-v31-date-wrap\s*\{[^}]*position: relative/);
assert.match(css,/\.bb-teacher-v31-date-wrap:focus-within\s*\n\.bb-teacher-v31-date-preview/);
assert.match(teacher,/const match = due\.value\.match\(\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$\/\)/);

function element(tag,cls='',body='') {
  return {tag,className:cls,textContent:body,children:[],handlers:{},attributes:{},
    append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=[...nodes];},
    addEventListener(type,fn){this.handlers[type]=fn;},
    setAttribute(key,val){this.attributes[key]=val;},
    querySelectorAll(){return [];},
    classList:{toggle(){}},
  };
}
const classState={
  role:'teacher',
  classes:[
    {id:'c1',name:'Klas A',isOwn:true},
    {id:'c2',name:'Klas B',isOwn:true},
  ],
  incoming:[
    {toClassId:'c1',status:'pending',studentName:'Verborgen leerling'},
    {toClassId:'c2',status:'pending'},
  ],
  outgoing:[{fromClassId:'c1',status:'pending'}],
  googleRequests:[{classNames:['Klas A']},{classNames:['Klas B']}],
};
const emitted=[];
const publishStart=students.indexOf('  function publishTeacherTasks(status) {');
const publishEnd=students.indexOf('  async function refresh() {',publishStart);
assert.ok(publishStart>0 && publishEnd>publishStart);
const ctx=vm.createContext({state:classState,
  document:{body:{classList:{contains(name){return name==='bb-teacher-v31';}}}},
  ownClasses:()=>classState.classes,
  incomingForClass:klass=>classState.incoming.filter(x=>x.toClassId===klass.id),
  outgoingForClass:klass=>classState.outgoing.filter(x=>x.fromClassId===klass.id),
  googleRequestsForClass:klass=>classState.googleRequests.filter(x=>x.classNames.includes(klass.name)),
  window:{dispatchEvent(ev){emitted.push(ev);}},
  CustomEvent:class {constructor(type,props){this.type=type;this.detail=props.detail;}},
});
new vm.Script(students.slice(publishStart,publishEnd)+'\nthis.publish=publishTeacherTasks;').runInContext(ctx);
ctx.publish('ready');
assert.equal(emitted.length,1);
assert.equal(emitted[0].type,'boekenbaai:mentor-tasks-updated');
assert.deepEqual(JSON.parse(JSON.stringify(emitted[0].detail.classes)),[
  {id:'c1',name:'Klas A',incoming:1,google:1,outgoing:1},
  {id:'c2',name:'Klas B',incoming:1,google:1,outgoing:0},
]);
assert.ok(!JSON.stringify(emitted[0].detail).includes('Verborgen leerling'),
  'Teacher dashboard must only receive class-level counts, not student identity');

const taskStart=teacher.indexOf('  function renderMentorTasks() {');
const taskEnd=teacher.indexOf('  function installLoanDuePreview()',taskStart);
assert.ok(taskStart>0&&taskEnd>taskStart);
const taskHost=element('section');
let navigated='',chosen=null;
const taskDoc={getElementById(id){return id==='bb-teacher-v31-mentor-tasks'?taskHost:null;}};
const taskCtx=vm.createContext({document:taskDoc,el:element,
  taskSummary:{status:'ready',classes:emitted[0].detail.classes},
  window:{dispatchEvent(event){chosen=event.detail.classId;}},
  CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
  setPage(name){navigated=name;},
});
new vm.Script(teacher.slice(taskStart,taskEnd)+'\nthis.render=renderMentorTasks;').runInContext(taskCtx);
taskCtx.render();
assert.equal(taskHost.children.length,6,'Heading plus 5 assigned task categories');
const buttons=taskHost.children.slice(1);
assert.equal(buttons.filter(b=>b.tag==='button').length,5);
buttons[0].handlers.click();
assert.equal(navigated,'classes');
assert.equal(chosen,'c1');
assert.equal(buttons[0].children[1].textContent,'Behandelen');
taskCtx.taskSummary={status:'ready',classes:[]};
taskCtx.render();
assert.match(taskHost.children[1].textContent,/Geen openstaande/);

const dateStart=teacher.indexOf('  function installLoanDuePreview() {');
const dateEnd=teacher.indexOf('  function clearClassSummary() {',dateStart);
assert.ok(dateStart>0&&dateEnd>dateStart);
const due={dataset:{},value:'2026-10-17',handlers:{},before(node){this.parent=node;},
 addEventListener(name,fn){this.handlers[name]=fn;}};
const dateCtx=vm.createContext({
 document:{getElementById(id){return id==='staff-loan-due'?due:null;}},
 el:element,
});
new vm.Script(teacher.slice(dateStart,dateEnd)+'\nthis.install=installLoanDuePreview;').runInContext(dateCtx);
dateCtx.install();
assert.equal(due.parent.children[0],due);
const datePreview=due.parent.children[1];
assert.equal(datePreview.textContent,'17-10-2026');
due.value='';due.handlers.change();
assert.equal(datePreview.textContent,'dd-mm-jjjj');
due.value='2026-12-03';due.handlers.input();
assert.equal(datePreview.textContent,'03-12-2026');
console.log('Teacher tasks, class transfer counts, date overlay, button alignment and email placeholder regressions OK');
