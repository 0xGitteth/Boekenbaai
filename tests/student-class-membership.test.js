'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {currentStudentClassIds,currentStudentClassNames,materializeLegacyRosters,setStudentClassMembership}
  =require('../student-class-membership');
const {studentClassIds,mayManageStudent}=require('../book-loan-policy');
const google=require('../google-auth-core');
const {examReadingAccess}=require('../exam-reading-access');
const student={id:'pupil',name:'Leerling',grade:'Oude Klas',
  classIds:['old'],active:true,borrowedBooks:[]};
const db={
  students:[student],
  users:[
    {id:'old-mentor',role:'teacher',classIds:['old'],active:true},
    {id:'new-mentor',role:'teacher',classIds:['new'],active:true},
  ],
  classes:[
    {id:'old',name:'Arbeid',studentIds:[],teacherIds:['old-mentor']},
    {id:'new',name:'Onderbouw BKT',studentIds:['pupil'],teacherIds:['new-mentor']},
  ],
};
const before=JSON.stringify(db);
assert.deepEqual(currentStudentClassIds(db,student),['new'],
  'A current roster must override an outdated pupil classId');
assert.deepEqual(currentStudentClassNames(db,student),['Onderbouw BKT']);
assert.deepEqual(studentClassIds(db,student),['new']);
assert.deepEqual(google.getStudentClassIds(db,student.id),['new'],
  'Google pupil-to-teacher linking cannot restore the previous class');
assert.equal(google.canStaffManageStudent(db,db.users[0],student.id),false,
  'Previous class mentor must not retain access after pupil transfer');
assert.equal(google.canStaffManageStudent(db,db.users[1],student.id),true);
assert.equal(mayManageStudent(db,db.users[0],student),false);
assert.equal(mayManageStudent(db,db.users[1],student),true);
assert.equal(examReadingAccess(db,student).eligible,false,
  'A previous upper-class must not unlock the examination reading list');
assert.equal(JSON.stringify(db),before,'Reading current class must never rewrite pupils');

db.classes[1].studentIds=[];
assert.deepEqual(currentStudentClassIds(db,student),[],
  'An explicitly empty roster must not silently restore an old class');
assert.equal(google.canStaffManageStudent(db,db.users[0],student.id),false,
  'Unassigned pupils do not belong to the previous mentor');
db.classes[0].studentIds=undefined;
assert.deepEqual(currentStudentClassIds(db,student),['old'],
  'Fallback applies only when the named legacy class has no roster');
db.classes[1].studentIds=['pupil'];
db.classes[0].studentIds=undefined;
assert.deepEqual(currentStudentClassIds(db,student),['new'],
  'When a current roster exists it takes precedence over a legacy class');
db.classes[0].studentIds=[];
db.classes[1].studentIds=['pupil'];
db.classes.push({id:'special',name:'OZA',studentIds:['pupil'],teacherIds:[]});
assert.deepEqual(currentStudentClassIds(db,student),['new','special'],
  'Intentionally assigned multiple classes must be retained');

{
  const a={id:'a'},b={id:'b'},c={id:'c',studentIds:['moved']},empty={id:'empty',studentIds:[]};
  const multi={id:'multi',classIds:['a','b','empty']};
  const moved={id:'moved',classIds:['a','b']};
  const unrelated={id:'unrelated',classIds:['a']};
  const target={id:'target',classIds:[]};
  const data={classes:[a,b,c,empty],students:[multi,moved,unrelated,target]};
  const expected=data.students.map(p=>currentStudentClassIds(data,p));
  assert.equal(materializeLegacyRosters(data),true);
  assert.deepEqual(data.students.map(p=>currentStudentClassIds(data,p)),expected);
  assert.deepEqual(a.studentIds,['multi','unrelated']);
  assert.deepEqual(b.studentIds,['multi']);
  assert.deepEqual(empty.studentIds,[]);
  setStudentClassMembership(data,target,['a']);
  assert.deepEqual(currentStudentClassIds(data,multi),['a','b']);
  assert.deepEqual(currentStudentClassIds(data,moved),['c']);
  assert.deepEqual(currentStudentClassIds(data,unrelated),['a']);
  assert.deepEqual(currentStudentClassIds(data,target),['a']);
  setStudentClassMembership(data,moved,[]);
  assert.deepEqual(currentStudentClassIds(data,moved),[],
    'Removing the last current class must not resurrect obsolete legacy IDs');
}
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const server=read('server.js');
const app=read('public/app.js');
const detail=read('student-detail-admin-preload.js');
const sync=read('school-sync-core.js');
assert.match(server,/classNames:currentStudentClassNames\(db,student\)/);
assert.match(server,/classNames:currentStudentClassNames\(database,studentAccount\)/);
assert.match(server,/studentClassIds\(db,student\)\.some\(classId=>teacherClassIds\.includes\(classId\)\)/);
assert.doesNotMatch(app,/Klas \$\{authUser\.grade\}/,
  'Pupil profile must not label an obsolete grade as a current class');
assert.match(app,/authUser\?\.classNames/,
  'Pupil profile must use server-derived current class names');
assert.match(detail,/currentStudentClassIds\(db,student\)/);
assert.match(sync,/currentStudentClassIds\(db,student\)/,
  'School import reconciliation must not favor a previous class');
console.log('Roster-first class membership, exam access and mentoring safety OK');
