'use strict';

// Run the actual cover-worker functions in an isolated server environment.
// The test simulates an import stage left open and repeated disk-write errors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { planCoverBackfill } = require('../lib/cover-backfill-plan');

const source = 'https://covers.example.org/shared.png';
const cached = '/api/covers/' + 'a'.repeat(64) + '.png';
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = serverSource.indexOf('function scheduleBackfillRetry()');
const end = serverSource.indexOf('function runCoverGarbageCollection()', start);
assert(start >= 0 && end > start, 'Cover worker must be present in server.js');
const workerCode = serverSource.slice(start, end);

const books = [
  { id: 'missing', coverUrl: source, localCoverUrl: '' },
  { id: 'sibling', coverUrl: source, localCoverUrl: cached },
];
let writeAttempts = 0;
let rejectWrites = true;
const stage = { status: 'open' }; // Real UI polling keeps this stage alive.
const fakeTimer = () => ({ unref() {} });
const ctx = {
  shuttingDown: false, coverBackfillRunning: false,
  coverBackfillScheduled: false, coverBackfillPending: false,
  coverBackfillFailures: new Map(), coverBackfillRetryTimer: null,
  coverRetryDelays: [30000, 120000, 600000],
  activeBookImportLease: null,
  bookImportStageStore: { active: () => stage },
  coverAssets: {
    hasAsset: (url) => url === cached,
    saveSource: async () => { throw Error('cached image should avoid network'); },
  },
  planCoverBackfill,
  loadDb: () => ({ books: books.map((b) => ({ ...b })) }),
  saveDb: (db) => {
    writeAttempts += 1;
    if (rejectWrites) throw Error('persistent volume is read-only');
    books.splice(0, books.length, ...db.books);
  },
  setImmediate, setTimeout: fakeTimer, clearTimeout: () => {},
  Date, Promise, console: { warn() {} },
};
vm.runInNewContext(workerCode, ctx, { filename: 'server-cover-worker.js' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function finishPass(expectedWrites) {
  for (let i = 0; i < 100; i++) {
    if (writeAttempts === expectedWrites && !ctx.coverBackfillRunning && !ctx.coverBackfillScheduled) return;
    await delay(5);
  }
  ctx.shuttingDown = true;
  throw Error('Cover backfill blocked; open import stages must not hold image writes');
}

async function run() {
  for (let attempts = 1; attempts <= 4; attempts++) {
    const previous = ctx.coverBackfillFailures.get(source);
    if (previous) previous.nextRetryAt = 0; // Advance the cooldown deterministically.
    ctx.scheduleCoverBackfill();
    await finishPass(attempts);
    const error = ctx.coverBackfillFailures.get(source);
    assert.equal(error?.phase, 'link');
    assert.equal(error?.localAsset, cached, 'Retain the unlinked asset for subsequent write attempts');
    assert.equal(error?.attempts, attempts, 'Retry count must persist across failed writes');
    if (attempts === 1) books.splice(1, 1); // Cached sibling disappears after first failed write.
    assert.equal(books[0].localCoverUrl, '', 'Failed DB saves must not pretend to link a cover');
  }
  ctx.scheduleCoverBackfill();
  await delay(30);
  assert.equal(writeAttempts, 4, 'Exhausted retries must not keep writing indefinitely');

  // A deliberate new scheduling request may reset an exhausted attempt set.
  // Once a write succeeds, the link and the failure entry must be committed.
  rejectWrites = false;
  books.push({ id: 'sibling-restored', coverUrl: source, localCoverUrl: cached });
  ctx.scheduleCoverBackfill({ resetFailures: true });
  await finishPass(5);
  assert.equal(books[0].localCoverUrl, cached);
  assert.equal(ctx.coverBackfillFailures.has(source), false);
  ctx.shuttingDown = true;
  console.log('Cover worker open-stage and persistent-write retry regressions passed');
}
run().catch((error) => { ctx.shuttingDown = true; console.error(error); process.exitCode = 1; });
