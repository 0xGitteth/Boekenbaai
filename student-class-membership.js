'use strict';

// Student class rosters are authoritative whenever they exist. The imported
// student.classIds field may retain a previous class even after a mentor has
// updated the current class roster. Fall back to that field only for legacy
// classes that do not have a roster at all. This is read-only: class updates
// remain the responsibility of the existing controlled import/edit workflows.
function currentStudentClassIds(db,student){
  if(!student?.id)return [];
  const classes=Array.isArray(db?.classes)?db.classes:[];
  const roster=classes.filter(klass=>klass?.id
      &&Array.isArray(klass.studentIds)
      &&klass.studentIds.includes(student.id))
    .map(klass=>klass.id);
  if(roster.length)return [...new Set(roster)];
  const stored=Array.isArray(student.classIds)?student.classIds:[];
  const known=new Map(classes.filter(klass=>klass?.id)
    .map(klass=>[klass.id,klass]));
  return [...new Set(stored.filter(id=>{
    if(!id)return false;
    const klass=known.get(id);
    // Old databases may not contain a class collection yet. In that case
    // keep a legacy identifier, but do not interpret an explicitly empty
    // roster as proof of membership.
    if(!klass)return classes.length===0;
    return !Array.isArray(klass.studentIds);
  }))];
}
function currentStudentClassNames(db,student){
  const ids=new Set(currentStudentClassIds(db,student));
  return (Array.isArray(db?.classes)?db.classes:[])
    .filter(klass=>klass?.id&&ids.has(klass.id))
    .map(klass=>String(klass.name||'').trim())
    .filter(Boolean);
}
module.exports={currentStudentClassIds,currentStudentClassNames};
