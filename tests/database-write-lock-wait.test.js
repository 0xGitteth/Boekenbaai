'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { withDatabaseWriteLock } = require('../database-write-coordinator');
const { finishLegacyImportJob } = require('../book-import-job-finalization');

// Lock holders run in a second process: synchronous waiting in the parent
// would also block any release timer running in that same parent process.
async function holdInChild(dataPath, holdMs = 280) {
  const code = [
    "const { acquireFileLock } = require(process.argv[1]);",
    "const release = acquireFileLock(process.argv[2] + '.database-write.lock');",
    "if (!release) process.exit(2);",
    "process.stdout.write('locked\\n');",
    "setTimeout(() => { release(); }, Number(process.argv[3]));",
  ].join('\n');
  const child = spawn(process.execPath, ['-e', code,
    path.join(__dirname, '..', 'book-import-reminder-mail.js'),
    dataPath, String(holdMs)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(Error('Child lock not acquired')), 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('locked')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (!output.includes('locked')) {
        clearTimeout(timeout);
        reject(Error('Child exited before taking lock: ' + code));
      }
    });
  });
  return child;
}
async function waitExit(child) {
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-db-wait-'));
  const dataPath = path.join(dir, 'db.json');
  try {
    fs.writeFileSync(dataPath, JSON.stringify({
      books: [], importJobs: [{ id: 'waiting-job', status: 'running' }],
    }));
    // Startup seeding uses this same shared lock with a bounded timeout.
    const startupHolder = await holdInChild(dataPath);
    const start1 = Date.now();
    const value = withDatabaseWriteLock(dataPath, () => 'ready', { waitMs: 2500 });
    assert.equal(value, 'ready');
    assert.ok(Date.now() - start1 >= 60, 'Startup must wait for lock release');
    await waitExit(startupHolder);

    // Import finalization must FORWARD waitMs to the central coordinator.
    const importHolder = await holdInChild(dataPath);
    const start2 = Date.now();
    let eventLoopResponsive = false;
    const heartbeat = setTimeout(() => { eventLoopResponsive = true; }, 25);
    assert.equal(await finishLegacyImportJob({
      dataPath, jobId: 'waiting-job', succeeded: true,
      payload: { created: 1 }, totalRows: 1, waitMs: 2500,
    }), true);
    clearTimeout(heartbeat);
    assert.ok(eventLoopResponsive,
      'The HTTP event loop must remain responsive while awaiting a busy lock');
    assert.ok(Date.now() - start2 >= 60,
      'Import finalization must wait rather than fail immediately');
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).importJobs[0].status,
      'completed');
    await waitExit(importHolder);

    const slowHolder = await holdInChild(dataPath, 450);
    const start3 = Date.now();
    assert.throws(() => withDatabaseWriteLock(dataPath, () => true, { waitMs: 70 }),
      { code: 'DATABASE_WRITE_BUSY' });
    const elapsed = Date.now() - start3;
    assert.ok(elapsed >= 45 && elapsed < 400, 'Lock wait must be bounded');
    await waitExit(slowHolder);
    console.log('Startup and import-finalization lock waits passed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
