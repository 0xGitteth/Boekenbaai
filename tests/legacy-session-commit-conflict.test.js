'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { acquireFileLock } = require('../book-import-reminder-mail');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-session-conflicts-'));
const dataPath = path.join(tmp, 'db.json');
const port = 31563;
const baseUrl = 'http://127.0.0.1:' + port;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
fs.writeFileSync(dataPath, JSON.stringify({
  users: [
    { id: 'admin-1', name: 'Beheer', username: 'beheer',
      passwordHash: hash('admin-pass'), role: 'admin', classIds: [] },
    { id: 'teacher-1', name: 'Docent', username: 'docent',
      passwordHash: hash('teacher-pass'), role: 'teacher', classIds: [] },
  ],
  students: [
    { id: 'student-1', name: 'Leerling', username: 'leerling',
      passwordHash: hash('student-pass'), classIds: [], borrowedBooks: [] },
  ],
  books: [], history: [], classes: [], folders: [], importJobs: [],
}));
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env, PORT: String(port),
    BOEKENBAAI_DATA_PATH: dataPath, NODE_ENV: 'test',
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let result = {};
  try { result = await response.json(); } catch {}
  return { status: response.status, result };
}
async function waitReady() {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error('Server stopped: ' + stderr);
    try { await fetch(baseUrl + '/api/me'); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 35)); }
  }
  throw Error('Server did not become ready: ' + stderr);
}
async function login(username, password) {
  const result = await call('/api/login', { method: 'POST',
    body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.result));
  assert.ok(result.result.token);
  return result.result.token;
}
async function run() {
  try {
    await waitReady();
    const admin = await login('beheer', 'admin-pass');
    const teacher = await login('docent', 'teacher-pass');
    const student = await login('leerling', 'student-pass');
    const before = fs.readFileSync(dataPath, 'utf8');
    const cases = [
      ['PATCH', '/api/teachers/teacher-1', { temporaryPassword: 'changed-teacher-pass' }],
      ['POST', '/api/teachers/teacher-1/reset-password'],
      ['DELETE', '/api/teachers/teacher-1'],
      ['POST', '/api/students/student-1/reset-password'],
      ['PATCH', '/api/students/student-1', { temporaryPassword: 'changed-student-pass' }],
      ['DELETE', '/api/students/student-1'],
    ];
    for (const [method, pathname, body] of cases) {
      const release = acquireFileLock(dataPath + '.database-write.lock',
        { processOwned: true });
      assert.equal(typeof release, 'function');
      try {
        const rejected = await call(pathname, { method, token: admin, body });
        assert.equal(rejected.status, 409, method + ' ' + pathname + ': '
          + JSON.stringify(rejected.result));
        assert.equal(fs.readFileSync(dataPath, 'utf8'), before,
          'Rejected optimistic write must not change account database');
        assert.equal((await call('/api/me', { token: teacher })).status, 200,
          'Teacher must remain logged in after rejected account edit');
        assert.equal((await call('/api/me', { token: student })).status, 200,
          'Student must remain logged in after rejected account edit');
      } finally { release(); }
    }
    const success = await call('/api/teachers/teacher-1/reset-password',
      { method: 'POST', token: admin });
    assert.equal(success.status, 200, JSON.stringify(success.result));
    assert.equal((await call('/api/me', { token: teacher })).status, 401,
      'Successful password reset must revoke previous teacher session');
    assert.equal((await call('/api/me', { token: student })).status, 200,
      'Other users must remain signed in');
    console.log('Legacy sessions revoked only after durable account commit');
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
