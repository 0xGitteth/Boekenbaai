// Boekenbaai v47: actual task counts, compact staff catalog and centred profile.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
const staff=file('public/staff.html');
const student=file('public/index.html');
const app=file('public/app.js');
const teacher=file('public/teacher-modern.js');
const css=file('public/portal-refine-v47.css');

const lastCss = html=>[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].at(-1)?.[1];
assert.equal(lastCss(staff),'portal-refine-v47.css');
assert.equal(lastCss(student),'portal-refine-v47.css');
const ids=[
'staff-filter-toggle','staff-filter-label','bb-cat-filter-caption','bb-cat-reset',
'bb-cat-advanced','bb-cat-language','bb-cat-availability','bb-cat-easy','bb-cat-exam',
'staff-book-sort-select','summary','book-grid','theme-filter-pills','search-input',
'bb-cat-page-range','bb-cat-page-output','bb-cat-unknown'
];
for(const id of ids)assert.equal((staff.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
  'Staff catalogue must preserve exactly one live control '+id);
assert.match(staff,/class="bb-staff-discovery-layout"/);
assert.match(staff,/class="bb-catalog-filter-panel bb-staff-compact-filters"/);
assert.match(staff,/<button type="button" id="staff-filter-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="bb-cat-advanced"/);
assert.match(staff,/<summary class="bb-cat-advanced-toggle" hidden>/);
assert.match(staff,/class="bb-staff-sort-row"/);
assert.match(staff,/class="bb-staff-filter-actions"/);
assert.match(staff,/<h3 id="staff-catalog-title" class="visually-hidden">Boekenoverzicht<\/h3>/);
const panel=staff.indexOf('<section class="bb-catalog-filter-panel bb-staff-compact-filters"');
const details=staff.indexOf('<details class="bb-cat-advanced"',panel);
const results=staff.indexOf('<div class="bb-cat-results">',panel);
const sort=staff.indexOf('<div class="bb-staff-sort-row">',panel);
const bookGrid=staff.indexOf('<div class="book-grid" id="book-grid">',panel);
assert.ok(panel>0&&panel<results&&results<details&&details<sort&&sort<bookGrid,
  'Staff search/legend above advanced filters; separate book panel below');
const staffForm=staff.slice(staff.indexOf('<div class="bb-cat-advanced-content">'),
   staff.indexOf('</details>',staff.indexOf('<div class="bb-cat-advanced-content">')));
const studentForm=student.slice(student.indexOf('<div class="bb-cat-advanced-content">'),
   student.indexOf('</details>',student.indexOf('<div class="bb-cat-advanced-content">')));
assert.equal(staffForm.replace(/\s+/g,' ').trim(),studentForm.replace(/\s+/g,' ').trim(),
  'Staff and student keep identical existing advanced filter fields');
assert.match(app,/staffFilterToggle\?\.addEventListener\('click'/);
assert.match(app,/staffFilterToggle\?\.setAttribute\('aria-expanded', String\(expanded\)\)/);
assert.match(app,/staffFilterLabel\.textContent = expanded \? 'Filters verbergen' : 'Filters tonen'/);
assert.match(app,/catalogReset\?\.addEventListener\('click'/);
assert.match(css,/#staff-book-overview-content \.bb-staff-compact-filters #bb-cat-advanced:not\(\[open\]\) \{\s*display:none!important;/);
assert.match(css,/#staff-book-overview-content \.bb-staff-compact-filters #bb-cat-advanced\[open\] \+ \.bb-staff-sort-row \{\s*display:flex!important;/);
assert.match(css,/#staff-book-overview-content \.bb-catalog-v36 #book-grid \{[\s\S]*?background:#fff!important;/);
assert.match(css,/#staff-book-overview-content \.bb-staff-discovery-layout \{[\s\S]*?background:#fff!important;/);
assert.match(css,/@media\(max-width:600px\)/);

assert.match(student,/Examenleeslijst bekijken/);
assert.doesNotMatch(student,/<strong>Mijn account<\/strong><\/div><span aria-hidden="true">⌑<\/span>/,
  'Guest preview should name a real book category, not a generic account card');
assert.match(css,/#student-profile-view:not\(\[hidden\]\):has\(> #student-login-panel:not\(\.hidden\)\)/);
assert.match(css,/#student-profile-view:not\(\[hidden\]\):has\(> #student-staff-session:not\(\.hidden\)\)/);
assert.match(css,/justify-content:center!important;/);
assert.match(css,/@media\(max-height:590px\)/);
assert.match(student,/<section id="student-staff-session" class="bb-student-staff-session hidden"/);
assert.match(student,/<form id="student-login-form"/);

// Dashboard task actions derive from actual mentor and book-import counts,
// not static links to task pages. A failed request must not become "no tasks".
assert.doesNotMatch(teacher,/addAction\(taskCard, 'Klaswissels en koppelingen'/);
assert.doesNotMatch(teacher,/addAction\(taskCard, 'Boekimportcontroles'/);
assert.match(teacher,/taskCard\.id = 'bb-teacher-v31-tasks-summary'/);
assert.match(teacher,/function renderDashboardTasks\(\) \{/);
assert.match(teacher,/Je hebt momenteel geen openstaande taken\./);
assert.match(teacher,/importTaskCount = Number\.isSafeInteger\(taskData\.summary\?\.open\)/);
assert.match(teacher,/mentorTaskCount = taskSummary\.status === 'ready'/);
assert.match(teacher,/importTaskError = true;/);
assert.match(teacher,/renderDashboardTasks\(\);/);

const start=teacher.indexOf('  function renderDashboardTasks() {');
const end=teacher.indexOf('  function renderMentorTasks() {',start);
assert.ok(start>0&&end>start,'Extract actual production task rendering');
const taskRenderer=teacher.slice(start,end);
function simulate(mentor,imports,status='ready',importError=false){
  const host={nodes:[],replaceChildren(){this.nodes=[];},append(node){this.nodes.push(node);}};
  const ctx={
    document:{querySelector(sel){assert.equal(sel,'#bb-teacher-v31-tasks-summary .bb-teacher-v31-open-task-list');return host;}},
    taskSummary:{status},mentorTaskCount:mentor,importTaskCount:imports,importTaskError:importError,
    el:(tag,cls,label)=>({tag,cls,label}),
    addAction:(where,title,subtitle,destination)=>where.append({action:true,title,subtitle,destination}),
  };
  vm.runInNewContext(taskRenderer+'\nrenderDashboardTasks();',ctx,{timeout:1000});
  return host.nodes;
}
const noTasks=simulate(0,0);
assert.equal(noTasks.length,1);
assert.match(noTasks[0].label,/Je hebt momenteel geen openstaande taken/);
const two=simulate(3,2);
assert.equal(two.length,2);
assert.deepEqual(two.map(n=>n.title),['Klaswissels en koppelingen','Boekimportcontroles']);
assert.deepEqual(two.map(n=>n.destination),['tasks','tasks']);
const one=simulate(0,4);
assert.equal(one.length,1);
assert.equal(one[0].title,'Boekimportcontroles');
const stillLoading=simulate(0,null);
assert.equal(stillLoading.length,1);
assert.match(stillLoading[0].label,/Taken laden/);
assert.doesNotMatch(stillLoading[0].label,/geen openstaande taken/);
const failed=simulate(0,null,'ready',true);
assert.match(failed[0].label,/Niet alle taken/);
const partiallyKnown=simulate(1,null,'ready',true);
assert.ok(partiallyKnown.some(x=>x.action&&x.title==='Klaswissels en koppelingen'));
assert.ok(partiallyKnown.some(x=>/Niet alle taken/.test(x.label||'')));
console.log('v47: source-backed teacher tasks, compact staff books, centred login and honest reading-list preview OK.');
