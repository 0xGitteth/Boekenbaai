'use strict';

// PR5: all permissions are evaluated against the CURRENT class membership,
// never a client-supplied list of class or student IDs.
function ownClassIds(db, user) {
  if (!user || user.role !== 'teacher') return [];
  return (Array.isArray(db.classes) ? db.classes : [])
    .filter((klass) => Array.isArray(klass?.teacherIds) && klass.teacherIds.includes(user.id))
    .map((klass) => klass.id);
}
function mayManageClass(db, user, classId) {
  if (!user || !classId) return false;
  if (user.role === 'admin') return (db.classes || []).some((c) => c.id === classId);
  return user.role === 'teacher' && ownClassIds(db, user).includes(classId);
}
function studentClassIds(db, student) {
  if (!student) return [];
  const ids = new Set(Array.isArray(student.classIds) ? student.classIds : []);
  for (const klass of db.classes || []) {
    if (Array.isArray(klass?.studentIds) && klass.studentIds.includes(student.id)) ids.add(klass.id);
  }
  return [...ids];
}
function mayManageStudent(db, user, student) {
  if (!student || !user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'teacher' && studentClassIds(db, student)
    .some((classId) => mayManageClass(db, user, classId));
}
function normalizeDueDate(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { ok: false };
  return { ok: true, value };
}
function publicBook(book) {
  if (!book || typeof book !== 'object') return book;
  const safe = { ...book };
  // Status remains public; identity, class ownership, loan dates and source
  // fields are restricted to dedicated staff/own-student endpoints.
  for (const field of ['borrowedBy', 'borrowedByClassId', 'borrowedAt',
    'dueDate', 'borrowerName', 'borrowerClass', 'borrowerId',
    'studentId', 'loanId', 'loanIds', 'importInfo']) delete safe[field];
  return safe;
}
module.exports = { ownClassIds, mayManageClass, studentClassIds, mayManageStudent,
  normalizeDueDate, publicBook };
