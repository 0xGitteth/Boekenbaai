'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notifications = require('../reading-change-notifications');

const db = {
  students: [
    { id: 's1', name: 'Leerling Een', classIds: ['c1'], active: true },
    { id: 's2', name: 'Leerling Twee', classIds: ['c2'], active: true },
  ],
  classes: [
    { id: 'c1', name: 'Klas A', studentIds: ['s1'],
      teacherIds: ['t1', 't2', 't1'] },
    { id: 'c2', name: 'Klas B', studentIds: ['s2'], teacherIds: ['t3'] },
  ],
  users: [
    { id: 't1', name: 'Docent 1', role: 'teacher', active: true },
    { id: 't2', name: 'Docent 2', role: 'teacher', active: true },
    { id: 't3', name: 'Docent 3', role: 'teacher', active: true },
    { id: 't4', name: 'Docent 4', role: 'teacher', active: false },
    { id: 'a', role: 'admin', active: true },
  ],
};
const record = { id: 'reading-1', title: 'Testboek', subjectType: 'student', subjectId: 's1' };
const now = '2026-11-10T19:00:00.000Z';
assert.deepEqual(notifications.recipientsForStudent(db, db.students[0]), ['t1', 't2']);
assert.equal(notifications.createReadingChangeNotification(db, {
  student: db.students[0], record, previous: true, updated: true,
  actorId: 's1', now,
}), null, 'No actual answer change means no notification');
assert.equal(notifications.createReadingChangeNotification(db, {
  student: db.students[0], record, previous: true, updated: false,
  actorId: 't1', now,
}), null, 'Changes by teachers do not notify mentors');
const notification = notifications.createReadingChangeNotification(db, {
  student: db.students[0], record, previous: true, updated: false,
  actorId: 's1', now,
});
assert.ok(notification?.id);
assert.equal(db.readingChangeNotifications.length, 1);
assert.deepEqual(notification.recipientIds, ['t1', 't2']);

const t1 = db.users[0];
const t2 = db.users[1];
const t3 = db.users[2];
const one = notifications.listTeacherNotifications(db, t1);
const two = notifications.listTeacherNotifications(db, t2);
const outsider = notifications.listTeacherNotifications(db, t3);
assert.equal(one.unreadCount, 1);
assert.equal(two.unreadCount, 1);
assert.equal(outsider.unreadCount, 0);
assert.equal(one.notifications[0].studentName, 'Leerling Een');
assert.equal(one.notifications[0].previous, true);
assert.equal(one.notifications[0].updated, false);
assert.equal(one.notifications[0].readAt, null);
assert.equal(notifications.markNotificationRead(db, t3, notification.id, now).status, 403);
assert.equal(notifications.markNotificationRead(db, db.students[0], notification.id, now).status, 403);
assert.equal(notifications.markNotificationRead(db, t1, notification.id, now).status, 200);
assert.equal(notifications.markNotificationRead(db, t1, notification.id, now).changed, false,
  'Mark-as-read is idempotent');
assert.equal(notifications.listTeacherNotifications(db, t1).unreadCount, 0);
assert.equal(notifications.listTeacherNotifications(db, t2).unreadCount, 1,
  'Each mentor has an independent read receipt');
assert.equal(notifications.listTeacherNotifications(db, t1).notifications[0].readAt, now);

// Changing class membership immediately revokes old mentor visibility,
// even for an unread notification that had been addressed before transfer.
db.students[0].classIds = ['c2'];
db.classes[0].studentIds = [];
db.classes[1].studentIds.push('s1');
assert.equal(notifications.listTeacherNotifications(db, t1).notifications.length, 0);
assert.equal(notifications.listTeacherNotifications(db, t2).unreadCount, 0);
assert.equal(notifications.listTeacherNotifications(db, t3).unreadCount, 0,
  'New mentors do not inherit unrelated historical notifications');
assert.equal(notifications.markNotificationRead(db, t2, notification.id, now).status, 403);

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/staff.html'), 'utf8');
const staffUi = fs.readFileSync(path.join(root, 'public/reading-change-notifications-ui.js'), 'utf8');
const teacher = fs.readFileSync(path.join(root, 'public/teacher-modern.js'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
assert.match(html, /id="staff-reading-change-notifications"/);
assert.match(html, /id="staff-reading-alerts-count"/);
assert.match(html, /reading-change-notifications-ui\.js/);
assert.match(vite, /'reading-change-notifications\.css'/);
assert.match(teacher, /place\(document\.getElementById\('staff-reading-change-notifications'\), tasks\)/);
assert.match(staffUi, /Markeer als gelezen/);
assert.ok(!staffUi.includes('Goedkeuren') && !staffUi.includes('Afkeuren'));
assert.match(staffUi, /boekenbaai:staff-refresh/);
assert.match(staffUi, /boekenbaai:reading-alerts-count/);
assert.match(staffUi, /Nog te lezen/);
assert.match(staffUi, /Gelezen meldingen/);
assert.match(teacher, /readingAlertCount \+ mentorTaskCount|importTaskCount \+ mentorTaskCount \+ readingAlertCount|importTaskCount \+ mentorTaskCount \+ readingAlertCount/);
assert.match(teacher, /Gewijzigde leesantwoorden/);
assert.match(teacher, /if \(next === 'tasks'\)/);
assert.ok(!teacher.includes("place(document.getElementById('staff-reading-change-notifications'), start)"));
console.log('Reading change teacher alerts, role isolation, per-teacher read receipts and UI checks passed.');
