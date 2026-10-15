'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const storage = require('../database-write-coordinator');
const { acquireFileLock } = require('../book-import-reminder-mail');

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-db-tx-'));
  const dataPath = path.join(dir, 'db.json');
  try {
    fs.writeFileSync(dataPath, JSON.stringify({ books: [], history: [] }));
    const first = storage.readJsonSnapshot(dataPath);
    const stale = storage.readJsonSnapshot(dataPath);
    first.books.push({ id: 'first' });
    storage.commitJsonSnapshot({ dataPath, value: first });
    stale.history.push({ id: 'history' });
    assert.throws(() => storage.commitJsonSnapshot({ dataPath, value: stale }),
      { code: 'DATABASE_WRITE_CONFLICT' },
      'A previously loaded snapshot must not overwrite a newer update.');
    assert.deepEqual(JSON.parse(fs.readFileSync(dataPath, 'utf8')).books,
      [{ id: 'first' }]);

    const current = storage.readJsonSnapshot(dataPath);
    const clone = storage.inheritSnapshot(structuredClone(current), current);
    clone.history.push({ id: 'cloned' });
    storage.commitJsonSnapshot({ dataPath, value: clone });
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).history.length, 1);
    assert.throws(() => storage.commitJsonSnapshot({
      dataPath, value: { books: [], history: [] },
    }), { code: 'DATABASE_SNAPSHOT_UNTRACKED' });

    const busy = acquireFileLock(dataPath + '.database-write.lock');
    assert.equal(typeof busy, 'function');
    try {
      const blocked = storage.readJsonSnapshot(dataPath);
      blocked.books.push({ id: 'blocked' });
      assert.throws(() => storage.commitJsonSnapshot({ dataPath, value: blocked }),
        { code: 'DATABASE_WRITE_BUSY' });
    } finally { busy(); }
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).books.length, 1);

    // A crashed paired commit leaves a journal. An unrelated DB write must
    // not pass it and later be silently rolled back by startup recovery.
    fs.writeFileSync(dataPath + '.paired-store-journal.json', JSON.stringify({
      version: 1, data: { books: [] }, auth: { sessions: [] },
    }));
    const pending = storage.readJsonSnapshot(dataPath);
    pending.books.push({ id: 'never-written-over-journal' });
    assert.throws(() => storage.commitJsonSnapshot({ dataPath, value: pending }),
      { code: 'DATABASE_RECOVERY_REQUIRED' });
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).books.length, 1);
    fs.unlinkSync(dataPath + '.paired-store-journal.json');

    // The auth file must share the DB transaction lock. A stale Google
    // session writer cannot undo a newer login or paired-store update.
    const authPath = path.join(dir, 'auth.json');
    fs.writeFileSync(authPath, JSON.stringify({ sessions: [{ id: 'initial' }] }));
    const authCurrent = storage.readJsonSnapshot(authPath);
    const authStale = storage.readJsonSnapshot(authPath);
    authCurrent.sessions.push({ id: 'new-login' });
    storage.commitJsonSnapshot({
      dataPath: authPath, value: authCurrent, lockPath: dataPath,
    });
    authStale.sessions = [];
    assert.throws(() => storage.commitJsonSnapshot({
      dataPath: authPath, value: authStale, lockPath: dataPath,
    }), { code: 'DATABASE_WRITE_CONFLICT' });
    const busyAuth = acquireFileLock(dataPath + '.database-write.lock');
    assert.equal(typeof busyAuth, 'function');
    try {
      const authSnapshot = storage.readJsonSnapshot(authPath);
      assert.throws(() => storage.commitJsonSnapshot({
        dataPath: authPath, value: authSnapshot, lockPath: dataPath,
      }), { code: 'DATABASE_WRITE_BUSY' });
    } finally { busyAuth(); }
    storage.mutateJsonLocked({
      lockPath: dataPath, filePath: authPath,
      read: () => JSON.parse(fs.readFileSync(authPath, 'utf8')),
      mutate: store => {
        store.sessions.push({ id: 'locked-cleanup' });
        return store;
      },
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(authPath, 'utf8'))
      .sessions.map(session => session.id),
    ['initial', 'new-login', 'locked-cleanup']);
    fs.writeFileSync(dataPath + '.paired-store-journal.json',
      JSON.stringify({ version: 1, data: {}, auth: {} }));
    assert.throws(() => storage.mutateJsonLocked({
      lockPath: dataPath, filePath: authPath,
      read: () => JSON.parse(fs.readFileSync(authPath, 'utf8')),
      mutate: store => store,
    }), { code: 'DATABASE_RECOVERY_REQUIRED' });
    fs.unlinkSync(dataPath + '.paired-store-journal.json');

    const errorSnapshot = storage.readJsonSnapshot(dataPath);
    errorSnapshot.books.push({ id: 'reject' });
    assert.throws(() => storage.commitJsonSnapshot({
      dataPath, value: errorSnapshot,
      beforeWrite: () => { throw Error('validation-failure'); },
    }), /validation-failure/);
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).books.length, 1);
    const final = storage.readJsonSnapshot(dataPath);
    final.books.push({ id: 'after-error' });
    storage.commitJsonSnapshot({ dataPath, value: final });
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).books.length, 2);

    // A second Node process reads the same file, pauses while the parent
    // commits, then attempts to persist its stale version.
    const code = [
      "const tx = require(process.argv[1]);",
      "const file = process.argv[2];",
      "const snapshot = tx.readJsonSnapshot(file);",
      "process.stdout.write('ready\\n');",
      "process.stdin.once('data', () => {",
      "  snapshot.history.push({id:'child'});",
      "  try { tx.commitJsonSnapshot({dataPath:file,value:snapshot});",
      "    process.stdout.write('unexpected\\n'); }",
      "  catch(error) { process.stdout.write(error.code+'\\n'); }",
      "});",
    ].join('\n');
    const child = spawn(process.execPath,
      ['-e', code, path.join(__dirname, '..', 'database-write-coordinator.js'), dataPath],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let observed = '';
    child.stdout.on('data', buffer => { observed += buffer.toString(); });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Child did not read snapshot')), 8000);
      child.stdout.on('data', function onData() {
        if (!observed.includes('ready')) return;
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      });
      child.once('error', reject);
      child.once('exit', code => reject(Error('Child exited early: ' + code)));
    });
    const parent = storage.readJsonSnapshot(dataPath);
    parent.books.push({ id: 'parent' });
    storage.commitJsonSnapshot({ dataPath, value: parent });
    child.stdin.write('go');
    child.stdin.end();
    const [exit] = await once(child, 'exit');
    assert.equal(exit, 0);
    assert.match(observed, /DATABASE_WRITE_CONFLICT/);
    assert.doesNotMatch(observed, /unexpected/);
    const committed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(committed.books.length, 3);
    assert.equal(committed.history.some(row => row.id === 'child'), false);
    console.log('Database snapshot locking, atomic commits, stale and cross-process conflicts passed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
