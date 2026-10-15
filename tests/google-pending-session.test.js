'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { completePendingGoogleSession } = require('../google-pending-session');
const { acquireFileLock } = require('../book-import-reminder-mail');
const core = require('../google-auth-core');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pending-tx-'));
const dataPath = path.join(tmp, 'db.json');
const authPath = dataPath + '.auth.json';
const now = Date.now();
const pendingHash = 'pending-hash';
const original = (type, mode) => ({
  ...core.emptyAuthStore(),
  pendingIdentities: [{
    tokenHash: pendingHash, studentId: type === 'student' ? 'student1' : undefined,
    staffId: type === 'staff' ? 'teacher1' : undefined,
    email: type + '@koraaledu.nl', sub: type + '-sub',
    expiresAt: now + 180000, remember: type === 'staff',
  }],
  links: [{
    accountType: type, accountId: type === 'staff' ? 'teacher1' : 'student1',
    email: type + '@koraaledu.nl',
    sub: mode === 'student-prelinked' ? '' : type + '-sub',
  }],
  sessions: [{
    tokenHash: 'old-token', type, userId: type === 'staff' ? 'teacher1' : 'student1',
    expiresAt: now + 180000,
  }],
  linkRequests: [{
    accountType: type,
    staffId: type === 'staff' ? 'teacher1' : undefined,
    studentId: type === 'student' ? 'student1' : undefined,
    email: type + '@koraaledu.nl', sub: type + '-sub',
    status: mode === 'student-prelinked' ? 'pending' : 'approved',
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
  }],
});
function readAuth() { return JSON.parse(fs.readFileSync(authPath, 'utf8')); }
function reset(type, mode) { fs.writeFileSync(authPath, JSON.stringify(original(type, mode))); }
function complete(type, mode) {
  return completePendingGoogleSession({
    dataPath, authPath, pendingHash,
    accountId: type === 'staff' ? 'teacher1' : 'student1', mode,
    remember: type === 'staff',
  });
}
try {
  fs.writeFileSync(dataPath, JSON.stringify({
    users: [{ id: 'teacher1', role: 'teacher', active: true }],
    students: [{ id: 'student1', active: true }],
  }));
  for (const [type, mode] of [
    ['staff', 'staff-approved'],
    ['student', 'student-approved'],
    ['student', 'student-prelinked'],
  ]) {
    reset(type, mode);
    const held = acquireFileLock(dataPath + '.database-write.lock');
    try {
      assert.throws(() => complete(type, mode), { code: 'DATABASE_WRITE_BUSY' });
      assert.equal(readAuth().pendingIdentities.length, 1,
        'A busy lock must never consume pending before session creation');
    } finally { held(); }

    const result = complete(type, mode);
    const persisted = readAuth();
    assert.equal(persisted.pendingIdentities.length, 0);
    const newRecord = persisted.sessions.find(s => s.tokenHash === core.tokenHash(result.token));
    assert.ok(newRecord, 'The new Google session and pending consumption commit together');
    assert.equal(newRecord.authMethod, 'google');
    assert.match(newRecord.accountFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(core.resolveSession(persisted, result.token)?.userId,
      type === 'staff' ? 'teacher1' : 'student1');
    if (mode === 'student-prelinked') {
      assert.equal(persisted.links[0].sub, 'student-sub');
      assert.equal(persisted.linkRequests[0].status, 'superseded');
      assert.equal(persisted.sessions.some(s => s.tokenHash === 'old-token'), false);
      assert.ok(newRecord, 'New session is not revoked along with previous sessions');
    }
    assert.throws(() => complete(type, mode), { code: 'DATABASE_WRITE_CONFLICT' },
      'A pending identity cannot be consumed twice');
  }
  console.log('Google pending identities and sessions commit atomically');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
