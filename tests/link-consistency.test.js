'use strict';

const assert = require('assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireFileLock } = require('../book-import-reminder-mail');
const { supersedeChangedAccountRequests, reconcileLinkRequests } = require('../link-consistency-preload').__test;

(function testStudentPendingRequestIsSupersededAfterManualEmailChange() {
  const before = {
    links: [{ accountType: 'student', accountId: 's1', email: 'old@koraaledu.nl', sub: '' }],
    sessions: [], pendingIdentities: [], linkRequests: [],
  };
  const after = {
    links: [{ accountType: 'student', accountId: 's1', email: 'new@koraaledu.nl', sub: '' }],
    sessions: [], pendingIdentities: [],
    linkRequests: [{ id: 'r1', studentId: 's1', email: 'wrong@koraaledu.nl', status: 'pending' }],
  };
  assert.strictEqual(supersedeChangedAccountRequests(before, after), true);
  assert.strictEqual(after.linkRequests[0].status, 'superseded');
})();

(function testUnchangedEmailLeavesRequestAlone() {
  const before = {
    links: [{ accountType: 'staff', accountId: 't1', email: 'same@koraaledu.nl', sub: '' }],
    sessions: [], pendingIdentities: [], linkRequests: [],
  };
  const after = {
    links: [{ accountType: 'staff', accountId: 't1', email: 'same@koraaledu.nl', sub: 'verified' }],
    sessions: [], pendingIdentities: [],
    linkRequests: [{ id: 'r2', staffId: 't1', email: 'same@koraaledu.nl', status: 'pending' }],
  };
  assert.strictEqual(supersedeChangedAccountRequests(before, after), false);
  assert.strictEqual(after.linkRequests[0].status, 'pending');
})();

(function testReconciliationUsesLatestStoreInsideTheDbLock() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-link-reconcile-'));
  try {
    const dataPath = path.join(tmp, 'db.json');
    const authPath = path.join(tmp, 'db.json.auth.json');
    fs.writeFileSync(dataPath, '{}');
    const before = {
      links: [{ accountType: 'student', accountId: 's1', email: 'old@koraaledu.nl' }],
      sessions: [], pendingIdentities: [], linkRequests: [],
    };
    const latest = {
      links: [{ accountType: 'student', accountId: 's1', email: 'new@koraaledu.nl' }],
      sessions: [{ tokenHash: 'newer-login', userId: 's1', type: 'student' }],
      pendingIdentities: [],
      linkRequests: [{ id: 'pending', studentId: 's1', status: 'pending' }],
    };
    fs.writeFileSync(authPath, JSON.stringify(latest));
    const lock = acquireFileLock(dataPath + '.database-write.lock');
    assert.equal(typeof lock, 'function');
    try {
      assert.throws(() => reconcileLinkRequests(before, { dataPath, authPath }),
        { code: 'DATABASE_WRITE_BUSY' });
      assert.equal(JSON.parse(fs.readFileSync(authPath, 'utf8')).linkRequests[0].status, 'pending');
    } finally { lock(); }
    assert.equal(reconcileLinkRequests(before, { dataPath, authPath }), true);
    const result = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.equal(result.linkRequests[0].status, 'superseded');
    assert.equal(result.sessions[0].tokenHash, 'newer-login',
      'Unrelated Google session must survive the request cleanup');
    assert.equal(reconcileLinkRequests(before, { dataPath, authPath }), false,
      'No unnecessary writes when already superseded');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

console.log('Google link consistency tests geslaagd.');
