'use strict';

// The class roster is what a mentor edits. When it explicitly names a pupil,
// stale class IDs left on the pupil's older account must not be combined with
// it. If no roster contains this student, keep account class IDs for legacy
// records that have not yet been migrated. This is read-only; no DB changes.
function currentStudentClassIds(db,student) {
  if(!student?.id)return [];
  const classes=Array.isArray(db?.classes)?db.classes:[];
  const rosterIds=classes.filter(klass=>klass?.id
    &&Array.isArray(klass.studentIds)&&klass.studentIds.includes(student.id))
    .map(klass=>klass.id);
  if(rosterIds.length)return [...new Set(rosterIds)];
  const known=new Set(classes.map(klass=>klass.id));
  return [...new Set(Array.isArray(student.classIds)?student.classIds:[])]
    .filter(id=>known.has(id));
}
function inconsistentClassMembership(db,student) {
  const recorded=[...new Set(Array.isArray(student?.classIds)?student.classIds:[])].sort();
  const roster=(db?.classes||[]).filter(klass=>klass?.id
    &&Array.isArray(klass.studentIds)&&klass.studentIds.includes(student?.id))
    .map(klass=>klass.id).sort();
  return roster.length>0 && JSON.stringify(recorded)!==JSON.stringify(roster);
}
module.exports={currentStudentClassIds,inconsistentClassMembership};
