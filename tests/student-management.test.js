'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-student-management-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31436;
const baseUrl = `http://127.0.0.1:${port}`;

const tokens = {
  teacherA: 'teacher-a-session',
  teacherB: 'teacher-b-session',
  admin: 'admin-session',
  student: 'student-session',
};

const db = {
  books: [],
  students: [
    {
      id: 'student-existing',
      name: 'Sanne Jansen',
      firstName: 'Sanne',
      lastName: 'Jansen',
      username: 'sanne',
      passwordHash: 'x',
      borrowedBooks: [],
      classIds: ['class-a'],
      active: true,
      parnassysStudentNumber: '10001',
      externalIds: { parnassys: '10001' },
    },
    {
      id: 'student-borrowed',
      name: 'Mirsad Yilmaz',
      firstName: 'Mirsad',
      lastName: 'Yilmaz',
      username: 'mirsad',
      passwordHash: 'x',
      borrowedBooks: ['book-1'],
      classIds: ['class-a'],
      active: true,
    },
  ],
  folders: [],
  classes: [
    { id: 'class-a', name: 'Structuur A', studentIds: ['student-existing', 'student-borrowed'], teacherIds: ['teacher-a'] },
    { id: 'class-b', name: 'Structuur B', studentIds: [], teacherIds: ['teacher-b'] },
    { id: 'class-c', name: 'Structuur C', studentIds: [], teacherIds: [] },
  ],
  users: [
    { id: 'admin-1', name: 'Boekenbaai Beheer', username: 'admin', passwordHash: 'x', role: 'admin' },
    { id: 'teacher-a', name: 'Mentor A', username: 'mentor-a', passwordHash: 'x', role: 'teacher', classIds: ['class-a'] },
    { id: 'teacher-b', name: 'Mentor B', username: 'mentor-b', passwordHash: 'x', role: 'teacher', classIds: ['class-b'] },
  ],
  history: [],
  studentTransferRequests: [],
};
db.books.push({ id: 'book-1', title: 'Boek in bezit', status: 'borrowed', borrowedBy: 'student-borrowed' });
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

let store = core.emptyAuthStore();
for (const [token, userId, type] of [
  [tokens.teacherA, 'teacher-a', 'staff'],
  [tokens.teacherB, 'teacher-b', 'staff'],
  [tokens.admin, 'admin-1', 'staff'],
  [tokens.student, 'student-existing', 'student'],
]) {
  store = core.upsertSession(store, token, { userId, type, remember: false, now: Date.now() }).store;
}
store.linkRequests.push({
  id: 'google-request-warning',
  studentId: 'student-existing',
  email: 'verkeerde.leerling@koraaledu.nl',
  sub: 'wrong-sub',
  googleName: 'Mirsad Yilmaz',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'student-management-preload.js'),
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'local-password-auth-preload.js'),
  '--require', path.join(root, 'login-flow-policy-preload.js'),
  '--require', path.join(root, 'student-google-handoff-preload.js'),
  '--require', path.join(root, 'google-auth-runtime-preload.js'),
  '--require', path.join(root, 'google-first-admin-preload.js'),
  path.join(root, 'server.js'),
], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    BOEKENBAAI_DATA_PATH: dbPath,
    BOEKENBAAI_AUTH_DATA_PATH: authPath,
    BOEKENBAAI_STATIC_DIR: path.join(root, 'public'),
    BOEKENBAAI_GOOGLE_CLIENT_ID: 'test-client',
    BOEKENBAAI_GOOGLE_CLIENT_SECRET: 'test-secret',
    BOEKENBAAI_AUTH_SECRET: 'test-auth-secret',
    BOEKENBAAI_GOOGLE_DOMAIN: 'koraaledu.nl',
    BOEKENBAAI_PUBLIC_URL: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopte: ${stderr.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch (error) {
      // Nog niet gestart.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server start timeout: ${stderr.join('')}`);
}

async function stop() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function headers(token, extra = {}) {
  return {
    Cookie: `boekenbaai_session=${encodeURIComponent(token)}`,
    ...extra,
  };
}

async function json(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: headers(token, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

(async () => {
  try {
    await waitForServer();

    const page = await fetch(`${baseUrl}/staff.html`);
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.match(html, /student-management\.css/);
    assert.match(html, /student-management\.js/);
    assert.match(html, /admin-modern\.js/);

    const stateA = await json('/api/mentor/student-management', { token: tokens.teacherA });
    assert.strictEqual(stateA.response.status, 200);
    assert.strictEqual(stateA.payload.role, 'teacher');
    assert.deepStrictEqual(stateA.payload.classes.filter((entry) => entry.isOwn).map((entry) => entry.id), ['class-a']);
    assert.strictEqual(stateA.payload.students.some((entry) => entry.id === 'student-existing'), true);
    const warning = stateA.payload.googleRequests.find((entry) => entry.id === 'google-request-warning');
    assert.ok(warning);
    assert.strictEqual(warning.nameMatch, 'warning', 'Andere Google-profielnaam moet zichtbaar worden als waarschuwing');

    const created = await json('/api/mentor/students', {
      token: tokens.teacherA,
      method: 'POST',
      body: { name: 'Nieuwe Leerling', classId: 'class-a' },
    });
    assert.strictEqual(created.response.status, 201);
    const newStudentId = created.payload.student.id;
    assert.ok(newStudentId);
    assert.strictEqual(created.payload.student.parnassysStudentNumber, '');

    const duplicate = await json('/api/mentor/students', {
      token: tokens.teacherA,
      method: 'POST',
      body: { name: 'Nieuwe Leerling', classId: 'class-a' },
    });
    assert.strictEqual(duplicate.response.status, 409);
    assert.strictEqual(duplicate.payload.code, 'existing-student');

    const transfer = await json(`/api/mentor/students/${newStudentId}/transfer`, {
      token: tokens.teacherA,
      method: 'POST',
      body: { fromClassId: 'class-a', toClassId: 'class-b' },
    });
    assert.strictEqual(transfer.response.status, 201);
    const transferId = transfer.payload.transfer.id;

    const beforeAccept = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(beforeAccept.classes.find((entry) => entry.id === 'class-a').studentIds.includes(newStudentId), true);
    assert.strictEqual(beforeAccept.classes.find((entry) => entry.id === 'class-b').studentIds.includes(newStudentId), false);

    const stateB = await json('/api/mentor/student-management', { token: tokens.teacherB });
    assert.strictEqual(stateB.payload.incoming.some((entry) => entry.id === transferId), true);

    const accepted = await json(`/api/mentor/student-transfers/${transferId}/accept`, {
      token: tokens.teacherB,
      method: 'POST',
    });
    assert.strictEqual(accepted.response.status, 200);
    const afterAccept = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterAccept.classes.find((entry) => entry.id === 'class-a').studentIds.includes(newStudentId), false);
    assert.strictEqual(afterAccept.classes.find((entry) => entry.id === 'class-b').studentIds.includes(newStudentId), true);

    const backRequest = await json(`/api/mentor/students/${newStudentId}/transfer`, {
      token: tokens.teacherB,
      method: 'POST',
      body: { fromClassId: 'class-b', toClassId: 'class-a' },
    });
    assert.strictEqual(backRequest.response.status, 201);
    const backId = backRequest.payload.transfer.id;

    const rejected = await json(`/api/mentor/student-transfers/${backId}/reject`, {
      token: tokens.teacherA,
      method: 'POST',
    });
    assert.strictEqual(rejected.response.status, 200);
    assert.strictEqual(rejected.payload.transfer.status, 'rejected');
    assert.strictEqual(rejected.payload.transfer.escalatedToAdmin, true);

    const adminState = await json('/api/mentor/student-management', { token: tokens.admin });
    assert.strictEqual(adminState.payload.escalated.some((entry) => entry.id === backId), true);

    const adminAccept = await json(`/api/admin/student-transfers/${backId}/accept`, {
      token: tokens.admin,
      method: 'POST',
    });
    assert.strictEqual(adminAccept.response.status, 200);
    const afterAdmin = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.strictEqual(afterAdmin.classes.find((entry) => entry.id === 'class-a').studentIds.includes(newStudentId), true);

    const borrowedBlocked = await json('/api/mentor/students/student-borrowed/deactivate', {
      token: tokens.teacherA,
      method: 'POST',
    });
    assert.strictEqual(borrowedBlocked.response.status, 409);
    assert.strictEqual(borrowedBlocked.payload.code, 'borrowed-books');

    const deactivated = await json('/api/mentor/students/student-existing/deactivate', {
      token: tokens.teacherA,
      method: 'POST',
    });
    assert.strictEqual(deactivated.response.status, 200);
    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const inactive = persisted.students.find((entry) => entry.id === 'student-existing');
    assert.strictEqual(inactive.active, false);
    assert.deepStrictEqual(inactive.classIds, []);
    assert.strictEqual(persisted.classes.find((entry) => entry.id === 'class-a').studentIds.includes('student-existing'), false);

    const persistedStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.strictEqual(
      persistedStore.sessions.some((entry) => entry.userId === 'student-existing' && entry.type === 'student'),
      false,
      'Sessies van een leerling die van school gaat moeten worden ingetrokken'
    );

    const directory = await fetch(`${baseUrl}/api/login-search?q=san&type=student`, {
      headers: { 'X-Forwarded-For': '198.51.100.91' },
    });
    const directoryPayload = await directory.json();
    assert.strictEqual(directoryPayload.matches.some((entry) => entry.id === 'student-existing'), false);

    const oldStudentSession = await fetch(`${baseUrl}/api/me`, {
      headers: headers(tokens.student),
    });
    assert.notStrictEqual(oldStudentSession.status, 200, 'Een reeds geopende leerlingensessie moet na afmelden van school ongeldig zijn');

    console.log('Mentor leerlingbeheer integratietests geslaagd.');
  } catch (error) {
    console.error(error);
    if (stderr.length) console.error(stderr.join(''));
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
