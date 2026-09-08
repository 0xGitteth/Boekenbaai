'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-active-session-'));
const dataPath = path.join(tmp, 'db.json');
process.env.BOEKENBAAI_DATA_PATH = dataPath;

fs.writeFileSync(dataPath, JSON.stringify({
  users: [
    { id: 'teacher-active', role: 'teacher', active: true },
    { id: 'teacher-inactive', role: 'teacher', active: false },
    { id: 'admin-active', role: 'admin', active: true },
  ],
  students: [
    { id: 'student-active', active: true },
    { id: 'student-inactive', active: false },
  ],
}));

try {
  const core = require('../google-auth-core');
  const guard = require('../active-account-session-guard-preload');

  assert.ok(guard.__test.findActiveAccount(JSON.parse(fs.readFileSync(dataPath, 'utf8')), 'staff', 'teacher-active'));
  assert.strictEqual(guard.__test.findActiveAccount(JSON.parse(fs.readFileSync(dataPath, 'utf8')), 'staff', 'teacher-inactive'), null);

  const activeTeacher = core.upsertSession(core.emptyAuthStore(), 'active-teacher-token', {
    userId: 'teacher-active',
    type: 'staff',
    remember: false,
    now: Date.now(),
  });
  assert.ok(activeTeacher.store.sessions.some((entry) => entry.userId === 'teacher-active'));

  const activeStudent = core.upsertSession(core.emptyAuthStore(), 'active-student-token', {
    userId: 'student-active',
    type: 'student',
    remember: false,
    now: Date.now(),
  });
  assert.ok(activeStudent.store.sessions.some((entry) => entry.userId === 'student-active'));

  assert.throws(
    () => core.upsertSession(core.emptyAuthStore(), 'inactive-teacher-token', {
      userId: 'teacher-inactive',
      type: 'staff',
      remember: false,
      now: Date.now(),
    }),
    (error) => error?.code === 'ACCOUNT_INACTIVE'
  );

  assert.throws(
    () => core.upsertSession(core.emptyAuthStore(), 'inactive-student-token', {
      userId: 'student-inactive',
      type: 'student',
      remember: false,
      now: Date.now(),
    }),
    (error) => error?.code === 'ACCOUNT_INACTIVE'
  );

  console.log('Active account session guard tests geslaagd.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}