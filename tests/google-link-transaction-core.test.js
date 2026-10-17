'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonSnapshot, commitJsonSnapshot, mutateJsonLocked } =
  require('../database-write-coordinator');
const { commitPairedJson } = require('../paired-store-commit');
const { acquireFileLock } = require('../book-import-reminder-mail');
const core = require('../google-auth-core');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-google-atomic-'));
const dataPath = path.join(folder, 'db.json');
const authPath = dataPath + '.auth.json';
const now = Date.now();
const original = () => ({
  ...core.emptyAuthStore(),
  links: [{ accountType: 'student', accountId: 's1', email: 'old@koraaledu.nl', sub: 'sub-old' }],
  sessions: [
    { tokenHash: 'old-session', type: 'student', userId: 's1', expiresAt: now + 100000 },
    { tokenHash: 'staff-session', type: 'staff', userId: 'teacher1', expiresAt: now + 100000 },
  ],
  linkRequests: [{ id: 'old-request', studentId: 's1',
    email: 'old@koraaledu.nl', status: 'pending', createdAt: new Date(now).toISOString() }],
});
function assertSafe() {
  const result = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  assert.equal(result.links[0].email, 'new@koraaledu.nl');
  assert.equal(result.sessions.some(x => x.tokenHash === 'old-session'), false);
  assert.equal(result.sessions.some(x => x.tokenHash === 'staff-session'), true);
  assert.equal(result.linkRequests[0].status, 'superseded');
}
try {
  fs.writeFileSync(dataPath, JSON.stringify({ students: [{ id: 's1' }] }));
  fs.writeFileSync(authPath, JSON.stringify(original()));

  // Success is atomic: there is no point where the new link is committed
  // while the old session or pending link request remains usable.
  const current = readJsonSnapshot(authPath);
  current.links[0].email = 'new@koraaledu.nl';
  current.links[0].sub = '';
  commitJsonSnapshot({ dataPath: authPath, value: current, lockPath: dataPath });
  assertSafe();
  assert.equal(current.linkRequests[0].status, 'superseded',
    'The in-memory version must reflect automatic security cleanup');

  // A held lock blocks the entire link change, not just its cleanup.
  fs.writeFileSync(authPath, JSON.stringify(original()));
  const held = acquireFileLock(dataPath + '.database-write.lock');
  try {
    const candidate = readJsonSnapshot(authPath);
    candidate.links[0].email = 'new@koraaledu.nl';
    assert.throws(() => commitJsonSnapshot({
      dataPath: authPath, value: candidate, lockPath: dataPath,
    }), { code: 'DATABASE_WRITE_BUSY' });
    assert.equal(JSON.parse(fs.readFileSync(authPath, 'utf8')).links[0].email,
      'old@koraaledu.nl');
  } finally { held(); }

  // Security cleanup applies to paired DB+auth changes as well.
  const pairedData = readJsonSnapshot(dataPath);
  const pairedAuth = readJsonSnapshot(authPath);
  const updatedAuth = structuredClone(pairedAuth);
  updatedAuth.links[0].email = 'new@koraaledu.nl';
  updatedAuth.links[0].sub = '';
  commitPairedJson({ dataPath, authPath, data: pairedData, auth: updatedAuth,
    expectedData: pairedData, expectedAuth: pairedAuth });
  assertSafe();

  // Read-under-lock auth mutations also enforce the invariants.
  fs.writeFileSync(authPath, JSON.stringify(original()));
  mutateJsonLocked({ lockPath: dataPath, filePath: authPath,
    read: () => JSON.parse(fs.readFileSync(authPath, 'utf8')),
    mutate: store => { store.links[0].email = 'new@koraaledu.nl'; return store; },
  });
  assertSafe();

  console.log('Atomic Google-link revocation and stale-request cleanup passed');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
