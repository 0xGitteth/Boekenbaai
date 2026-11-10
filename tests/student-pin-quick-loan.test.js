'use strict';

// Live HTTP integration: no privileged student session is created by a PIN.
// The existing server checkout route must enforce all ordinary loan rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const core = require('../google-auth-core');
const pins = require('../student-pin-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pin-loan-'));
const dbFile = path.join(temp, 'db.json');
const authFile = dbFile + '.auth.json';
const port = 31958;
const url = 'http://127.0.0.1:' + port;
const secret = 'testing-pin-grants-secret-long-enough';
const book = (id, title, barcode) => ({
  id, title, author: 'Test Auteur', barcode, metadataIsbn: barcode,
  status: 'available', borrowedBy: null, borrowedByClassId: null,
});
const db = {
  books: [
    book('copy-one', 'Nachtvlinder', '9789023456781'),
    book('copy-two', 'Middagzon', '9789023456782'),
    book('copy-three', 'Avondster', '9789023456783'),
    book('copy-four', 'Ochtendmist', '9789023456784'),
  ],
  students: [
    { id: 'student-a', name: 'Alina Een', active: true, borrowedBooks: [], classIds: ['class-a'] },
    { id: 'student-b', name: 'Boris Twee', active: true, borrowedBooks: [], classIds: ['class-b'] },
  ],
  classes: [
    { id: 'class-a', name: 'Klas A', studentIds: ['student-a'], teacherIds: ['teacher-a'] },
    { id: 'class-b', name: 'Klas B', studentIds: ['student-b'], teacherIds: ['teacher-b'] },
  ],
  users: [
    { id: 'teacher-a', role: 'teacher', name: 'Mentor A', active: true, classIds: ['class-a'], passwordHash: 'x' },
    { id: 'teacher-b', role: 'teacher', name: 'Mentor B', active: true, classIds: ['class-b'], passwordHash: 'x' },
  ],
  history: [], folders: [],
};
const sessions = { teacherA: 'teacher-a-pin-test', teacherB: 'teacher-b-pin-test' };
let child;
const stderr = [];

async function request(route, method = 'GET', payload, { token = '', origin = url } = {}) {
  const response = await fetch(url + route, {
    method,
    redirect: 'manual',
    headers: {
      Origin: origin, 'Sec-Fetch-Site': 'same-origin',
      ...(token ? { Cookie: 'boekenbaai_session=' + encodeURIComponent(token) } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json().catch(() => ({})),
    cookies: response.headers.get('set-cookie') || '' };
}
async function verify(studentId, bookId, pin = '123456') {
  return request('/api/auth/student-pin/verify', 'POST', { studentId, bookId, pin });
}
async function checkout(bookId, grant, extra = {}) {
  return request('/api/books/' + bookId + '/check-out', 'POST',
    { pinCheckoutGrant: grant, ...extra });
}
function readDb() { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); }
function readAuth() { return JSON.parse(fs.readFileSync(authFile, 'utf8')); }
async function ready() {
  for (let i = 0; i < 130; i++) {
    if (child.exitCode !== null) throw Error('PIN test server stopped: ' + stderr.join(''));
    try {
      const res = await request('/api/status');
      if (res.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('PIN test server failed to start: ' + stderr.join(''));
}

async function start() {
  fs.writeFileSync(dbFile, JSON.stringify(db));
  let store = core.emptyAuthStore();
  for (const [studentId, email, sub, code] of [
    ['student-a', 'a@koraaledu.nl', 'google-a', '123456'],
    ['student-b', 'b@koraaledu.nl', 'google-b', '654321'],
  ]) {
    store.links.push({ accountType: 'student', accountId: studentId, email, sub });
    const cred = await pins.makeCredential(code, studentId, secret, null, sub);
    pins.replaceCredential(store, cred);
  }
  for (const [key, userId] of [
    ['teacherA', 'teacher-a'], ['teacherB', 'teacher-b'],
  ]) {
    const record = core.upsertSession(store, sessions[key], {
      userId, type: 'staff', now: Date.now(),
    });
    store = record.store;
    const account = db.users.find(item => item.id === userId);
    record.session.accountFingerprint = accountCredentialFingerprint(account);
    record.session.authMethod = 'google';
  }
  fs.writeFileSync(authFile, JSON.stringify(store));

  child = spawn(process.execPath, [
    '--require', path.join(root, 'response-safety-preload.js'),
    '--require', path.join(root, 'student-login-directory-preload.js'),
    '--require', path.join(root, 'google-auth-security-preload.js'),
    '--require', path.join(root, 'active-account-session-guard-preload.js'),
    '--require', path.join(root, 'student-management-preload.js'),
    '--require', path.join(root, 'google-auth-runtime-preload.js'),
    '--require', path.join(root, 'student-pin-preload.js'),
    path.join(root, 'server.js'),
  ], {
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port),
      BOEKENBAAI_DATA_PATH: dbFile, BOEKENBAAI_AUTH_DATA_PATH: authFile,
      BOEKENBAAI_AUTH_SECRET: secret,
      BOEKENBAAI_GOOGLE_DOMAIN: 'koraaledu.nl',
      BOEKENBAAI_PUBLIC_URL: url,
      BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', chunk => stderr.push(String(chunk)));
  await ready();
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
  fs.rmSync(temp, { recursive: true, force: true });
}

(async () => {
  try {
    await start();
    const notLogged = await request('/api/me');
    assert.notEqual(notLogged.status, 200, 'A guest has no student account access');

    const badOrigin = await request('/api/auth/student-pin/verify', 'POST',
      { studentId: 'student-a', bookId: 'copy-one', pin: '123456' },
      { origin: 'https://evil.example.org' });
    assert.equal(badOrigin.status, 403, 'Cross-origin PIN verification must fail');
    const missingPin = await verify('student-a', 'copy-one', '000000');
    assert.equal(missingPin.status, 401, JSON.stringify(missingPin.body));

    const valid = await verify('student-a', 'copy-one');
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
    assert.equal(valid.cookies, '', 'PIN grant cannot set an authentication cookie');
    assert.ok(/^[\w-]{32,}$/.test(valid.body.grant), 'Grant is random, not an account token');
    assert.equal(valid.body.expiresInSeconds, 60);

    const asLogin = await request('/api/me', 'GET', undefined, { token: valid.body.grant });
    assert.notEqual(asLogin.status, 200, 'PIN grant may never become a student session');
    const crossLoan = await request('/api/books/copy-one/check-out', 'POST',
      { pinCheckoutGrant: valid.body.grant }, { origin: 'https://evil.example.org' });
    assert.equal(crossLoan.status, 403);
    const wrongBook = await checkout('copy-two', valid.body.grant);
    assert.equal(wrongBook.status, 401, 'Grant cannot be spent on a second book');
    assert.equal((await checkout('copy-one', valid.body.grant)).status, 401,
      'Mismatched grant is permanently consumed');

    const fresh = await verify('student-a', 'copy-one');
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    const loan = await checkout('copy-one', fresh.body.grant);
    assert.equal(loan.status, 200, JSON.stringify(loan.body));
    assert.equal(loan.body.borrowerId, undefined, 'Public checkout never returns borrower ID');
    assert.equal((await checkout('copy-one', fresh.body.grant)).status, 401,
      'Successful grant is not reusable');
    let latest = readDb();
    assert.equal(latest.books.find(x => x.id === 'copy-one').borrowedBy, 'student-a');
    assert.equal(latest.students.find(x => x.id === 'student-a').borrowedBooks.length, 1);
    assert.equal(latest.history.find(x => x.type === 'check_out').studentId, 'student-a');
    assert.equal((await verify('student-a', 'copy-one')).status, 401,
      'Already borrowed copy must not receive a new PIN grant');

    const toReset = await verify('student-b', 'copy-two', '654321');
    assert.equal(toReset.status, 200, JSON.stringify(toReset.body));
    const wrongTeacher = await request('/api/auth/student-pin/students/student-b/reset',
      'POST', {}, { token: sessions.teacherA });
    assert.equal(wrongTeacher.status, 403);
    const reset = await request('/api/auth/student-pin/students/student-b/reset',
      'POST', {}, { token: sessions.teacherB });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal((await checkout('copy-two', toReset.body.grant)).status, 401,
      'PIN reset revokes outstanding grants immediately');
    assert.equal((await verify('student-b', 'copy-two', '654321')).status, 401,
      'Reset PIN cannot verify new loans');
    latest = readDb();
    assert.equal(latest.books.find(x => x.id === 'copy-two').status, 'available');

    const expirable = await verify('student-a', 'copy-three');
    assert.equal(expirable.status, 200, JSON.stringify(expirable.body));
    let auth = readAuth();
    const entry = auth.pinCheckoutGrants.find(x => x.tokenHash === core.tokenHash(expirable.body.grant));
    assert.ok(entry);
    entry.expiresAt = Date.now() - 1;
    fs.writeFileSync(authFile, JSON.stringify(auth));
    assert.equal((await checkout('copy-three', expirable.body.grant)).status, 401,
      'Expired grant cannot lend books');

    const deletedGrant = await verify('student-a', 'copy-three');
    assert.equal(deletedGrant.status, 200, JSON.stringify(deletedGrant.body));
    const beforeDeletion = readDb();
    fs.writeFileSync(dbFile, JSON.stringify({
      ...beforeDeletion,
      books: beforeDeletion.books.filter(item => item.id !== 'copy-three'),
    }));
    const fallback = await checkout('copy-three', deletedGrant.body.grant,
      { bookId: 'copy-four', barcode: '9789023456784' });
    assert.notEqual(fallback.status, 200,
      'A deleted physical copy must not redirect a PIN grant to an alternate copy');
    assert.equal(readDb().books.find(item => item.id === 'copy-four').status, 'available');
    fs.writeFileSync(dbFile, JSON.stringify(beforeDeletion));

    for (let i = 0; i < 5; i++) {
      const wrong = await verify('student-a', 'copy-four', '999999');
      assert.equal(wrong.status, 401, JSON.stringify(wrong.body));
    }
    const locked = await verify('student-a', 'copy-four', '999999');
    assert.equal(locked.status, 429, JSON.stringify(locked.body));
    assert.equal((await verify('student-a', 'copy-four')).status, 429,
      'Correct PIN cannot bypass a persistent lockout');
    auth = readAuth();
    assert.ok(auth.pinAttemptLimits.some(x =>
      x.studentId === 'student-a' && x.blockedUntil > Date.now()));
    assert.equal((await request('/api/me', 'GET', undefined,
      { token: expirable.body.grant })).status !== 200, true);

    console.log('PIN quick checkout HTTP, scope, replay, reset, CSRF and rate-limit tests passed.');
  } finally {
    await stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
