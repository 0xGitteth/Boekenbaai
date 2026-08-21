'use strict';

const assert = require('assert');
const {
  THIRTY_DAYS_MS,
  PENDING_LINK_REQUEST_MAX_AGE_MS,
  LINK_REQUEST_HISTORY_MAX_AGE_MS,
  normalizeEmail,
  isAllowedSchoolEmail,
  createSignedState,
  verifySignedState,
  emptyAuthStore,
  pruneStore,
  findLinkByIdentity,
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

(function testVerifiedLinkNeverFallsBackToReusedEmail() {
  let store = emptyAuthStore();
  store = upsertLink(store, {
    accountType: 'student',
    accountId: 'student-1',
    email: 'hergebruikt@koraaledu.nl',
    sub: 'original-sub',
  }).store;

  assert.strictEqual(
    findLinkByIdentity(store, 'student', {
      email: 'hergebruikt@koraaledu.nl',
      sub: 'different-google-account',
    }),
    null
  );

  const prelinked = upsertLink(emptyAuthStore(), {
    accountType: 'student',
    accountId: 'student-2',
    email: 'vooraf@koraaledu.nl',
    sub: '',
  }).store;
  assert.strictEqual(
    findLinkByIdentity(prelinked, 'student', {
      email: 'vooraf@koraaledu.nl',
      sub: 'first-verified-sub',
    })?.accountId,
    'student-2'
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

(function testLinkRequestRetention() {
  const now = Date.UTC(2026, 7, 21, 12, 0, 0);
  const iso = (timestamp) => new Date(timestamp).toISOString();
  const store = emptyAuthStore();
  store.linkRequests = [
    { id: 'pending-fresh', status: 'pending', createdAt: iso(now - PENDING_LINK_REQUEST_MAX_AGE_MS + 1) },
    { id: 'pending-stale', status: 'pending', createdAt: iso(now - PENDING_LINK_REQUEST_MAX_AGE_MS - 1) },
    { id: 'approved-fresh', status: 'approved', updatedAt: iso(now - LINK_REQUEST_HISTORY_MAX_AGE_MS + 1) },
    { id: 'denied-fresh', status: 'denied', updatedAt: iso(now - 5 * 24 * 60 * 60 * 1000) },
    { id: 'rejected-legacy', status: 'rejected', updatedAt: iso(now - 5 * 24 * 60 * 60 * 1000) },
    { id: 'superseded-fresh', status: 'superseded', updatedAt: iso(now - 5 * 24 * 60 * 60 * 1000) },
    { id: 'approved-stale', status: 'approved', updatedAt: iso(now - LINK_REQUEST_HISTORY_MAX_AGE_MS - 1) },
    { id: 'missing-date', status: 'pending' },
    { id: 'invalid-date', status: 'approved', updatedAt: 'geen-datum' },
    { id: 'unknown-status', status: 'mystery', updatedAt: iso(now - 1_000) },
    { id: 'future-date', status: 'pending', updatedAt: iso(now + 61_000) },
  ];

  const pruned = pruneStore(store, now);
  assert.deepStrictEqual(
    pruned.linkRequests.map((entry) => entry.id).sort(),
    ['approved-fresh', 'denied-fresh', 'pending-fresh', 'rejected-legacy', 'superseded-fresh'].sort()
  );
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
