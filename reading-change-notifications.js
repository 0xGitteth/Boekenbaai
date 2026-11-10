'use strict';

// An informational inbox, not an approval queue. Every assigned active
// teacher has a personal read receipt. Student edits take effect immediately.
const { randomUUID } = require('node:crypto');
const { studentClassIds, mayManageStudent } = require('./book-loan-policy');

function isActiveTeacher(user) {
  return user?.role === 'teacher' && user.active !== false
    && user.isActive !== false && user.disabled !== true
    && user.status !== 'inactive';
}

function recipientsForStudent(db, student) {
  const classIds = new Set(studentClassIds(db, student));
  const ids = new Set();
  for (const klass of db.classes || []) {
    if (!classIds.has(klass.id)) continue;
    for (const teacherId of klass.teacherIds || []) ids.add(teacherId);
  }
  return (db.users || []).filter(user => ids.has(user.id) && isActiveTeacher(user))
    .map(user => user.id);
}

function createReadingChangeNotification(db, {
  student, record, previous, updated, actorId, now,
}) {
  if (!student?.id || !record?.id || typeof previous !== 'boolean'
    || typeof updated !== 'boolean' || previous === updated
    || actorId !== student.id || record.subjectType !== 'student'
    || record.subjectId !== student.id) return null;
  const recipients = recipientsForStudent(db, student);
  if (!recipients.length) return null;
  if (!Array.isArray(db.readingChangeNotifications)) db.readingChangeNotifications = [];
  const entry = {
    id: randomUUID(),
    studentId: student.id,
    recordId: record.id,
    title: record.title || '',
    previous,
    updated,
    changedAt: now,
    recipientIds: recipients,
    readBy: {},
  };
  db.readingChangeNotifications.push(entry);
  return entry;
}

function visibleToTeacher(db, notification, teacher) {
  if (!isActiveTeacher(teacher)
    || !notification || !Array.isArray(notification.recipientIds)
    || !notification.recipientIds.includes(teacher.id)) return false;
  const student = (db.students || []).find(row => row.id === notification.studentId);
  // Once reassigned to a different class, an old teacher cannot continue
  // reading changes about a pupil they are no longer authorized to manage.
  return Boolean(student && mayManageStudent(db, teacher, student));
}

function listTeacherNotifications(db, teacher, { page = 0, pageSize = 50 } = {}) {
  const visible = (db.readingChangeNotifications || [])
    .filter(entry => visibleToTeacher(db, entry, teacher));
  const unreadCount = visible.filter(entry => !entry.readBy?.[teacher.id]).length;
  visible.sort((a, b) => {
    const aRead = Boolean(a.readBy?.[teacher.id]);
    const bRead = Boolean(b.readBy?.[teacher.id]);
    return Number(aRead) - Number(bRead)
      || String(b.changedAt || '').localeCompare(String(a.changedAt || ''));
  });
  const start = page * pageSize;
  return {
    unreadCount,
    notifications: visible.slice(start, start + pageSize).map(entry => ({
      id: entry.id,
      studentName: (db.students || []).find(s => s.id === entry.studentId)?.name || 'Leerling',
      title: entry.title,
      previous: entry.previous,
      updated: entry.updated,
      changedAt: entry.changedAt,
      readAt: entry.readBy?.[teacher.id] || null,
    })),
    nextPage: start + pageSize < visible.length ? page + 1 : null,
  };
}

function markNotificationRead(db, teacher, id, now) {
  if (!isActiveTeacher(teacher)) return { status: 403 };
  const entry = (db.readingChangeNotifications || []).find(row => row.id === id);
  if (!entry) return { status: 404 };
  if (!visibleToTeacher(db, entry, teacher)) return { status: 403 };
  if (!entry.readBy || typeof entry.readBy !== 'object') entry.readBy = {};
  if (entry.readBy[teacher.id]) return { status: 200, changed: false };
  entry.readBy[teacher.id] = now;
  return { status: 200, changed: true };
}

module.exports = {
  isActiveTeacher, recipientsForStudent, createReadingChangeNotification,
  visibleToTeacher, listTeacherNotifications, markNotificationRead,
};
