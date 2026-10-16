'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finishLegacyImportJob } = require('../book-import-job-finalization');
const { acquireFileLock } = require('../book-import-reminder-mail');
const { readJsonSnapshot, commitJsonSnapshot } = require('../database-write-coordinator');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-finish-'));
const dataPath = path.join(dir, 'db.json');
const initial = () => ({
  books: [{ id: 'already-imported' }],
  importJobs: [{ id: 'job1', status: 'running', cancelRequested: false }],
});
const current = () => JSON.parse(fs.readFileSync(dataPath, 'utf8'));
async function run() {
try {
  fs.writeFileSync(dataPath, JSON.stringify(initial()));
  // A concurrent book mutation previously caused final saveDb() to conflict.
  const stale = readJsonSnapshot(dataPath);
  const concurrent = readJsonSnapshot(dataPath);
  concurrent.books.push({ id: 'new-independent-book' });
  commitJsonSnapshot({ dataPath, value: concurrent });
  assert.throws(() => commitJsonSnapshot({ dataPath, value: stale }),
    { code: 'DATABASE_WRITE_CONFLICT' });

  await finishLegacyImportJob({ dataPath, jobId: 'job1', succeeded: true,
    payload: { created: 1, updated: 0, skipped: [] }, totalRows: 1 });
  assert.equal(current().importJobs[0].status, 'completed',
    'The import was committed and must not be marked failed');
  assert.equal(current().books.length, 2,
    'Unrelated book writes must survive terminal job status persistence');
  assert.equal(await finishLegacyImportJob({ dataPath, jobId: 'job1', succeeded: false }), false,
    'Failure fallback cannot change a completed job back to failed');
  assert.equal(current().importJobs[0].status, 'completed');

  // If the lock is busy, no failed completion should be written.
  fs.writeFileSync(dataPath, JSON.stringify(initial()));
  const release = acquireFileLock(dataPath + '.database-write.lock');
  try {
    await assert.rejects(() => finishLegacyImportJob({
      dataPath, jobId: 'job1', succeeded: true, payload: { created: 1 },
      totalRows: 1, waitMs: 30,
    }), { code: 'DATABASE_WRITE_BUSY' });
    assert.equal(current().importJobs[0].status, 'running');
  } finally { release(); }
  await finishLegacyImportJob({ dataPath, jobId: 'job1', succeeded: true,
    payload: { created: 1 }, totalRows: 1 });
  assert.equal(current().importJobs[0].status, 'completed');


  // Books were durably saved together with a completion marker, but a
  // concurrent writer prevented the *terminal progress* update. The direct
  // endpoint responded with an error. A fallback MUST NOT mark this as
  // failed and suggest importing the books a second time.
  const committed = initial();
  committed.importJobs[0].booksCommittedAt = new Date().toISOString();
  committed.importJobs[0].committedSummary = {
    processed: 4, created: 3, updated: 1, skipped: 0, failed: 0,
  };
  fs.writeFileSync(dataPath, JSON.stringify(committed));
  const busyLock = acquireFileLock(dataPath + '.database-write.lock');
  try {
    await assert.rejects(() => finishLegacyImportJob({
      dataPath, jobId: 'job1', succeeded: false,
      errorMessage: 'Database temporarily busy after successful book commit',
      waitMs: 30,
    }), { code: 'DATABASE_WRITE_BUSY' });
    assert.equal(current().importJobs[0].status, 'running');
  } finally { busyLock(); }
  await finishLegacyImportJob({
    dataPath, jobId: 'job1', succeeded: false, totalRows: 4,
    errorMessage: 'Internal endpoint replied with a status write error',
  });
  assert.equal(current().importJobs[0].status, 'completed');
  assert.equal(current().importJobs[0].error, '');
  assert.equal(current().importJobs[0].created, 3);
  assert.equal(current().importJobs[0].updated, 1);
  assert.equal(current().importJobs[0].processed, 4);
  assert.equal(current().books.length, 1, 'Fallback must never duplicate book writes');
  assert.equal(await finishLegacyImportJob({
    dataPath, jobId: 'job1', succeeded: false,
  }), false, 'A late error cannot change an already completed import');

  console.log('Terminal import status cannot be turned into false failure');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
