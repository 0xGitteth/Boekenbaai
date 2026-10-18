'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const XLSX = require('xlsx');
const { acquireFileLock } = require('../book-import-reminder-mail');

const root = path.join(__dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-import-committed-conflict-'));
const dataPath = path.join(folder, 'db.json');
const PORT = 31572;
const base = 'http://127.0.0.1:' + PORT;
const passwordHash = crypto.createHash('sha256').update('password').digest('hex');
fs.writeFileSync(dataPath, JSON.stringify({
  users: [{ id: 'admin-1', name: 'Administrator', username: 'admin',
    role: 'admin', passwordHash }],
  books: [], students: [], classes: [], folders: [], history: [], importJobs: [],
}));
const child = spawn(process.execPath, ['server.js'], {
  cwd: root, env: {
    ...process.env, PORT: String(PORT), NODE_ENV: 'test',
    BOEKENBAAI_DATA_PATH: dataPath,
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
    BOEKENBAAI_IMPORT_FINALIZE_DELAY_MS: '1500',
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
async function until(check, waitMs = 9000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error('Server exited: ' + diagnostics);
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out waiting for import condition. Stderr: ' + diagnostics);
}
async function request(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + pathname, {
    method, headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
function workbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Titel: 'Eén keer opgeslagen', Auteur: 'Test', Barcode: '900007777' },
  ]), 'Boeken');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }).toString('base64');
}
async function run() {
  let release;
  try {
    await until(async () => {
      try { return (await fetch(base + '/')).ok; } catch { return false; }
    });
    const login = await request('/api/login', { method: 'POST',
      body: { username: 'admin', password: 'password' } });
    assert.equal(login.status, 200);
    const token = login.data.token;
    assert.ok(token);
    const started = await request('/api/books/import-jobs', {
      method: 'POST', token,
      body: { file: workbook(), enrichIsbn: false, fileName: 'once.xlsx' },
    });
    assert.equal(started.status, 202, JSON.stringify(started.data));
    const jobId = started.data.jobId;
    await until(() => {
      const db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return db.importJobs.find(job => job.id === jobId)?.booksCommittedAt;
    });
    // The short commit lock can still be held when booksCommittedAt first
    // appears. Retry acquisition, without stealing the server's live lock.
    release = await until(() => acquireFileLock(dataPath + '.database-write.lock',
      { processOwned: true }) || false, 2500);
    assert.equal(typeof release, 'function');
    // Hold another writer's lock when the terminal progress update runs.
    // The endpoint must emit a warning and RETURN SUCCESS instead of
    // reporting an already committed import as failed.
    await until(() => diagnostics.includes('Boeken zijn opgeslagen; importstatus wordt apart voltooid:'),
      5000);
    release();
    release = null;
    const completed = await until(async () => {
      const result = await request('/api/books/import-jobs/' + jobId, { token });
      return result.data.status === 'completed' ? result.data : false;
    }, 12000);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.created, 1);
    assert.equal(completed.error, '');
    const database = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(database.books.filter(book => book.barcode === '900007777').length, 1);
    assert.ok(database.importJobs.find(job => job.id === jobId)?.booksCommittedAt);
    console.log('Committed book import survives terminal progress lock conflict');
  } finally {
    if (release) release();
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
