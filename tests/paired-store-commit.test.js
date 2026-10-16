'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  commitPairedJson,
  recoverPairedJson,
  journalPathFor,
  __test,
} = require('../paired-store-commit');
const { readJsonSnapshot } = require('../database-write-coordinator');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-paired-store-'));
const dataPath = path.join(tmp, 'db.json');
const authPath = path.join(tmp, 'auth.json');
const journalPath = journalPathFor(dataPath);

try {
  fs.writeFileSync(dataPath, JSON.stringify({ version: 'old-db' }));
  fs.writeFileSync(authPath, JSON.stringify({ version: 'old-auth' }));

  const committedData = { version: 'new-db', students: [{ id: 'student-1' }] };
  const committedAuth = { version: 'new-auth', sessions: [], links: [] };
  const firstData = readJsonSnapshot(dataPath);
  const firstAuth = readJsonSnapshot(authPath);
  commitPairedJson({ dataPath, authPath, data: committedData, auth: committedAuth,
    expectedData: firstData, expectedAuth: firstAuth });

  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataPath, 'utf8')), committedData);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), committedAuth);
  assert.strictEqual(fs.existsSync(journalPath), false, 'Na een volledige paired commit mag geen journal achterblijven');

  // A stale paired commit must never roll back a completed DB or auth write.
  const staleData = readJsonSnapshot(dataPath);
  const staleAuth = readJsonSnapshot(authPath);
  const changedDb = readJsonSnapshot(dataPath);
  changedDb.version = 'concurrent-db';
  const { commitJsonSnapshot } = require('../database-write-coordinator');
  commitJsonSnapshot({ dataPath, value: changedDb });
  assert.throws(() => commitPairedJson({ dataPath, authPath,
    data: committedData, auth: committedAuth,
    expectedData: staleData, expectedAuth: staleAuth,
  }), { code: 'DATABASE_WRITE_CONFLICT' });
  assert.strictEqual(JSON.parse(fs.readFileSync(dataPath, 'utf8')).version, 'concurrent-db');
  assert.strictEqual(fs.existsSync(journalPath), false);

  const currentData = readJsonSnapshot(dataPath);
  const currentAuth = readJsonSnapshot(authPath);
  const updatedAuth = readJsonSnapshot(authPath);
  updatedAuth.version = 'concurrent-auth';
  // Writes from other auth modules will eventually share this same DB lock.
  const { withDatabaseWriteLock } = require('../database-write-coordinator');
  withDatabaseWriteLock(dataPath, () => {
    __test.atomicWriteJson(authPath, updatedAuth);
  });
  assert.throws(() => commitPairedJson({ dataPath, authPath,
    data: committedData, auth: committedAuth,
    expectedData: currentData, expectedAuth: currentAuth,
  }), { code: 'DATABASE_WRITE_CONFLICT' });
  assert.strictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')).version, 'concurrent-auth');
  assert.strictEqual(fs.existsSync(journalPath), false);

  const recoveredData = { version: 'recovered-db', students: [{ id: 'student-2' }] };
  const recoveredAuth = { version: 'recovered-auth', sessions: [{ userId: 'student-2' }], links: [] };

  // Simuleer een procescrash nadat db.json al vervangen is maar vóór auth.json.
  __test.atomicWriteJson(journalPath, {
    version: 1,
    createdAt: new Date().toISOString(),
    data: recoveredData,
    auth: recoveredAuth,
  });
  __test.atomicWriteJson(dataPath, recoveredData);
  __test.atomicWriteJson(authPath, committedAuth);

  assert.notDeepStrictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), recoveredAuth);
  assert.strictEqual(recoverPairedJson({ dataPath, authPath }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataPath, 'utf8')), recoveredData);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')), recoveredAuth);
  assert.strictEqual(fs.existsSync(journalPath), false, 'Herstel moet het journal pas na beide writes verwijderen');
  assert.strictEqual(recoverPairedJson({ dataPath, authPath }), false, 'Zonder journal is herstel een no-op');
  // Reclaim a dead writer's lock before its 5-minute stale deadline.
  const { spawnSync } = require('node:child_process');
  const child = spawnSync(process.execPath, ['-e', [
    "const { acquireFileLock } = require(process.argv[1]);",
    "const release = acquireFileLock(process.argv[2] + '.database-write.lock', { processOwned: true });",
    "if (!release) process.exit(2);",
    "process.exit(0);",
  ].join('\n'), path.join(__dirname, '..', 'book-import-reminder-mail.js'), dataPath]);
  assert.strictEqual(child.status, 0);
  assert.strictEqual(fs.existsSync(dataPath + '.database-write.lock'), true);
  const reclaimedAt = Date.now();
  assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), false);
  assert.ok(Date.now() - reclaimedAt < 1800, 'Dead database owner must not block recovery for five minutes');
  assert.strictEqual(fs.existsSync(dataPath + '.database-write.lock'), false);

  // A crash in the middle of a paired DB/auth swap must recover the journal
  // even when the dead process left its own process-owned write lock behind.
  __test.atomicWriteJson(journalPath, {
    version: 1, data: { version: 'after-crash-db' },
    auth: { version: 'after-crash-auth' },
  });
  __test.atomicWriteJson(dataPath, { version: 'after-crash-db' });
  const deadWriter = spawnSync(process.execPath, ['-e', [
    "const { acquireFileLock } = require(process.argv[1]);",
    "const lock = acquireFileLock(process.argv[2] + '.database-write.lock', { processOwned: true });",
    "if (!lock) process.exit(2);",
    "process.exit(0);",
  ].join('\n'), path.join(__dirname, '..', 'book-import-reminder-mail.js'), dataPath]);
  assert.strictEqual(deadWriter.status, 0);
  assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(authPath, 'utf8')).version, 'after-crash-auth');
  assert.strictEqual(fs.existsSync(journalPath), false);

  // Simulate a crashed process leaving only the tiny acquisition guard.
  // A live guard must not be stolen, but a dead local owner is recoverable.
  const guardFile = dataPath + '.database-write.lock.guard';
  const { hostname } = require('node:os');
  const guardOwner = spawnSync(process.execPath, ['-e', [
    "const fs = require('fs');",
    "const os = require('os');",
    "fs.writeFileSync(process.argv[1], JSON.stringify({",
    "format: 'boekenbaai-lock-guard-v1', pid: process.pid, host: os.hostname() }));",
  ].join('\n'), guardFile]);
  assert.strictEqual(guardOwner.status, 0, guardOwner.stderr?.toString());
  assert.strictEqual(fs.existsSync(guardFile), true);
  assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), false);
  assert.strictEqual(fs.existsSync(guardFile), false);
  assert.strictEqual(fs.existsSync(guardFile + '.reaper'), false);
  // Two successive crashes: first a guard owner, then the reaper that
  // tried to remove it. Startup must recover both orphan files.
  const guardReaper = guardFile + '.reaper';
  const doubleCrash = spawnSync(process.execPath, ['-e', [
    "const fs = require('fs');",
    "const os = require('os');",
    "for (const file of process.argv.slice(1)) fs.writeFileSync(file,",
    "JSON.stringify({ format: 'boekenbaai-lock-guard-v1',",
    "pid: process.pid, host: os.hostname() }));",
  ].join('\n'), guardFile, guardReaper]);
  assert.strictEqual(doubleCrash.status, 0, doubleCrash.stderr?.toString());
  assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), false,
    'Orphaned guard and orphaned reaper must both be reclaimed');
  assert.strictEqual(fs.existsSync(guardFile), false);
  assert.strictEqual(fs.existsSync(guardReaper), false);

  // A live reaper must not be stolen, even while its target guard is dead.
  const liveReaperGuard = spawnSync(process.execPath, ['-e', [
    "const fs = require('fs');",
    "const os = require('os');",
    "fs.writeFileSync(process.argv[1], JSON.stringify({",
    "format: 'boekenbaai-lock-guard-v1', pid: process.pid, host: os.hostname() }));",
  ].join('\n'), guardFile]);
  assert.strictEqual(liveReaperGuard.status, 0);
  fs.writeFileSync(guardReaper, JSON.stringify({
    format: 'boekenbaai-lock-guard-v1', pid: process.pid, host: hostname(),
  }));
  assert.throws(() => recoverPairedJson({ dataPath, authPath, waitMs: 40 }),
    { code: 'DATABASE_WRITE_BUSY' });
  assert.strictEqual(fs.existsSync(guardReaper), true);
  fs.unlinkSync(guardReaper);
  fs.unlinkSync(guardFile);

  // An actual live guard owner must remain protected.
  fs.writeFileSync(guardFile, JSON.stringify({
    format: 'boekenbaai-lock-guard-v1', pid: process.pid, host: hostname(),
  }));
  assert.throws(() => recoverPairedJson({ dataPath, authPath, waitMs: 40 }),
    { code: 'DATABASE_WRITE_BUSY' });
  fs.unlinkSync(guardFile);

  // A container can restart with precisely the same hostname and PID 1.
  // An older kernel start tick proves the owner is NOT the live process,
  // even though process.kill(pid, 0) reports a running PID.
  if (fs.existsSync('/proc/self/stat')) {
    const kernelStat = fs.readFileSync('/proc/self/stat', 'utf8');
    const myTick = kernelStat.slice(kernelStat.lastIndexOf(') ') + 2)
      .trim().split(/\s+/)[19];
    assert.match(myTick, /^\d+$/);
    const recycled = JSON.stringify({
      format: 'boekenbaai-lock-guard-v1',
      pid: process.pid, host: hostname(), pidStartTicks: '0',
    });
    fs.writeFileSync(guardFile, recycled);
    fs.writeFileSync(guardReaper, recycled);
    assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), false,
      'Same PID but different kernel process generation must reclaim both artifacts');
    assert.strictEqual(fs.existsSync(guardFile), false);
    assert.strictEqual(fs.existsSync(guardReaper), false);

    // A genuinely LIVE local process must still be protected even when its
    // lock file looks old. Age alone may not steal verified live ownership.
    fs.writeFileSync(guardFile, JSON.stringify({
      format: 'boekenbaai-lock-guard-v1',
      pid: process.pid, host: hostname(), pidStartTicks: myTick,
    }));
    const ancient = new Date(Date.now() - 6 * 60 * 1000);
    fs.utimesSync(guardFile, ancient, ancient);
    assert.throws(() => recoverPairedJson({ dataPath, authPath, waitMs: 60 }),
      { code: 'DATABASE_WRITE_BUSY' });
    fs.unlinkSync(guardFile);
  }
  // Prior deployments wrote only hostname/PID (no kernel generation).
  // Those old files still have a bounded recovery even if PID was reused.
  const legacyOwner = JSON.stringify({
    format: 'boekenbaai-lock-guard-v1', pid: process.pid, host: hostname(),
  });
  fs.writeFileSync(guardFile, legacyOwner);
  fs.writeFileSync(guardReaper, legacyOwner);
  const legacyOld = new Date(Date.now() - 6 * 60 * 1000);
  fs.utimesSync(guardFile, legacyOld, legacyOld);
  fs.utimesSync(guardReaper, legacyOld, legacyOld);
  assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), false,
    'Legacy PID-only guards must not remain blocked forever after PID reuse');
  assert.strictEqual(fs.existsSync(guardFile), false);
  assert.strictEqual(fs.existsSync(guardReaper), false);

  // Rolling deployment may change container hostname. Unknown remote
  // guard+reaper owners are protected while fresh, but old synchronous
  // artifacts must not wedge all future database writes forever.
  const otherHostOwner = JSON.stringify({
    format: 'boekenbaai-lock-guard-v1', pid: 1234,
    host: 'previous-container-host',
  });
  fs.writeFileSync(guardFile, otherHostOwner);
  fs.writeFileSync(guardReaper, otherHostOwner);
  assert.throws(() => recoverPairedJson({ dataPath, authPath, waitMs: 40 }),
    { code: 'DATABASE_WRITE_BUSY' }, 'Fresh remote owner must be protected');
  const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000);
  fs.utimesSync(guardFile, oldTimestamp, oldTimestamp);
  fs.utimesSync(guardReaper, oldTimestamp, oldTimestamp);
  assert.strictEqual(recoverPairedJson({ dataPath, authPath, waitMs: 2000 }), false);
  assert.strictEqual(fs.existsSync(guardFile), false);
  assert.strictEqual(fs.existsSync(guardReaper), false);

  // A healthy other process may temporarily hold the shared writer lock.
  // Startup recovery must retry boundedly rather than abort immediately.
  const { acquireFileLock } = require('../book-import-reminder-mail');
  const occupied = acquireFileLock(dataPath + '.database-write.lock');
  assert.equal(typeof occupied, 'function');
  try {
    const started = Date.now();
    assert.throws(() => recoverPairedJson({ dataPath, authPath, waitMs: 70 }),
      { code: 'DATABASE_WRITE_BUSY' });
    assert.ok(Date.now() - started >= 50, 'Recovery must wait before giving up');
  } finally { occupied(); }
  assert.strictEqual(recoverPairedJson({ dataPath, authPath }), false,
    'Startup recovers normally once a competing writer has released its lock');


  const managementSource = fs.readFileSync(path.join(__dirname, '..', 'student-management-preload.js'), 'utf8');
  const deactivateMatch = managementSource.match(/function deactivateStudent[\s\S]*?function stripCookie/);
  assert.ok(deactivateMatch, 'De deactivatieroute moet vindbaar blijven voor de atomiciteitsregressie');
  assert.match(
    deactivateMatch[0],
    /commitPairedJson\(\{[\s\S]*dataPath:\s*DATA_PATH[\s\S]*authPath:\s*AUTH_DATA_PATH/,
    'Leerling afmelden moet database en auth-store via één herstelbare paired commit opslaan'
  );
  assert.doesNotMatch(
    deactivateMatch[0],
    /writeJsonAtomic\(DATA_PATH,[\s\S]*saveAuthStore\(/,
    'Leerling afmelden mag database en auth-store niet meer als losse writes opslaan'
  );

  console.log('Paired store commit tests geslaagd.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
