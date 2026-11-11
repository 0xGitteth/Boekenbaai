'use strict';

// School-specific class classification. Exact names come from the current ParnasSys import.
// Class IDs, not imported grade values, determine access; the classification is evaluated
// against current membership whenever a student authenticates or uses the exam-list API.
const CLASS_LEVELS = Object.freeze({
  'alternatieve ontwikkelingstrajecten': 'mixed',
  'arbeid': 'upper',
  'bovenbouw structuur': 'upper',
  'dp 80 instroom': 'mixed',
  'onderbouw bkt': 'lower',
  'onderbouw pro-basis': 'lower',
  'onderbouw structuur kt': 'lower',
  'onderbouw structuur pro-basis': 'lower',
  'oza': 'mixed',
  'vmbo basis-kader 3': 'upper',
  'vmbo basis-kader 4': 'upper',
  'vmbo theoretisch 3': 'upper',
  'vmbo theoretisch 4': 'upper',
});
function normalizeClassName(value) {
  return String(value || '').normalize('NFKC').trim()
    .replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
}
function classifyClass(name) {
  return CLASS_LEVELS[normalizeClassName(name)] || 'unknown';
}
function studentClassIds(db, student) {
  const ids = new Set(Array.isArray(student?.classIds) ? student.classIds.filter(Boolean) : []);
  for (const klass of db?.classes || []) {
    if (Array.isArray(klass?.studentIds) && klass.studentIds.includes(student?.id)) ids.add(klass.id);
  }
  return ids;
}
function examReadingAccess(db, student) {
  if (!student || student.active === false) {
    return { eligible: false, mixed: false, needsDecision: false, source: 'inactive' };
  }
  const ids = studentClassIds(db, student);
  const levels = (db?.classes || [])
    .filter(klass => ids.has(klass.id))
    .map(klass => classifyClass(klass.name));
  // Any current upper-school class grants access. Mixed-class access is
  // explicitly assigned per student by Beheer, never inferred from age/grade.
  const upper = levels.includes('upper');
  const mixed = levels.includes('mixed');
  const eligible = upper || (mixed && student.examReadingEligibleOverride === true);
  return {
    eligible,
    mixed,
    needsDecision: mixed && !upper,
    source: upper ? 'upper-class'
      : mixed ? (eligible ? 'mixed-approved' : 'mixed-unconfirmed')
        : levels.includes('lower') ? 'lower-class' : 'unclassified',
  };
}
module.exports = { CLASS_LEVELS, normalizeClassName, classifyClass, studentClassIds, examReadingAccess };
