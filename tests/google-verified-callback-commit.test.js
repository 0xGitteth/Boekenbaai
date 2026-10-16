'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../google-auth-core');
const { completeVerifiedGoogleSession } = require('../google-verified-callback-commit');
const { acquireFileLock } = require('../book-import-reminder-mail');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-google-callback-'));
const dataPath = path.join(dir, 'db.json');
const authPath = dataPath + '.auth.json';
const identity = { sub: 'verified-sub', email: 'teacher@koraaledu.nl' };
const initial = () => ({
  ...core.emptyAuthStore(),
  links: [{ accountType: 'staff', accountId: 'teacher-1',
    sub: identity.sub, email: identity.email }],
});
const complete = () => completeVerifiedGoogleSession({
  dataPath, authPath, type: 'staff', identity,
  expectedAccountId: 'teacher-1',
});
const read = () => JSON.parse(fs.readFileSync(authPath, 'utf8'));
try {
  fs.writeFileSync(dataPath, JSON.stringify({
    users: [{ id: 'teacher-1', role: 'teacher', active: true,
      passwordHash: 'hash1' }],
  }));
  fs.writeFileSync(authPath, JSON.stringify(initial()));
  const result = complete();
  assert.equal(core.resolveSession(read(), result.token)?.userId, 'teacher-1');
  assert.equal(core.resolveSession(read(), result.token)?.authMethod, 'google');
  assert.match(core.resolveSession(read(), result.token)?.accountFingerprint || '',
    /^[a-f0-9]{64}$/);

  // Another process removes the link after the OAuth callback resolved the
  // account. The *locked* final lookup must reject it without a new session.
  fs.writeFileSync(authPath, JSON.stringify(initial()));
  const unlinked = read();
  unlinked.links = [];
  fs.writeFileSync(authPath, JSON.stringify(unlinked));
  assert.throws(complete, { code: 'GOOGLE_LINK_CHANGED' });
  assert.deepEqual(read().sessions, [], 'Unlinked account must never get a session');

  // An identity transferred to a DIFFERENT account must also fail.
  const changed = initial();
  changed.links[0].accountId = 'teacher-2';
  fs.writeFileSync(authPath, JSON.stringify(changed));
  assert.throws(complete, { code: 'GOOGLE_LINK_CHANGED' });
  assert.equal(read().sessions.length, 0);

  // A contended writer lock must not produce an isolated session cookie.
  fs.writeFileSync(authPath, JSON.stringify(initial()));
  const held = acquireFileLock(dataPath + '.database-write.lock', { processOwned: true });
  try {
    assert.throws(complete, { code: 'DATABASE_WRITE_BUSY' });
    assert.equal(read().sessions.length, 0);
  } finally { held(); }

  // Previously unverified school-email links get their sub and new session
  // in the same commit. Google link security must not revoke the NEW token.
  const prelinked = initial();
  prelinked.links[0].sub = '';
  fs.writeFileSync(authPath, JSON.stringify(prelinked));
  const linked = complete();
  assert.equal(read().links[0].sub, identity.sub);
  assert.equal(core.resolveSession(read(), linked.token)?.userId, 'teacher-1');
  console.log('Verified Google callback link/session atomicity passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
