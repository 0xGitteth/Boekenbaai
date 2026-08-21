'use strict';

const assert = require('assert');
const core = require('../google-auth-core');
const {
  snapshotGoogleLinks,
  findChangedExistingGoogleAccounts,
  revokePersistedSessionsForAccounts,
} = require('../google-link-session-revocation-core');

(function testOnlyExistingIdentityChangesTriggerRevocation() {
  const before = {
    ...core.emptyAuthStore(),
    links: [
      { accountType: 'staff', accountId: 'teacher-1', email: 'oud@koraaledu.nl', sub: 'sub-1' },
      { accountType: 'student', accountId: 'student-1', email: 'leerling@koraaledu.nl', sub: '' },
    ],
  };
  const snapshot = snapshotGoogleLinks(before);

  const unchanged = {
    ...before,
    links: before.links.map((entry) => ({ ...entry, updatedAt: new Date().toISOString() })),
  };
  assert.deepStrictEqual(findChangedExistingGoogleAccounts(snapshot, unchanged), []);

  const changedEmail = {
    ...before,
    links: before.links.map((entry) =>
      entry.accountId === 'teacher-1'
        ? { ...entry, email: 'nieuw@koraaledu.nl', sub: '' }
        : entry
    ),
  };
  assert.deepStrictEqual(findChangedExistingGoogleAccounts(snapshot, changedEmail), [
    { accountType: 'staff', accountId: 'teacher-1' },
  ]);

  const verifiedPrelink = {
    ...before,
    links: before.links.map((entry) =>
      entry.accountId === 'student-1' ? { ...entry, sub: 'student-sub' } : entry
    ),
  };
  assert.deepStrictEqual(findChangedExistingGoogleAccounts(snapshot, verifiedPrelink), [
    { accountType: 'student', accountId: 'student-1' },
  ]);

  const removed = {
    ...before,
    links: before.links.filter((entry) => entry.accountId !== 'teacher-1'),
  };
  assert.deepStrictEqual(findChangedExistingGoogleAccounts(snapshot, removed), [
    { accountType: 'staff', accountId: 'teacher-1' },
  ]);

  const newLinkOnly = {
    ...before,
    links: [
      ...before.links,
      { accountType: 'staff', accountId: 'teacher-2', email: 'twee@koraaledu.nl', sub: '' },
    ],
  };
  assert.deepStrictEqual(
    findChangedExistingGoogleAccounts(snapshot, newLinkOnly),
    [],
    'Een eerste koppeling heeft geen oude Google-identiteit waarvoor sessies ingetrokken moeten worden'
  );
})();

(function testRevokesOnlyTargetAccountSessions() {
  const store = {
    ...core.emptyAuthStore(),
    sessions: [
      { tokenHash: 'teacher-a', userId: 'teacher-1', type: 'staff' },
      { tokenHash: 'teacher-b', userId: 'teacher-1', type: 'staff' },
      { tokenHash: 'other-teacher', userId: 'teacher-2', type: 'staff' },
      { tokenHash: 'student-a', userId: 'student-1', type: 'student' },
      { tokenHash: 'same-id-other-type', userId: 'teacher-1', type: 'student' },
    ],
  };

  const result = revokePersistedSessionsForAccounts(store, [
    { accountType: 'staff', accountId: 'teacher-1' },
  ]);
  assert.deepStrictEqual(result.revokedTokenHashes.sort(), ['teacher-a', 'teacher-b']);
  assert.deepStrictEqual(
    result.store.sessions.map((entry) => entry.tokenHash).sort(),
    ['other-teacher', 'same-id-other-type', 'student-a'].sort()
  );
  assert.strictEqual(store.sessions.length, 5, 'De helper mag de inputstore niet muteren');
})();

console.log('Google link session revocation core tests geslaagd.');
