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
try {
  fs.writeFileSync(dataPath, JSON.stringify(initial()));
  // A concurrent book mutation previously caused final saveDb() to conflict.
  const stale = readJsonSnapshot(dataPath);
  const concurrent = readJsonSnapshot(dataPath);
  concurrent.books.push({ id: 'new-independent-book' });
  commitJsonSnapshot({ dataPath, value: concurrent });
  assert.throws(() => commitJsonSnapshot({ dataPath, value: stale }),
    { code: 'DATABASE_WRITE_CONFLICT' });

  finishLegacyImportJob({ dataPath, jobId: 'job1', succeeded: true,
    payload: { created: 1, updated: 0, skipped: [] }, totalRows: 1 });
  assert.equal(current().importJobs[0].status, 'completed',
    'The import was committed and must not be marked failed');
  assert.equal(current().books.length, 2,
    'Unrelated book writes must survive terminal job status persistence');
  assert.equal(finishLegacyImportJob({ dataPath, jobId: 'job1', succeeded: false }), false,
    'Failure fallback cannot change a completed job back to failed');
  assert.equal(current().importJobs[0].status, 'completed');

  // If the lock is busy, no failed completion should be written.
  fs.writeFileSync(dataPath, JSON.stringify(initial()));
  const release = acquireFileLock(dataPath + '.database-write.lock');
  try {
    assert.throws(() => finishLegacyImportJob({
      dataPath, jobId: 'job1', succeeded: true, payload: { created: 1 },
      totalRows: 1, waitMs: 30,
    }), { code: 'DATABASE_WRITE_BUSY' });
    assert.equal(current().importJobs[0].status, 'running');
  } finally { release(); }
  finishLegacyImportJob({ dataPath, jobId: 'job1', succeeded: true,
    payload: { created: 1 }, totalRows: 1 });
  assert.equal(current().importJobs[0].status, 'completed');

  console.log('Terminal import status cannot be turned into false failure');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
