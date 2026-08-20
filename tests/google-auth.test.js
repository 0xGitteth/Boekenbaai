'use strict';

const assert = require('assert');
const {
  THIRTY_DAYS_MS,
  normalizeEmail,
  isAllowedSchoolEmail,
  createSignedState,
  verifySignedState,
  emptyAuthStore,
  upsertLink,
  upsertSession,
  resolveSession,
  canStaffManageStudent,
} = require('../google-auth-core');

(function testSchoolDomainValidation() {
  assert.strictEqual(normalizeEmail(' Leerling@KORAaLEDU.NL '), 'leerling@koraaledu.nl');
  assert.strictEqual(isAllowedSchoolEmail('leerling@koraaledu.nl', 'koraaledu.nl'), true);
  assert.strictEqual(isAllowedSchoolEmail('leerling@sub.koraaledu.nl', 'koraaledu.nl'), false);
  assert.strictEqual(isAllowedSchoolEmail('leerling@gmail.com', 'koraaledu.nl'), false);
})();

(function testSignedOAuthState() {
  const secret = 'test-secret';
  const now = 1_800_000_000_000;
  const state = createSignedState({ type: 'staff', nonce: 'abc', iat: now }, secret);
  assert.deepStrictEqual(verifySignedState(state, secret, { now }), {
    type: 'staff',
    nonce: 'abc',
    iat: now,
  });
  assert.strictEqual(verifySignedState(`${state}x`, secret, { now }), null);
  assert.strictEqual(verifySignedState(state, secret, { now: now + 11 * 60 * 1000 }), null);
})();

(function testUniqueGoogleLinks() {
  let store = emptyAuthStore();
  store = upsertLink(store, {
    accountType: 'student',
    accountId: 'student-1',
    email: 'een@koraaledu.nl',
    sub: 'sub-1',
  }).store;
  const same = upsertLink(store, {
    accountType: 'student',
    accountId: 'student-1',
    email: 'een@koraaledu.nl',
    sub: 'sub-1',
  });
  assert.strictEqual(same.link.sub, 'sub-1');
  assert.throws(
    () => upsertLink(store, {
      accountType: 'student',
      accountId: 'student-2',
      email: 'een@koraaledu.nl',
      sub: 'sub-2',
    }),
    /ander account/
  );
})();

(function testRememberedSessionExpiry() {
  const now = 1_800_000_000_000;
  const token = 'opaque-token';
  const { store, session } = upsertSession(emptyAuthStore(), token, {
    userId: 'teacher-1',
    type: 'staff',
    remember: true,
    now,
  });
  assert.strictEqual(session.expiresAt - now, THIRTY_DAYS_MS);
  assert.ok(resolveSession(store, token, now + THIRTY_DAYS_MS - 1));
  assert.strictEqual(resolveSession(store, token, now + THIRTY_DAYS_MS + 1), null);
})();

(function testTeacherCanOnlyManageOwnStudents() {
  const db = {
    users: [
      { id: 'teacher-a', role: 'teacher', classIds: ['class-a'] },
      { id: 'admin', role: 'admin', classIds: [] },
    ],
    students: [
      { id: 'student-a', classIds: ['class-a'] },
      { id: 'student-b', classIds: ['class-b'] },
    ],
    classes: [
      { id: 'class-a', teacherIds: ['teacher-a'], studentIds: ['student-a'] },
      { id: 'class-b', teacherIds: [], studentIds: ['student-b'] },
    ],
  };
  const teacher = db.users[0];
  const admin = db.users[1];
  assert.strictEqual(canStaffManageStudent(db, teacher, 'student-a'), true);
  assert.strictEqual(canStaffManageStudent(db, teacher, 'student-b'), false);
  assert.strictEqual(canStaffManageStudent(db, admin, 'student-b'), true);
})();

console.log('Google-auth tests geslaagd.');
