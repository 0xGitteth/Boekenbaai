'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../google-auth-core');
const { accountCredentialFingerprint } = require('../google-auth-security-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boekenbaai-student-detail-'));
const dbPath = path.join(tmp, 'db.json');
const authPath = `${dbPath}.auth.json`;
const port = 31467;
const baseUrl = `http://127.0.0.1:${port}`;

const tokens = {
  admin: 'student-detail-admin-session',
  teacher: 'student-detail-teacher-session',
  student: 'student-detail-student-session',
};

const db = {
  books: [],
  students: [
    {
      id: 'student-1',
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
      id: 'student-2',
      name: 'Roman de Vries',
      firstName: 'Roman',
      lastName: 'de Vries',
      username: 'roman',
      passwordHash: 'x',
      borrowedBooks: [],
      classIds: ['class-b'],
      active: true,
      parnassysStudentNumber: '20002',
      externalIds: { parnassys: '20002' },
    },
  ],
  folders: [],
  classes: [
    { id: 'class-a', name: 'Structuur A', studentIds: ['student-1'], teacherIds: ['teacher-a'] },
    { id: 'class-b', name: 'Structuur B', studentIds: ['student-2'], teacherIds: ['teacher-b'] },
  ],
  users: [
    { id: 'admin-1', name: 'Boekenbaai Beheer', username: 'admin', passwordHash: 'x', role: 'admin', active: true },
    { id: 'teacher-a', name: 'Mentor A', username: 'mentor-a', passwordHash: 'x', role: 'teacher', classIds: ['class-a'], active: true },
    { id: 'teacher-b', name: 'Mentor B', username: 'mentor-b', passwordHash: 'x', role: 'teacher', classIds: ['class-b'], active: true },
  ],
  history: [],
  studentTransferRequests: [
    {
      id: 'transfer-old',
      studentId: 'student-1',
      fromClassId: 'class-a',
      toClassId: 'class-b',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

function sessionAccount(userId, type) {
  if (type === 'student') {
    const student = db.students.find((entry) => entry.id === userId);
    return student ? { ...student, role: 'student' } : null;
  }
  return db.users.find((entry) => entry.id === userId) || null;
}

let store = core.emptyAuthStore();
for (const [token, userId, type] of [
  [tokens.admin, 'admin-1', 'staff'],
  [tokens.teacher, 'teacher-a', 'staff'],
  [tokens.student, 'student-1', 'student'],
]) {
  store = core.upsertSession(store, token, { userId, type, remember: false, now: Date.now() }).store;
  const session = store.sessions.find((entry) => entry.tokenHash === core.tokenHash(token));
  session.accountFingerprint = accountCredentialFingerprint(sessionAccount(userId, type));
  session.authMethod = type === 'student' || userId === 'teacher-a' ? 'google' : 'password';
}
store.links.push({
  id: 'student-link-1',
  accountType: 'student',
  accountId: 'student-1',
  email: 'sanne@koraaledu.nl',
  sub: 'google-sub-sanne',
  linkedBy: 'admin-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
fs.writeFileSync(authPath, JSON.stringify(store, null, 2));

const child = spawn(process.execPath, [
  '--require', path.join(root, 'response-safety-preload.js'),
  '--require', path.join(root, 'student-login-directory-preload.js'),
  '--require', path.join(root, 'google-auth-security-preload.js'),
  '--require', path.join(root, 'active-account-session-guard-preload.js'),
  '--require', path.join(root, 'link-consistency-preload.js'),
  '--require', path.join(root, 'student-detail-admin-preload.js'),
  '--require', path.join(root, 'student-management-preload.js'),
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
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopte: ${stderr.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch (error) {
      // Server start nog.
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
    Origin: baseUrl,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  };
}

async function request(pathname, { token, method = 'GET', body } = {}) {
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

    const staffPage = await fetch(`${baseUrl}/staff.html`);
    assert.strictEqual(staffPage.status, 200);
    const html = await staffPage.text();
    assert.match(html, /<script src="\/student-detail\.js"><\/script>/, 'De detail-UI moet in staff.html geladen worden');

    const managementAsset = await fetch(`${baseUrl}/student-management.js`);
    assert.strictEqual(managementAsset.status, 200);
    const managementSource = await managementAsset.text();
    assert.match(managementSource, /row\.dataset\.studentId = student\.id/, 'Leerlingrijen moeten de echte interne studentId krijgen');
    assert.match(managementSource, /row\.dataset\.sourceClassId = sourceClassOverride/, 'De bronklas moet veilig aan de rij gekoppeld blijven');

    const uiSource = fs.readFileSync(path.join(root, 'public', 'student-detail.js'), 'utf8');
    assert.match(uiSource, /Alleen Beheer kan dit wijzigen\. Vraag de beheerder/, 'Admin-only velden moeten de compacte rechtenuitleg geven');
    assert.match(uiSource, /control\.disabled = true/, 'Admin-only velden moeten voor docenten echt disabled zijn');
    assert.match(uiSource, /findUnderlyingAction\(row, 'Verplaatsen'\)/, 'Mentorverplaatsen moet de bestaande bewezen transferflow hergebruiken');
    assert.match(uiSource, /findUnderlyingAction\(row, 'Van school'\)/, 'Van-school actie moet vanuit het detail de bestaande veilige flow gebruiken');

    const teacherOverride = await request('/api/admin/students/student-1', {
      token: tokens.teacher,
      method: 'PATCH',
      body: { name: 'Mag Niet', classIds: ['class-b'], parnassysStudentNumber: '99999' },
    });
    assert.strictEqual(teacherOverride.response.status, 403, 'Een docent mag adminvelden niet via de API overrulen');

    const teacherGoogle = await request('/api/auth/google/student-email', {
      token: tokens.teacher,
      method: 'POST',
      body: { studentId: 'student-1', email: 'ander@koraaledu.nl' },
    });
    assert.strictEqual(teacherGoogle.response.status, 403, 'Een docent mag de administratieve Google-koppeling niet handmatig wijzigen');

    const duplicateNumber = await request('/api/admin/students/student-1', {
      token: tokens.admin,
      method: 'PATCH',
      body: { name: 'Sanne Jansen', classIds: ['class-a'], parnassysStudentNumber: '20002' },
    });
    assert.strictEqual(duplicateNumber.response.status, 409, 'Dubbele ParnasSys-leerlingnummers moeten worden geweigerd');

    const adminUpdate = await request('/api/admin/students/student-1', {
      token: tokens.admin,
      method: 'PATCH',
      body: { name: 'Sanne van Dijk', classIds: ['class-b'], parnassysStudentNumber: '10009' },
    });
    assert.strictEqual(adminUpdate.response.status, 200, adminUpdate.payload.message);
    assert.strictEqual(adminUpdate.payload.changed, true);

    const savedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const savedStudent = savedDb.students.find((entry) => entry.id === 'student-1');
    assert.strictEqual(savedStudent.name, 'Sanne van Dijk');
    assert.strictEqual(savedStudent.firstName, 'Sanne');
    assert.strictEqual(savedStudent.lastName, 'van Dijk');
    assert.deepStrictEqual(savedStudent.classIds, ['class-b']);
    assert.strictEqual(savedStudent.parnassysStudentNumber, '10009');
    assert.strictEqual(savedStudent.externalIds.parnassys, '10009');
    assert.ok(!savedDb.classes.find((entry) => entry.id === 'class-a').studentIds.includes('student-1'));
    assert.ok(savedDb.classes.find((entry) => entry.id === 'class-b').studentIds.includes('student-1'));
    const oldTransfer = savedDb.studentTransferRequests.find((entry) => entry.id === 'transfer-old');
    assert.strictEqual(oldTransfer.status, 'cancelled', 'Adminoverride moet oude verplaatsingsverzoeken onschadelijk maken');
    assert.strictEqual(oldTransfer.escalationReason, 'admin-direct-class-change');

    // Laad de studentsessie eerst door de security/runtime stack heen, zodat unlink ook cached sessies moet intrekken.
    const beforeUnlink = await request('/api/me', { token: tokens.student });
    assert.strictEqual(beforeUnlink.response.status, 200, 'De gekoppelde studentsessie moet vooraf geldig zijn');

    const unlink = await request('/api/auth/google/student-email?unlink=1', {
      token: tokens.admin,
      method: 'POST',
      body: { studentId: 'student-1' },
    });
    assert.strictEqual(unlink.response.status, 200, unlink.payload.message);
    assert.strictEqual(unlink.payload.googleEmail, '');

    const savedStore = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.ok(!savedStore.links.some((entry) => entry.accountType === 'student' && entry.accountId === 'student-1'));
    assert.ok(!savedStore.sessions.some((entry) => entry.userId === 'student-1' && entry.type === 'student'));

    const afterUnlink = await request('/api/me', { token: tokens.student });
    assert.strictEqual(afterUnlink.response.status, 401, 'Een reeds gebruikte studentsessie moet na ontkoppelen direct ongeldig zijn');

    console.log('Studentdetail/adminoverride integratietests geslaagd.');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
