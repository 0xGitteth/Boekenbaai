'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const core = require('../google-auth-core');
const pins = require('../student-pin-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
// vite.config.js uses publicDir: false; classic scripts and their stylesheet
// have to be explicitly copied into the production distribution.
const viteConfig = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
const studentPage = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
for (const asset of ['student-pin.js', 'student-pin.css']) {
  assert.ok(viteConfig.includes("'" + asset + "'"), 'Production build must copy ' + asset);
  assert.ok(studentPage.includes('"' + asset + '"'), 'Student page must load ' + asset);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-pin-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = dbPath + '.auth.json';
const port = 31951;
const base = 'http://127.0.0.1:' + port;
const secret = 'student-pin-tests-long-secret-2026';
const db = {
  books: [], history: [],
  students: [
    { id: 'student-a', name: 'Leerling A', active: true, passwordHash: 'student-a-hash',
      classIds: ['class-a'], borrowedBooks: [] },
    { id: 'student-b', name: 'Leerling B', active: true, passwordHash: 'student-b-hash',
      classIds: ['class-b'], borrowedBooks: [] },
  ],
  users: [
    { id: 'teacher-a', role: 'teacher', active: true, passwordHash: 'hash-teacher',
      classIds: ['class-a'] },
    { id: 'teacher-b', role: 'teacher', active: true, passwordHash: 'hash-teacher-b',
      classIds: ['class-b'] },
    { id: 'admin', role: 'admin', active: true, passwordHash: 'hash-admin' },
  ],
  classes: [
    { id: 'class-a', studentIds: ['student-a'], teacherIds: ['teacher-a'] },
    { id: 'class-b', studentIds: ['student-b'], teacherIds: ['teacher-b'] },
  ],
};
fs.writeFileSync(dbPath, JSON.stringify(db));
const tokens = {
  google: 'google-student-token',
  local: 'password-student-token',
  teacherA: 'teacher-a-token',
  teacherB: 'teacher-b-token',
  admin: 'admin-token',
};
let store = core.emptyAuthStore();
store.links.push({
  accountType: 'student', accountId: 'student-a', email: 'student.a@koraaledu.nl',
  sub: 'verified-google-a',
});
for (const [key, accountId, type, authMethod] of [
  ['google', 'student-a', 'student', 'google'],
  ['local', 'student-a', 'student', 'password'],
  ['teacherA', 'teacher-a', 'staff', 'google'],
  ['teacherB', 'teacher-b', 'staff', 'google'],
  ['admin', 'admin', 'staff', 'password'],
]) {
  const record = core.upsertSession(store, tokens[key],
    { userId: accountId, type, now: Date.now() });
  store = record.store;
  const account = type === 'student'
    ? { ...db.students.find(s => s.id === accountId), role: 'student' }
    : db.users.find(s => s.id === accountId);
  record.session.accountFingerprint = accountCredentialFingerprint(account);
  record.session.authMethod = authMethod;
}
fs.writeFileSync(authPath, JSON.stringify(store));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'student-pin-preload.js'), '-e',
  'require("node:http").createServer((req,res)=>{res.statusCode=404;res.end("not found")}).listen(Number(process.env.PORT),"127.0.0.1");',
], {
  env: {
    ...process.env, PORT: String(port), BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath, BOEKENBAAI_AUTH_SECRET: secret,
    BOEKENBAAI_PUBLIC_URL: base,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const errors = [];
child.stderr.on('data', chunk => errors.push(String(chunk)));

async function ready() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw Error('PIN server exit: ' + errors.join(''));
    try {
      const response = await fetch(base + '/nonexistent');
      if (response.status === 404) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('PIN server did not start: ' + errors.join(''));
}

async function call(route, key = 'google', method = 'GET', body, origin = base) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Cookie: 'boekenbaai_session=' + encodeURIComponent(tokens[key] || ''),
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

(async () => {
  try {
    await ready();
    assert.equal(pins.validPin('000001'), true);
    for (const invalid of [123456, '12345', '1234567', '1a3456', null, '']) {
      assert.equal(pins.validPin(invalid), false);
    }
    assert.equal((await call('/api/auth/student-pin/status')).data.hasPin, false);
    assert.equal((await call('/api/auth/student-pin/status')).data.canSet, true);
    assert.equal((await call('/api/auth/student-pin/status', 'local')).data.canSet, false);
    assert.equal((await call('/api/auth/student-pin/set', 'local', 'POST',
      { pin: '123456' })).status, 403, 'A password student login cannot enroll');
    assert.equal((await call('/api/auth/student-pin/set', 'google', 'POST',
      { pin: '12345' })).status, 400, 'PIN must be six digits');
    assert.equal((await call('/api/auth/student-pin/set', 'google', 'POST',
      { pin: '123456' }, 'https://evil.invalid')).status, 403, 'CSRF must fail');

    const saved = await call('/api/auth/student-pin/set', 'google', 'POST', { pin: '123456' });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal((await call('/api/auth/student-pin/status')).data.hasPin, true);

    let persisted = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    let cred = pins.credentialFor(persisted, 'student-a');
    assert.ok(cred);
    assert.equal(cred.linkedSub, 'verified-google-a');
    assert.equal(cred.hash.length, 64);
    assert.ok(!JSON.stringify(persisted).includes('123456'));
    assert.ok(!JSON.stringify(db).includes('123456'));
    assert.equal(await pins.verifyCredential('123456', 'student-a', secret, cred, 'verified-google-a'), true);
    assert.equal(await pins.verifyCredential('123457', 'student-a', secret, cred, 'verified-google-a'), false);
    assert.equal(await pins.verifyCredential('123456', 'student-a', secret, cred, 'other-google-sub'), false);

    const preserved = core.upsertSession(persisted, 'another-token',
      { userId: 'student-a', type: 'student', now: Date.now() }).store;
    assert.equal(pins.credentialFor(core.pruneStore(preserved), 'student-a').hash, cred.hash,
      'Normal Google session writes cannot delete PIN records');

    const unauthorized = await call(
      '/api/auth/student-pin/students/student-a/reset', 'teacherB', 'POST', {});
    assert.equal(unauthorized.status, 403);
    assert.equal((await call('/api/auth/student-pin/status')).data.hasPin, true);

    const reset = await call('/api/auth/student-pin/students/student-a/reset',
      'teacherA', 'POST', {});
    assert.equal(reset.status, 200, JSON.stringify(reset));
    assert.equal((await call('/api/auth/student-pin/status')).data.hasPin, false);
    persisted = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const tombstone = pins.credentialFor(persisted, 'student-a');
    assert.ok(tombstone.generation > cred.generation);
    assert.equal(tombstone.hash, '');
    assert.equal(await pins.verifyCredential('123456', 'student-a', secret, tombstone, 'verified-google-a'), false);

    const again = await call('/api/auth/student-pin/set', 'google', 'POST', { pin: '654321' });
    assert.equal(again.status, 200, JSON.stringify(again));
    persisted = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.ok(pins.credentialFor(persisted, 'student-a').generation > tombstone.generation);
    assert.equal((await call('/api/auth/student-pin/reset', 'google', 'POST', {})).status, 200);
    assert.equal((await call('/api/auth/student-pin/status')).data.hasPin, false);

    assert.equal((await call('/api/auth/student-pin/status', 'invalid')).status, 401);
    assert.equal((await call('/api/auth/student-pin/students/student-b/reset',
      'admin', 'POST', {})).status, 200, 'Admin can reset an active student PIN');

    console.log('Student PIN credentials and HTTP security regression tests passed.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
