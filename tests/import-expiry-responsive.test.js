'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { acquireFileLock } = require('../book-import-reminder-mail');

const root = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-poll-lock-'));
const dbPath = path.join(folder, 'db.json');
const port = 31569;
const base = 'http://127.0.0.1:' + port;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
fs.writeFileSync(dbPath, JSON.stringify({
  users: [{ id: 'admin-1', role: 'admin', name: 'Beheer', username: 'beheer',
    passwordHash: hash('secret') }],
  students: [], classes: [], folders: [], books: [], history: [], importJobs: [],
}));
const server = spawn(process.execPath, ['server.js'], {
  cwd: root, env: {
    ...process.env, PORT: String(port), NODE_ENV: 'test',
    BOEKENBAAI_DATA_PATH: dbPath, BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += chunk.toString(); });
async function ready() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error('Server stopped: ' + stderr);
    try { const res = await fetch(base + '/'); if (res.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw Error('Server startup timeout: ' + stderr);
}
async function run() {
  let release;
  try {
    await ready();
    const login = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'beheer', password: 'secret' }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(token);

    // This import expired *after* startup. Polling must reconcile it at
    // runtime, but never block the health/status handler on a busy DB lock.
    const latest = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    latest.importJobs.push({
      id: 'stale-import', type: 'books_import', createdBy: 'admin-1',
      status: 'running', lastProgressAt: new Date().toISOString(),
      owner: { version: 1, host: 'departed-host', pid: 12345,
        instanceId: 'old-process', leaseExpiresAt: Date.now() - 500 },
    });
    fs.writeFileSync(dbPath, JSON.stringify(latest));

    release = acquireFileLock(dbPath + '.database-write.lock', { processOwned: true });
    assert.equal(typeof release, 'function');
    const poll = fetch(base + '/api/books/import-jobs/stale-import', {
      headers: { Authorization: 'Bearer ' + token },
    });
    await new Promise(resolve => setTimeout(resolve, 80));
    const start = Date.now();
    const health = await fetch(base + '/api/status', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(1200),
    });
    assert.equal(health.status, 200);
    assert.ok(Date.now() - start < 1100,
      'Unrelated HTTP handlers must stay responsive during import reconciliation');

    release();
    release = null;
    const result = await poll;
    assert.equal(result.status, 200);
    assert.equal((await result.json()).status, 'interrupted',
      'The pending poll should complete after the DB lock is released');
    console.log('Import-status polling does not block the HTTP event loop');
  } finally {
    if (release) release();
    server.kill('SIGTERM');
    if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
