'use strict';

const assert = require('assert');
const { emptyAuthStore, upsertSession } = require('../google-auth-core');
const {
  normalizeOrigin,
  getExpectedOrigin,
  isMutationRequest,
  isSameOriginMutation,
  accountCredentialFingerprint,
  validatePersistedSession,
  classifySessionAuthMethod,
  decorateSessionResult,
} = require('../google-auth-security-core');

(function testOriginChecksRejectSiblingSliplaneApps() {
  const req = {
    method: 'POST',
    headers: {
      host: 'boekenbaai.sliplane.app',
      'x-forwarded-proto': 'https',
      origin: 'https://kwaadaardig.sliplane.app',
      'sec-fetch-site': 'same-site',
    },
    socket: {},
  };
  const expected = getExpectedOrigin(req, 'https://boekenbaai.sliplane.app');
  assert.strictEqual(expected, 'https://boekenbaai.sliplane.app');
  assert.strictEqual(isMutationRequest(req.method), true);
  assert.strictEqual(isSameOriginMutation(req, expected), false);

  req.headers.origin = 'https://boekenbaai.sliplane.app';
  req.headers['sec-fetch-site'] = 'same-origin';
  assert.strictEqual(isSameOriginMutation(req, expected), true);
  assert.strictEqual(normalizeOrigin('https://boekenbaai.sliplane.app/path'), expected);
})();

(function testMissingOriginNeedsSameOriginFetchMetadata() {
  const req = {
    method: 'PATCH',
    headers: { 'sec-fetch-site': 'same-site' },
  };
  assert.strictEqual(isSameOriginMutation(req, 'https://boekenbaai.sliplane.app'), false);
  req.headers['sec-fetch-site'] = 'same-origin';
  assert.strictEqual(isSameOriginMutation(req, 'https://boekenbaai.sliplane.app'), true);
})();

(function testCredentialFingerprintInvalidatesResetSessions() {
  const before = {
    id: 'teacher-1',
    role: 'teacher',
    passwordHash: 'old-hash',
    mustChangePassword: false,
  };
  const afterReset = {
    ...before,
    passwordHash: 'new-hash',
    mustChangePassword: true,
  };
  assert.notStrictEqual(
    accountCredentialFingerprint(before),
    accountCredentialFingerprint(afterReset)
  );
})();

(function testPersistedSessionValidation() {
  const token = 'session-token';
  const now = 1_800_000_000_000;
  const db = {
    users: [
      {
        id: 'teacher-1',
        role: 'teacher',
        passwordHash: 'hash-1',
        mustChangePassword: false,
      },
    ],
    students: [],
  };
  let result = upsertSession(emptyAuthStore(), token, {
    userId: 'teacher-1',
    type: 'staff',
    remember: true,
    now,
  });
  result = decorateSessionResult(result, db, '/api/auth/session/persist');

  const valid = validatePersistedSession(result.store, token, db, now + 1000);
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.session.authMethod, 'password');

  const changedDb = JSON.parse(JSON.stringify(db));
  changedDb.users[0].passwordHash = 'hash-2';
  assert.strictEqual(
    validatePersistedSession(result.store, token, changedDb, now + 1000).reason,
    'credentials-changed'
  );

  assert.strictEqual(
    validatePersistedSession(result.store, token, db, result.session.expiresAt + 1).reason,
    'expired'
  );
})();

(function testSessionsWithoutFingerprintAreRejected() {
  const token = 'legacy-record';
  const now = 1_800_000_000_000;
  const db = {
    users: [{ id: 'teacher-1', role: 'teacher', passwordHash: 'hash' }],
    students: [],
  };
  const result = upsertSession(emptyAuthStore(), token, {
    userId: 'teacher-1',
    type: 'staff',
    remember: true,
    now,
  });
  assert.strictEqual(
    validatePersistedSession(result.store, token, db, now + 1000).reason,
    'legacy-session'
  );
})();

(function testGoogleSessionClassification() {
  assert.strictEqual(classifySessionAuthMethod('/api/auth/google/callback'), 'google');
  assert.strictEqual(classifySessionAuthMethod('/api/auth/google/link-request'), 'google');
  assert.strictEqual(classifySessionAuthMethod('/api/auth/google/pending/complete'), 'google');
  assert.strictEqual(classifySessionAuthMethod('/api/auth/session/persist'), 'password');
})();

console.log('Google-auth security tests geslaagd.');