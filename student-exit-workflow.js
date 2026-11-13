'use strict';

const crypto = require('node:crypto');

// Read-only classroom snapshots are held on the exit task, not in the
// student's CURRENT class membership. No names of deleted pupils are retained.
const ACCOUNT_FIELDS = new Set([
  'id','name','firstName','middleName','lastName','username','passwordHash',
  'mustChangePassword','grade','borrowedBooks','classIds','active','source',
  'parnassysStudentNumber','externalIds','email','schoolEmail','loginEmail',
  'inactiveAt','inactiveReason','inactiveBy','status','createdAt','updatedAt',
  'lastLoginAt','lastSeenAt','pinSetAt',
]);
const IGNORE_REFERENCE_COLLECTIONS = new Set([
  'students','classes','revokedStudentSessions','studentExitTasks',
  'studentExitTaskHistory',
]);

function isNonempty(value) {
  if (value == null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.some(isNonempty);
  if (typeof value === 'object') return Object.values(value).some(isNonempty);
  return true;
}
function refsStudent(value,id,depth=0) {
  if (depth>25 || value==null) return false;
  if (typeof value === 'string') return value === id;
  if (Array.isArray(value)) return value.some(item=>refsStudent(item,id,depth+1));
  if (typeof value !== 'object') return false;
  return Object.entries(value).some(([key,entry])=>key===id||refsStudent(entry,id,depth+1));
}
function activeLoans(db,student) {
  if (Array.isArray(student.borrowedBooks)&&student.borrowedBooks.length) return true;
  return (db.books||[]).some(book => book?.borrowedBy===student.id);
}
function studentHasLibraryData(db,student) {
  if (!student?.id) return true; // Fail closed.
  if (activeLoans(db,student)) return true;
  if (Object.entries(student).some(([key,value])=>!ACCOUNT_FIELDS.has(key)&&isNonempty(value)))
    return true;
  // Count all durable cross-references, including reading records, exam
  // lists, loan history, notifications and unknown future collections.
  // Ignore only the membership/identity collections explicitly named above.
  return Object.entries(db||{}).some(([key,value])=>
    !IGNORE_REFERENCE_COLLECTIONS.has(key)&&refsStudent(value,student.id));
}
function snapshotClasses(db,student) {
  const ids=new Set(Array.isArray(student.classIds)?student.classIds:[]);
  const classes=[];
  for(const klass of db.classes||[]) {
    if ((klass.studentIds||[]).includes(student.id)) ids.add(klass.id);
    if(!ids.has(klass.id)) continue;
    classes.push({
      id:klass.id,name:klass.name||'Onbekende klas',
      teacherIds:Array.isArray(klass.teacherIds)?[...klass.teacherIds]:[],
    });
  }
  for(const id of ids) if(!classes.some(c=>c.id===id))
    classes.push({id,name:'Voormalige klas',teacherIds:[]});
  return classes;
}
function removeCurrentMembership(db,student) {
  for (const klass of db.classes||[])
    if(Array.isArray(klass.studentIds))
      klass.studentIds=klass.studentIds.filter(id=>id!==student.id);
  student.classIds=[];
}
function cleanAccountAuth(store,id) {
  for (const name of ['sessions','links','studentPins','linkRequests','pendingIdentities']) {
    if (!Array.isArray(store?.[name])) continue;
    store[name]=store[name].filter(entry=>
      entry?.studentId!==id&&
      !(entry?.type==='student'&&entry?.userId===id)&&
      !(entry?.accountType==='student'&&entry?.accountId===id));
  }
}
function studentExitTask(db,student,previousClasses,now,actorId) {
  if(!Array.isArray(db.studentExitTasks))db.studentExitTasks=[];
  const existing=db.studentExitTasks.find(task=>task.studentId===student.id
    &&task.status==='open');
  if(existing)return existing;
  const task={
    id:crypto.randomUUID(),studentId:student.id,
    studentName:student.name||'Onbekende leerling',
    lastClasses:previousClasses,
    allowedTeacherIds:[...new Set(previousClasses.flatMap(c=>c.teacherIds))],
    createdAt:now,createdBy:actorId||'school-sync',
    status:'open',resolution:null,completedBy:null,completedAt:null,revision:1,
  };
  db.studentExitTasks.push(task);
  return task;
}
function transitionMissingStudent(db,store,student,{apply=false,actorId='',now=new Date().toISOString()}={}) {
  const previousClasses=snapshotClasses(db,student);
  const hasData=studentHasLibraryData(db,student);
  const loans=activeLoans(db,student);
  if(!apply)return {action:hasData?'archive':'delete',hasData,loans,previousClasses};
  removeCurrentMembership(db,student);
  if (!hasData) {
    db.students=db.students.filter(entry=>entry.id!==student.id);
    cleanAccountAuth(store,student.id);
    return {action:'deleted',hasData:false,loans:false,previousClasses};
  }
  student.active=false;
  student.inactiveAt=now;
  student.inactiveReason='not-in-parnassys-school-list';
  student.inactiveBy=actorId||'school-sync';
  cleanAccountAuth(store,student.id);
  const task=studentExitTask(db,student,previousClasses,now,actorId);
  return {action:'archived',hasData:true,loans,previousClasses,taskId:task.id};
}
function cancelReturnedStudents(db) {
  for (const task of db.studentExitTasks||[]) {
    if(task.status!=='open')continue;
    const student=(db.students||[]).find(s=>s.id===task.studentId);
    if(student?.active!==true)continue;
    task.status='cancelled';task.resolution='returned-to-school';
    task.completedAt=new Date().toISOString();task.revision++;
  }
}
function mayReviewTask(user,task) {
  return Boolean(user&&(user.role==='admin'||
    (user.role==='teacher'&&(task.allowedTeacherIds||[]).includes(user.id))));
}
function exitTaskSummary(db,user) {
  return (db.studentExitTasks||[]).filter(task=>mayReviewTask(user,task))
    .map(task=>{
      const student=(db.students||[]).find(s=>s.id===task.studentId);
      const loans=student? (db.books||[]).filter(book=>
        book.borrowedBy===student.id|| (student.borrowedBooks||[])
          .some(ref=>(typeof ref==='string'?ref:ref?.bookId)===book.id))
        .map(book=>({id:book.id,title:book.title||'Onbekend boek'})):[];
      return {
        id:task.id,studentName:task.studentName,
        lastClasses:task.lastClasses,studentId:task.studentId,
        status:task.status,createdAt:task.createdAt,
        completedAt:task.completedAt,revision:task.revision,
        borrowedBooks:loans,
      };
    }).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function completeExitTask(db,user,id,revision,now=new Date().toISOString()){
  const task=(db.studentExitTasks||[]).find(t=>t.id===id);
  if(!task||!mayReviewTask(user,task))return {ok:false,status:403,error:'no_access'};
  if(task.status!=='open'||task.revision!==revision)return {ok:false,status:409,error:'stale_task'};
  const student=(db.students||[]).find(entry=>entry.id===task.studentId);
  if(student?.active!==false)return {ok:false,status:409,error:'student_is_active'};
  if(student&&activeLoans(db,student))return {ok:false,status:409,error:'student_still_has_books'};
  task.status='completed';task.resolution='checked_and_archived';
  task.completedAt=now;task.completedBy=user.id;task.revision+=1;
  return {ok:true,status:200,taskId:id};
}
module.exports={studentHasLibraryData,snapshotClasses,transitionMissingStudent,
  cancelReturnedStudents,exitTaskSummary,completeExitTask};
