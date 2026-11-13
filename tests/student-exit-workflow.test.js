'use strict';
const assert=require('node:assert/strict');
const { studentHasLibraryData,transitionMissingStudent,exitTaskSummary,
  completeExitTask,cancelReturnedStudents }=require('../student-exit-workflow');
function base() {
  return {
    students:[{id:'s1',name:'Oud Leerling',firstName:'Oud',lastName:'Leerling',
      username:'123',passwordHash:'x',active:true,
      parnassysStudentNumber:'123',externalIds:{parnassys:'123'},
      classIds:['c1'],borrowedBooks:[]}],
    classes:[{id:'c1',name:'Structuur BB',studentIds:['s1'],
      teacherIds:['t1']}],
    books:[],readingRecords:[],examReadingLists:[],history:[],studentExitTasks:[],
  };
}
function auth() {
  return {sessions:[{type:'student',userId:'s1',tokenHash:'secret'}],
    links:[{accountType:'student',accountId:'s1',email:'test@example.org'}],
    studentPins:[{studentId:'s1',pinHash:'hash'}],
    linkRequests:[{studentId:'s1',status:'pending'}]};
}
const teacher={id:'t1',role:'teacher'};
const otherTeacher={id:'t2',role:'teacher'};
const admin={id:'admin',role:'admin'};
// Empty accounts may be removed, including authentication data.
{
  const db=base(),store=auth();
  assert.equal(studentHasLibraryData(db,db.students[0]),false);
  assert.equal(transitionMissingStudent(db,store,db.students[0]).action,'delete');
  assert.equal(db.students.length,1,'Preview does not modify original');
  const applied=transitionMissingStudent(db,store,db.students[0],{apply:true});
  assert.equal(applied.action,'deleted');
  assert.equal(db.students.length,0);
  assert.deepEqual(db.classes[0].studentIds,[]);
  assert.equal(store.sessions.length,0);
  assert.equal(store.links.length,0);
  assert.equal(store.studentPins.length,0);
  assert.equal(store.linkRequests.length,0);
  assert.equal(db.studentExitTasks.length,0);
}
// Reading data keeps the account, but no current class membership.
{
  const db=base(),store=auth();
  db.readingRecords.push({id:'r1',subjectType:'student',subjectId:'s1',
    bookId:'b1',finished:true});
  assert.equal(studentHasLibraryData(db,db.students[0]),true);
  const applied=transitionMissingStudent(db,store,db.students[0],{apply:true,actorId:'admin'});
  assert.equal(applied.action,'archived');
  assert.equal(db.students[0].active,false);
  assert.deepEqual(db.students[0].classIds,[]);
  assert.deepEqual(db.classes[0].studentIds,[]);
  assert.equal(db.readingRecords.length,1);
  assert.equal(store.sessions.length,0);
  assert.equal(store.links.length,1,'Verified Google mapping retained for archived account');
  assert.equal(exitTaskSummary(db,otherTeacher).length,0,
    'Unrelated teacher cannot access historical pupil');
  assert.equal(exitTaskSummary(db,teacher).length,1);
  assert.equal(exitTaskSummary(db,admin).length,1);
  assert.equal(exitTaskSummary(db,teacher)[0].lastClasses[0].name,'Structuur BB');
  assert.equal(completeExitTask(db,otherTeacher,applied.taskId,1).status,403);
  assert.equal(completeExitTask(db,teacher,applied.taskId,1).ok,true);
  assert.equal(completeExitTask(db,teacher,applied.taskId,1).status,409);
  assert.equal(exitTaskSummary(db,teacher)[0].status,'completed');
  assert.equal(db.students[0].active,false);
  assert.equal(db.readingRecords.length,1);
}
// Active loans stay intact and block closing a task until the book is returned.
{
  const db=base(),store=auth();
  db.books.push({id:'b1',title:'Boek',status:'borrowed',borrowedBy:'s1'});
  db.students[0].borrowedBooks=[{bookId:'b1'}];
  const applied=transitionMissingStudent(db,store,db.students[0],{apply:true});
  assert.equal(applied.action,'archived');
  assert.equal(db.books[0].borrowedBy,'s1');
  assert.equal(completeExitTask(db,teacher,applied.taskId,1).error,
    'student_still_has_books');
  db.books[0].borrowedBy=null;
  db.students[0].borrowedBooks=[];
  assert.equal(completeExitTask(db,admin,applied.taskId,1).ok,true);
}
// Unknown data fields and future durable references always prevent automatic
// deletion. A library can add new data collections without leaking history.
{
  const db=base(),store=auth();
  db.students[0].myNewReadingData={progress:10};
  assert.equal(studentHasLibraryData(db,db.students[0]),true);
  delete db.students[0].myNewReadingData;
  db.unknownFutureCollection=[{studentId:'s1',content:'important'}];
  assert.equal(studentHasLibraryData(db,db.students[0]),true);
}
// An archived student who returns to the ParnasSys export no longer has an
// open exit task. The historical task remains in the audit collection.
{
  const db=base(),store=auth();
  db.examReadingLists.push({studentId:'s1',title:'Boek'});
  transitionMissingStudent(db,store,db.students[0],{apply:true});
  db.students[0].active=true;
  cancelReturnedStudents(db);
  assert.equal(db.studentExitTasks[0].status,'cancelled');
  assert.equal(exitTaskSummary(db,teacher)[0].status,'cancelled');
}
console.log('Student exits: conservative removal, retained history, former teacher access, loans and reactivation OK');
