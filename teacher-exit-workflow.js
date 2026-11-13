'use strict';

const crypto = require('node:crypto');

// Identity and current membership are not library history. Everything else,
// including unknown future references, must be preserved instead of deleted.
const ACCOUNT_FIELDS=new Set([
  'id','role','name','firstName','middleName','lastName','username',
  'passwordHash','mustChangePassword','classIds','active','source',
  'email','schoolEmail','loginEmail','status','createdAt','updatedAt',
  'inactiveAt','inactiveReason','inactiveBy','lastLoginAt','lastSeenAt',
]);
const IGNORED_COLLECTIONS=new Set(['users','classes','teacherExitTasks']);
function hasValue(value){
  if(value==null||value===''||value===false)return false;
  if(Array.isArray(value))return value.some(hasValue);
  if(typeof value==='object')return Object.values(value).some(hasValue);
  return true;
}
function referencesId(value,id,depth=0){
  if(value==null||depth>25)return false;
  if(typeof value==='string')return value===id;
  if(Array.isArray(value))return value.some(item=>referencesId(item,id,depth+1));
  if(typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>key===id||
    referencesId(item,id,depth+1));
}
function teacherHasData(db,teacher){
  if(!teacher?.id)return true;
  if(Object.entries(teacher).some(([field,value])=>!ACCOUNT_FIELDS.has(field)&&hasValue(value)))
    return true;
  return Object.entries(db||{}).some(([field,value])=>
    !IGNORED_COLLECTIONS.has(field)&&referencesId(value,teacher.id));
}
function formerClasses(db,teacher){
  const ids=new Set(Array.isArray(teacher.classIds)?teacher.classIds:[]);
  for(const klass of db.classes||[])if((klass.teacherIds||[]).includes(teacher.id))
    ids.add(klass.id);
  return [...ids].map(id=>{
    const klass=(db.classes||[]).find(c=>c.id===id);
    return {id,name:klass?.name||'Voormalige klas'};
  });
}
function unlinkTeacher(db,teacher){
  for(const klass of db.classes||[])if(Array.isArray(klass.teacherIds))
    klass.teacherIds=klass.teacherIds.filter(id=>id!==teacher.id);
  teacher.classIds=[];
}
function revokeStaffSessions(store,id){
  store.sessions=(store.sessions||[]).filter(s=>!(
    (s.type==='staff'&&s.userId===id)||
    (s.accountType==='staff'&&s.accountId===id)));
  for(const request of store.linkRequests||[])if(request?.staffId===id&&
    request.status==='pending')request.status='superseded';
}
function scrubDeletedStaffIdentity(store,id){
  revokeStaffSessions(store,id);
  for(const key of ['links','pendingIdentities','linkRequests','loginChallenges']){
    if(!Array.isArray(store[key]))continue;
    store[key]=store[key].filter(entry=>!(
      entry?.staffId===id || (entry?.accountType==='staff'&&entry?.accountId===id) ||
      (entry?.type==='staff'&&entry?.userId===id)
    ));
  }
}
function transitionMissingTeacher(db,store,teacher,{
  apply=false,actorId='',now=new Date().toISOString(),
}={}){
  const hasData=teacherHasData(db,teacher);
  const classes=formerClasses(db,teacher);
  if(!apply)return {action:hasData?'archive':'delete',hasData,classes};
  unlinkTeacher(db,teacher);
  revokeStaffSessions(store,teacher.id);
  if(!hasData){
    db.users=(db.users||[]).filter(user=>user.id!==teacher.id);
    scrubDeletedStaffIdentity(store,teacher.id);
    return {action:'deleted',hasData:false,classes};
  }
  teacher.active=false;
  teacher.inactiveAt=now;
  teacher.inactiveReason='not-in-parnassys-staff-list';
  teacher.inactiveBy=actorId||'school-sync';
  if(!Array.isArray(db.teacherExitTasks))db.teacherExitTasks=[];
  const existing=db.teacherExitTasks.find(task=>task.teacherId===teacher.id&&
    task.status==='open');
  let task=existing;
  if(!task){
    task={
      id:crypto.randomUUID(),teacherId:teacher.id,
      teacherName:teacher.name||'Onbekende medewerker',lastClasses:classes,
      createdAt:now,createdBy:actorId||'school-sync',
      status:'open',resolution:null,completedBy:null,completedAt:null,revision:1,
    };
    db.teacherExitTasks.push(task);
  }
  return {action:'archived',hasData:true,classes,taskId:task.id};
}
function cancelReturnedTeachers(db){
  for(const task of db.teacherExitTasks||[]){
    if(task.status!=='open')continue;
    const teacher=(db.users||[]).find(u=>u.id===task.teacherId&&u.role==='teacher');
    if(teacher?.active!==true)continue;
    task.status='cancelled';task.resolution='returned-to-school';
    task.completedAt=new Date().toISOString();task.revision++;
  }
}
function teacherExitTaskSummary(db,user){
  if(user?.role!=='admin')return [];
  return (db.teacherExitTasks||[]).map(task=>({
    id:task.id,teacherName:task.teacherName,lastClasses:task.lastClasses,
    teacherId:task.teacherId,status:task.status,revision:task.revision,
    createdAt:task.createdAt,completedAt:task.completedAt,
  })).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function completeTeacherExitTask(db,user,id,revision,now=new Date().toISOString()){
  if(user?.role!=='admin')return {ok:false,status:403,error:'forbidden'};
  const task=(db.teacherExitTasks||[]).find(x=>x.id===id);
  if(!task)return {ok:false,status:404,error:'not_found'};
  if(task.status!=='open'||task.revision!==revision)
    return {ok:false,status:409,error:'stale_task'};
  const teacher=(db.users||[]).find(x=>x.id===task.teacherId);
  if(teacher?.active!==false)return {ok:false,status:409,error:'teacher_is_active'};
  task.status='completed';task.resolution='checked_and_archived';
  task.completedBy=user.id;task.completedAt=now;task.revision++;
  return {ok:true,status:200,taskId:task.id};
}
module.exports={teacherHasData,formerClasses,transitionMissingTeacher,
  cancelReturnedTeachers,teacherExitTaskSummary,completeTeacherExitTask};
