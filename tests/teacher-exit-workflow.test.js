'use strict';
const assert=require('node:assert/strict');
const {
  teacherHasData,transitionMissingTeacher,teacherExitTaskSummary,
  completeTeacherExitTask,cancelReturnedTeachers,
}=require('../teacher-exit-workflow');

function db(){
  return {users:[{id:'t1',role:'teacher',name:'Oude Docent',
    username:'oud',passwordHash:'secret',active:true,source:'manual-import',
    classIds:['c1']}],
    classes:[{id:'c1',name:'Structuur BB',studentIds:[],teacherIds:['t1']}],
    books:[],history:[],teacherExitTasks:[]};
}
function store(){
  return {sessions:[{type:'staff',userId:'t1'}],
    links:[{accountType:'staff',accountId:'t1',email:'oud@koraaledu.nl'}],
    linkRequests:[{staffId:'t1',status:'pending'}]};
}
const admin={id:'admin',role:'admin'};
const other={id:'t2',role:'teacher'};
{
  const school=db(),auth=store();
  assert.equal(teacherHasData(school,school.users[0]),false);
  assert.equal(transitionMissingTeacher(school,auth,school.users[0]).action,'delete');
  assert.equal(school.users.length,1,'Preview must not mutate user records');
  const x=transitionMissingTeacher(school,auth,school.users[0],{apply:true});
  assert.equal(x.action,'deleted');
  assert.equal(school.users.length,0);
  assert.deepEqual(school.classes[0].teacherIds,[]);
  assert.equal(auth.sessions.length,0);
  assert.equal(auth.links.length,0);
  assert.equal(auth.linkRequests.length,0);
  assert.equal(school.teacherExitTasks.length,0);
}
{
  const school=db(),auth=store();
  school.history=[{type:'student-returned',performedBy:'t1',when:'2026-01-01'}];
  assert.equal(teacherHasData(school,school.users[0]),true);
  const x=transitionMissingTeacher(school,auth,school.users[0],{
    apply:true,actorId:'admin',now:'2026-11-13T00:00:00Z',
  });
  assert.equal(x.action,'archived');
  assert.equal(school.users[0].active,false);
  assert.deepEqual(school.users[0].classIds,[]);
  assert.deepEqual(school.classes[0].teacherIds,[]);
  assert.equal(auth.sessions.length,0);
  assert.equal(auth.links.length,1,'Verified links retained for audit');
  assert.equal(school.history[0].performedBy,'t1');
  assert.equal(school.teacherExitTasks.length,1);
  assert.equal(school.teacherExitTasks[0].lastClasses[0].name,'Structuur BB');
  assert.deepEqual(teacherExitTaskSummary(school,other),[]);
  assert.equal(teacherExitTaskSummary(school,admin).length,1);
  assert.equal(completeTeacherExitTask(school,other,x.taskId,1).status,403);
  assert.equal(completeTeacherExitTask(school,admin,x.taskId,1).ok,true);
  assert.equal(completeTeacherExitTask(school,admin,x.taskId,1).status,409);
  assert.equal(school.users[0].active,false);
}
{
  const school=db(),auth=store();
  school.futureRecords=[{teacherId:'t1',content:'retain'}];
  assert.equal(teacherHasData(school,school.users[0]),true,
    'Unknown future cross-references prevent irreversible deletion');
  transitionMissingTeacher(school,auth,school.users[0],{apply:true});
  school.users[0].active=true;
  cancelReturnedTeachers(school);
  assert.equal(school.teacherExitTasks[0].status,'cancelled');
}
console.log('Teacher exit: safe removal, archive, admin tasks, revoked sessions, reactivation OK');
